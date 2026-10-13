// Login OAuth do MCP (Claude no site/app e Claude Code) — roda SOMENTE no servidor.
// O SDK do MCP cuida das rotas padrão (/register, /authorize, /token, /.well-known/...). Aqui fica:
// onde guardar clientes, códigos e tokens (banco, schema lexagile; tokens só como hash) e a tela de autorização.
// A pessoa entra com a conta do LexÁgile (senha ou Google) e o Claude age com as permissões dela.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Request, Response, Router, urlencoded } from 'express';
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { InvalidClientMetadataError, InvalidGrantError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { redirectUriMatches } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import { db, ddl, onDbReset, isDevelopment } from './db';
import { Membership, Session, liveMemberships, readSession } from './auth';

const ACCESS_S = 60 * 60; // token de acesso: 1 hora
const REFRESH_S = 30 * 24 * 60 * 60; // renovação: 30 dias (cada uso gera um novo)
const FAMILY_MAX_DAYS = 90; // depois de 90 dias desde o "Permitir", tem de conectar de novo
const CODE_S = 10 * 60; // código de autorização: 10 minutos, uso único
export const SCOPE = 'lexagile';

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const random = () => randomBytes(32).toString('base64url');

// Para onde o código de autorização pode voltar: o Claude (site/app) ou um programa no próprio computador
// da pessoa (Claude Code no terminal). Sem isso, qualquer um cadastraria um "Claude" falso com retorno para o
// site dele e pegaria o acesso de quem clicasse em "Permitir".
const CLAUDE_CALLBACKS = ['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback'];
export function allowedRedirect(raw: string) {
  if (CLAUDE_CALLBACKS.includes(raw)) return true;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}
const clientAllowed = (c: OAuthClientInformationFull) => c.redirect_uris.length > 0 && c.redirect_uris.every((u) => allowedRedirect(String(u)));

// Endereço público do app (o mesmo cadastrado como APP_URL)
export const appUrl = () => (process.env['APP_URL'] || `http://localhost:${process.env['PORT'] || 4200}`).replace(/\/$/, '');

let tables: Promise<void> | null = null;
onDbReset(() => {
  tables = null;
});
export function ensureTables() {
  tables ??= ddl(
      `create schema if not exists lexagile;
       create table if not exists lexagile.oauth_cliente (
         "clientId" text primary key, dados jsonb not null, "criadoEm" timestamptz not null default now());
       create table if not exists lexagile.oauth_codigo (
         "codigoHash" text primary key, "clientId" text not null, "redirectUri" text not null, desafio text not null,
         email text not null, nome text not null, memberships jsonb not null, expira timestamptz not null);
       create table if not exists lexagile.oauth_token (
         "tokenHash" text primary key, tipo text not null, "clientId" text not null,
         email text not null, nome text not null, memberships jsonb not null, expira timestamptz not null);
       -- Família: todos os tokens que vieram do mesmo "Permitir". Reuso de um refresh já usado derruba a família inteira.
       alter table lexagile.oauth_token add column if not exists familia text;
       alter table lexagile.oauth_token add column if not exists "familiaInicio" timestamptz;
       alter table lexagile.oauth_token add column if not exists usado boolean not null default false;
       alter table lexagile.oauth_token add column if not exists "usadoEm" timestamptz;
       -- Tokens de antes das famílias não dá para revogar juntos: saem (a pessoa conecta de novo uma vez)
       delete from lexagile.oauth_token where familia is null;`,
    )
    .then(() => undefined)
    .catch((error) => {
      tables = null;
      throw error;
    });
  return tables;
}

// ---------- Clientes (o Claude se registra sozinho: Dynamic Client Registration) ----------
const clientsStore: OAuthRegisteredClientsStore = {
  async getClient(clientId) {
    await ensureTables();
    const { rows } = await db().query<{ dados: OAuthClientInformationFull }>(`select dados from lexagile.oauth_cliente where "clientId" = $1`, [clientId]);
    // Cliente antigo com retorno fora da lista deixa de valer
    return rows[0]?.dados && clientAllowed(rows[0].dados) ? rows[0].dados : undefined;
  },
  async registerClient(client) {
    const full = client as OAuthClientInformationFull;
    if (!clientAllowed(full)) throw new InvalidClientMetadataError('Endereço de retorno não permitido: use o Claude (claude.ai) ou o Claude Code.');
    if (JSON.stringify(full).length > 8000) throw new InvalidClientMetadataError('Cadastro grande demais.');
    await ensureTables();
    await db().query(`insert into lexagile.oauth_cliente ("clientId", dados) values ($1, $2)`, [full.client_id, JSON.stringify(full)]);
    console.log('[mcp] cliente OAuth registrado:', JSON.stringify(full.client_name ?? full.client_id));
    return full;
  },
};

// ---------- Tokens ----------
async function issueTokens(
  clientId: string,
  who: { email: string; nome: string; memberships: Membership[] },
  family: { id: string; since: string } | null = null, // null: um "Permitir" novo começa uma família
): Promise<OAuthTokens> {
  const access = random();
  const refresh = random();
  const fam = family ?? { id: random(), since: new Date().toISOString() };
  const insert = `insert into lexagile.oauth_token ("tokenHash", tipo, "clientId", email, nome, memberships, expira, familia, "familiaInicio")
                  values ($1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7), $8, $9)`;
  await db().query(`delete from lexagile.oauth_token where expira < now()`); // limpa os vencidos (inclusive os refresh já usados)
  await db().query(`delete from lexagile.oauth_codigo where expira < now()`); // códigos não usados que venceram
  // Clientes cadastrados (DCR) sem nenhuma conexão há 90 dias: o Claude cadastra de novo se precisar
  await db().query(
    `delete from lexagile.oauth_cliente c where c."criadoEm" < now() - interval '90 days'
      and not exists (select 1 from lexagile.oauth_token t where t."clientId" = c."clientId")`,
  );
  await db().query(insert, [sha(access), 'access', clientId, who.email, who.nome, JSON.stringify(who.memberships), ACCESS_S, fam.id, fam.since]);
  await db().query(insert, [sha(refresh), 'refresh', clientId, who.email, who.nome, JSON.stringify(who.memberships), REFRESH_S, fam.id, fam.since]);
  return { access_token: access, token_type: 'bearer', expires_in: ACCESS_S, refresh_token: refresh, scope: SCOPE };
}

// Sessão do Claude (mesmo formato da sessão do app: as regras de visibilidade e permissão são as mesmas)
export function sessionFromAuth(auth: AuthInfo | undefined): Session | null {
  const extra = auth?.extra as { email?: string; nome?: string; memberships?: Membership[] } | undefined;
  if (!auth || !extra?.email || !extra.memberships) return null;
  return { key: `mcp:${sha(auth.token)}`, nome: extra.nome ?? extra.email, email: extra.email, memberships: extra.memberships, expiresAt: (auth.expiresAt ?? 0) * 1000 };
}

export const oauthProvider: OAuthServerProvider = {
  get clientsStore() {
    return clientsStore;
  },

  // /authorize: sem login no LexÁgile, manda para a tela de entrada e volta; com login, mostra a autorização
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    const req = res.req as Request;
    const session = await readSession(req).catch(() => undefined);
    if (!session) {
      res.redirect(`/?next=${encodeURIComponent(req.originalUrl)}`);
      return;
    }
    res.type('html').send(consentPage(client, params, session));
  },

  async challengeForAuthorizationCode(client, code) {
    await ensureTables();
    const { rows } = await db().query<{ desafio: string }>(
      `select desafio from lexagile.oauth_codigo where "codigoHash" = $1 and "clientId" = $2 and expira > now()`,
      [sha(code), client.client_id],
    );
    if (!rows[0]) throw new InvalidGrantError('Código inválido ou vencido.');
    return rows[0].desafio;
  },

  async exchangeAuthorizationCode(client, code, _verifier, redirectUri) {
    await ensureTables();
    // Uso único: apaga ao trocar
    const { rows } = await db().query<{ redirectUri: string; email: string; nome: string; memberships: Membership[] }>(
      `delete from lexagile.oauth_codigo where "codigoHash" = $1 and "clientId" = $2 and expira > now()
       returning "redirectUri", email, nome, memberships`,
      [sha(code), client.client_id],
    );
    const row = rows[0];
    if (!row || redirectUri !== row.redirectUri) throw new InvalidGrantError('Código inválido ou vencido.');
    return issueTokens(client.client_id, row);
  },

  async exchangeRefreshToken(client, refreshToken) {
    await ensureTables();
    // Marca como usado (fica guardado até vencer, para reconhecer um reuso)
    const { rows } = await db().query<{ email: string; familia: string | null; familiaInicio: string | null; memberships: Membership[] }>(
      `update lexagile.oauth_token set usado = true, "usadoEm" = now()
        where "tokenHash" = $1 and tipo = 'refresh' and "clientId" = $2 and expira > now() and not usado
        returning email, familia, "familiaInicio", memberships`,
      [sha(refreshToken), client.client_id],
    );
    if (!rows[0]) {
      // Refresh já usado aparecendo de novo: alguém copiou o token. Derruba a família inteira (o atacante e o legítimo).
      // (exceto se o reuso veio em até 60s: o próprio cliente repetindo o pedido ou duas abas — só recusa, não derruba)
      const { rows: reused } = await db().query<{ familia: string | null; recente: boolean }>(
        `select familia, coalesce("usadoEm" > now() - interval '60 seconds', false) as recente
           from lexagile.oauth_token where "tokenHash" = $1 and tipo = 'refresh' and usado`,
        [sha(refreshToken)],
      );
      if (reused[0]?.familia && !reused[0].recente) {
        await db().query(`delete from lexagile.oauth_token where familia = $1`, [reused[0].familia]);
        console.warn('[mcp] refresh token reutilizado: acesso dessa conexão revogado');
      }
      throw new InvalidGrantError('Acesso vencido. Conecte o LexÁgile de novo.');
    }
    const family = { id: rows[0].familia ?? random(), since: rows[0].familiaInicio ?? new Date().toISOString() };
    if (Date.parse(family.since) < Date.now() - FAMILY_MAX_DAYS * 86_400_000) {
      await db().query(`delete from lexagile.oauth_token where familia = $1`, [family.id]);
      throw new InvalidGrantError(`Conexão com mais de ${FAMILY_MAX_DAYS} dias. Conecte o LexÁgile de novo.`);
    }
    // Renova com as empresas e cargos de hoje (se a pessoa saiu ou o domínio foi removido, perde o acesso).
    // Mesma regra da sessão do site: pelos usuários do token e pelo e-mail
    const memberships = await liveMemberships(rows[0].email, rows[0].memberships);
    if (!memberships.length) throw new InvalidGrantError('Essa conta não tem mais acesso ao LexÁgile.');
    const { rows: who } = await db().query<{ nome: string }>(`select nome from "Usuario" where id = $1`, [memberships[0].usuarioId]);
    return issueTokens(client.client_id, { email: rows[0].email, nome: who[0]?.nome ?? rows[0].email, memberships }, family);
  },

  async verifyAccessToken(token): Promise<AuthInfo> {
    await ensureTables();
    const { rows } = await db().query<{ clientId: string; email: string; nome: string; memberships: Membership[]; expira: string }>(
      `select "clientId", email, nome, memberships, expira from lexagile.oauth_token where "tokenHash" = $1 and tipo = 'access' and expira > now()`,
      [sha(token)],
    );
    if (!rows[0]) throw new InvalidTokenError('Token inválido ou vencido.');
    const r = rows[0];
    // Cargos de agora, não os do momento em que o token foi emitido
    const memberships = await liveMemberships(r.email, r.memberships);
    if (!memberships.length) {
      await db().query(`delete from lexagile.oauth_token where lower(email) = lower($1)`, [r.email]); // perdeu o acesso: derruba tudo
      throw new InvalidTokenError('Essa conta não tem mais acesso ao LexÁgile.');
    }
    return {
      token,
      clientId: r.clientId,
      scopes: [SCOPE],
      expiresAt: Math.floor(new Date(r.expira).getTime() / 1000),
      extra: { email: r.email, nome: r.nome, memberships },
    };
  },

  // Revogar um token derruba a conexão inteira (o par access + refresh), e só do próprio cliente
  async revokeToken(client, request) {
    await ensureTables();
    await db().query(
      `delete from lexagile.oauth_token where "clientId" = $2 and ("tokenHash" = $1
         or familia = (select familia from lexagile.oauth_token where "tokenHash" = $1 and "clientId" = $2))`,
      [sha(request.token), client.client_id],
    );
  },
};

// ---------- Tela "Permitir acesso" ----------
// Os dados do pedido vão num formulário assinado (HMAC com a LEXAGILE_SECRET e a sessão): ninguém consegue
// trocar o endereço de retorno ou montar um "Permitir" em nome de outra pessoa.
const secret = () => {
  const value = process.env['LEXAGILE_SECRET'];
  if (!value && !isDevelopment()) throw new Error('LEXAGILE_SECRET não configurada.');
  return value || 'lexagile-dev-secret';
};
const FIELDS = ['client_id', 'redirect_uri', 'state', 'code_challenge'] as const;
type ConsentFields = Record<(typeof FIELDS)[number], string>;
const sign = (f: ConsentFields, sessionKey: string) => createHmac('sha256', secret()).update(JSON.stringify([...FIELDS.map((k) => f[k]), sessionKey])).digest('hex');
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function consentPage(client: OAuthClientInformationFull, params: AuthorizationParams, session: Session) {
  const fields: ConsentFields = { client_id: client.client_id, redirect_uri: params.redirectUri, state: params.state ?? '', code_challenge: params.codeChallenge };
  const hidden = FIELDS.map((k) => `<input type="hidden" name="${k}" value="${esc(fields[k])}">`).join('');
  const app = esc(client.client_name || 'Um aplicativo');
  // Mostra para onde o acesso vai: "claude.ai" ou "este computador" (Claude Code)
  const target = new URL(params.redirectUri);
  const destination = target.protocol === 'https:' ? esc(target.host) : 'um programa neste computador (Claude Code)';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Autorizar acesso · LexÁgile</title>
<style>
  :root{color-scheme:light dark;--bg:#ebeff3;--card:#fff;--text:#3e4352;--muted:#6b6f7a;--line:#e1e4e8}
  @media (prefers-color-scheme:dark){:root{--bg:#020202;--card:#222124;--text:#fffefd;--muted:#a8a6ad;--line:#3a393e}}
  body{margin:0;min-height:100dvh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,sans-serif;padding:16px}
  main{width:min(440px,100%);background:var(--card);border-radius:18px;padding:28px;box-shadow:0 6px 24px rgb(0 0 0/.18)}
  h1{font-size:22px;margin:0 0 6px} p{margin:0 0 14px;color:var(--muted)} strong{color:var(--text)}
  ul{margin:0 0 20px;padding-left:20px} li{margin:4px 0}
  .who{padding:10px 14px;border:1px solid var(--line);border-radius:12px;margin-bottom:16px}
  .actions{display:flex;gap:10px;justify-content:flex-end}
  button{height:44px;padding:0 20px;border-radius:25px;font:600 15px system-ui,sans-serif;cursor:pointer;border:1px solid var(--line);background:none;color:var(--text)}
  button[value=allow]{background:#4935f7;border-color:#4935f7;color:#fff}
</style></head><body><main>
<h1>${app} quer acessar o LexÁgile</h1>
<div class="who">Como <strong>${esc(session.nome)}</strong> (${esc(session.email)})</div>
<p>O acesso será entregue para <strong>${destination}</strong>. Se você não reconhece, clique em Cancelar.</p>
<p>Com a sua permissão, o ${app} poderá, com os <strong>mesmos acessos que você tem</strong> no LexÁgile:</p>
<ul>
  <li>consultar empresas, projetos, sprints, atividades e pessoas que você pode ver;</li>
  <li>criar atividades, mudar status, comentar e atualizar atividades.</li>
</ul>
<p>Você pode desconectar a qualquer momento nas configurações do Claude.</p>
<form method="post" action="/oauth/consent">${hidden}<input type="hidden" name="sig" value="${sign(fields, session.key)}">
<div class="actions"><button type="submit" name="decision" value="deny">Cancelar</button><button type="submit" name="decision" value="allow">Permitir</button></div>
</form></main></body></html>`;
}

export function consentRouter() {
  const router = Router();
  router.post('/oauth/consent', urlencoded({ extended: false, limit: '10kb' }), async (req, res) => {
    try {
      const session = await readSession(req);
      if (!session) return void res.status(401).send('Faça login no LexÁgile e tente conectar de novo.');
      const f = Object.fromEntries(FIELDS.map((k) => [k, String(req.body?.[k] ?? '')])) as ConsentFields;
      const expected = Buffer.from(sign(f, session.key));
      const got = Buffer.from(String(req.body?.sig ?? ''));
      if (got.length !== expected.length || !timingSafeEqual(got, expected)) return void res.status(400).send('Pedido de autorização inválido.');
      const client = await clientsStore.getClient(f.client_id);
      if (!client || !client.redirect_uris.some((r) => redirectUriMatches(f.redirect_uri, String(r)))) {
        return void res.status(400).send('Aplicativo ou endereço de retorno não reconhecido.');
      }
      const back = new URL(f.redirect_uri);
      if (f.state) back.searchParams.set('state', f.state);
      if (req.body?.decision !== 'allow') {
        back.searchParams.set('error', 'access_denied');
        return void res.redirect(303, back.toString()); // 303: o navegador volta ao Claude com GET (o callback dele recusa POST)
      }
      const code = random();
      await ensureTables();
      await db().query(
        `insert into lexagile.oauth_codigo ("codigoHash", "clientId", "redirectUri", desafio, email, nome, memberships, expira)
         values ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(secs => $8))`,
        [sha(code), f.client_id, f.redirect_uri, f.code_challenge, session.email, session.nome, JSON.stringify(session.memberships), CODE_S],
      );
      console.log('[mcp] autorização concedida a', JSON.stringify(client.client_name ?? client.client_id));
      back.searchParams.set('code', code);
      res.redirect(303, back.toString()); // 303 (não 302/307): segue com GET, como o callback do Claude exige
    } catch (error) {
      console.error('[mcp] falha na autorização:', (error as Error).message);
      res.status(500).send('Não foi possível autorizar agora. Tente de novo.');
    }
  });
  return router;
}
