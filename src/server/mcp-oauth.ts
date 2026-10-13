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
import { InvalidGrantError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { redirectUriMatches } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import { db } from './db';
import { Membership, Session, readSession, usersForEmail } from './auth';

const ACCESS_S = 60 * 60; // token de acesso: 1 hora
const REFRESH_S = 30 * 24 * 60 * 60; // renovação: 30 dias (cada uso gera um novo)
const CODE_S = 10 * 60; // código de autorização: 10 minutos, uso único
export const SCOPE = 'lexagile';

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const random = () => randomBytes(32).toString('base64url');

// Endereço público do app (o mesmo cadastrado como APP_URL)
export const appUrl = () => (process.env['APP_URL'] || `http://localhost:${process.env['PORT'] || 4200}`).replace(/\/$/, '');

let tables: Promise<void> | null = null;
function ensureTables() {
  tables ??= db()
    .query(
      `create schema if not exists lexagile;
       create table if not exists lexagile.oauth_cliente (
         "clientId" text primary key, dados jsonb not null, "criadoEm" timestamptz not null default now());
       create table if not exists lexagile.oauth_codigo (
         "codigoHash" text primary key, "clientId" text not null, "redirectUri" text not null, desafio text not null,
         email text not null, nome text not null, memberships jsonb not null, expira timestamptz not null);
       create table if not exists lexagile.oauth_token (
         "tokenHash" text primary key, tipo text not null, "clientId" text not null,
         email text not null, nome text not null, memberships jsonb not null, expira timestamptz not null);`,
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
    return rows[0]?.dados;
  },
  async registerClient(client) {
    await ensureTables();
    const full = client as OAuthClientInformationFull;
    await db().query(`insert into lexagile.oauth_cliente ("clientId", dados) values ($1, $2)`, [full.client_id, JSON.stringify(full)]);
    console.log(`[mcp] cliente OAuth registrado: ${full.client_name ?? full.client_id}`);
    return full;
  },
};

// ---------- Tokens ----------
async function issueTokens(clientId: string, who: { email: string; nome: string; memberships: Membership[] }): Promise<OAuthTokens> {
  const access = random();
  const refresh = random();
  const insert = `insert into lexagile.oauth_token ("tokenHash", tipo, "clientId", email, nome, memberships, expira)
                  values ($1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7))`;
  await db().query(`delete from lexagile.oauth_token where expira < now()`); // limpa os vencidos
  await db().query(insert, [sha(access), 'access', clientId, who.email, who.nome, JSON.stringify(who.memberships), ACCESS_S]);
  await db().query(insert, [sha(refresh), 'refresh', clientId, who.email, who.nome, JSON.stringify(who.memberships), REFRESH_S]);
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
    if (!row || (redirectUri && redirectUri !== row.redirectUri)) throw new InvalidGrantError('Código inválido ou vencido.');
    return issueTokens(client.client_id, row);
  },

  async exchangeRefreshToken(client, refreshToken) {
    await ensureTables();
    const { rows } = await db().query<{ email: string }>(
      `delete from lexagile.oauth_token where "tokenHash" = $1 and tipo = 'refresh' and "clientId" = $2 and expira > now() returning email`,
      [sha(refreshToken), client.client_id],
    );
    if (!rows[0]) throw new InvalidGrantError('Acesso vencido. Conecte o LexÁgile de novo.');
    // Renova com as empresas e cargos de hoje (se a pessoa saiu ou o domínio foi removido, perde o acesso)
    const users = await usersForEmail(rows[0].email);
    if (!users.length) throw new InvalidGrantError('Essa conta não tem mais acesso ao LexÁgile.');
    return issueTokens(client.client_id, {
      email: rows[0].email,
      nome: users[0].nome,
      memberships: users.map((u) => ({ usuarioId: u.id, tenantId: u.tenantId, papel: u.papel })),
    });
  },

  async verifyAccessToken(token): Promise<AuthInfo> {
    await ensureTables();
    const { rows } = await db().query<{ clientId: string; email: string; nome: string; memberships: Membership[]; expira: string }>(
      `select "clientId", email, nome, memberships, expira from lexagile.oauth_token where "tokenHash" = $1 and tipo = 'access' and expira > now()`,
      [sha(token)],
    );
    if (!rows[0]) throw new InvalidTokenError('Token inválido ou vencido.');
    const r = rows[0];
    return {
      token,
      clientId: r.clientId,
      scopes: [SCOPE],
      expiresAt: Math.floor(new Date(r.expira).getTime() / 1000),
      extra: { email: r.email, nome: r.nome, memberships: r.memberships },
    };
  },

  async revokeToken(_client, request) {
    await ensureTables();
    await db().query(`delete from lexagile.oauth_token where "tokenHash" = $1`, [sha(request.token)]);
  },
};

// ---------- Tela "Permitir acesso" ----------
// Os dados do pedido vão num formulário assinado (HMAC com a LEXAGILE_SECRET e a sessão): ninguém consegue
// trocar o endereço de retorno ou montar um "Permitir" em nome de outra pessoa.
const secret = () => process.env['LEXAGILE_SECRET'] || 'lexagile-dev-secret';
const FIELDS = ['client_id', 'redirect_uri', 'state', 'code_challenge'] as const;
type ConsentFields = Record<(typeof FIELDS)[number], string>;
const sign = (f: ConsentFields, sessionKey: string) => createHmac('sha256', secret()).update(JSON.stringify([...FIELDS.map((k) => f[k]), sessionKey])).digest('hex');
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function consentPage(client: OAuthClientInformationFull, params: AuthorizationParams, session: Session) {
  const fields: ConsentFields = { client_id: client.client_id, redirect_uri: params.redirectUri, state: params.state ?? '', code_challenge: params.codeChallenge };
  const hidden = FIELDS.map((k) => `<input type="hidden" name="${k}" value="${esc(fields[k])}">`).join('');
  const app = esc(client.client_name || 'Claude');
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
        return void res.redirect(back.toString());
      }
      const code = random();
      await ensureTables();
      await db().query(
        `insert into lexagile.oauth_codigo ("codigoHash", "clientId", "redirectUri", desafio, email, nome, memberships, expira)
         values ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(secs => $8))`,
        [sha(code), f.client_id, f.redirect_uri, f.code_challenge, session.email, session.nome, JSON.stringify(session.memberships), CODE_S],
      );
      console.log(`[mcp] ${session.email} autorizou ${client.client_name ?? client.client_id}`);
      back.searchParams.set('code', code);
      res.redirect(back.toString());
    } catch (error) {
      console.error('[mcp] falha na autorização:', (error as Error).message);
      res.status(500).send('Não foi possível autorizar agora. Tente de novo.');
    }
  });
  return router;
}
