// Integrações (webhooks e bancos PostgreSQL externos) — roda SOMENTE no servidor.
// Segredos de webhook e senhas de banco ficam aqui e nunca voltam para o navegador.
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { lookup as dnsLookup, LookupAddress } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { Request, Response, Router, json } from 'express';
import pg from 'pg';
import { db, ddl } from './db';
import { decryptKey, encryptKey } from './ai';
import type { DomainEvent } from './events';

// ---------- Proteção contra SSRF ----------
// Webhook só pode apontar para a internet pública: nada de localhost, rede interna ou metadados de nuvem.
// BlockList do Node entende IPv4 escrito como IPv6 em qualquer forma ([::ffff:127.0.0.1], [::ffff:7f00:1]…)
const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], // CGNAT e loopback
  ['169.254.0.0', 16], // link-local / metadados de nuvem
  ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 3], // privadas, multicast e reservados
] as const) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10],
  ['::', 96], ['64:ff9b::', 96], ['2002::', 16], // IPv4 embutido (compatível, NAT64, 6to4); o mapeado (::ffff:) o Node confere nas regras IPv4
] as const) blocked.addSubnet(net, prefix, 'ipv6');

export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  return version === 0 || blocked.check(ip, version === 6 ? 'ipv6' : 'ipv4'); // o que não é IP válido também é recusado
}

export async function checkWebhookUrl(raw: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'URL inválida.';
  }
  if (url.protocol !== 'https:') return 'Use uma URL https.';
  if (url.username || url.password) return 'Não coloque usuário e senha na URL.';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return 'Endereços internos não são permitidos.';
  try {
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) return 'Endereços internos não são permitidos.';
  } catch {
    return 'Não foi possível encontrar esse domínio.';
  }
  return null;
}

// ---------- Webhooks ----------
interface Webhook {
  id: string;
  owner: string; // e-mail do Admin que criou: só ele vê, edita, testa e dispara
  name: string;
  url: string;
  events: string[]; // ex.: ['activity.move', 'sprint.close'] ou ['*'] para todos
  active: boolean;
  secret: string;
  lastDelivery: { at: string; ok: boolean; status?: number; error?: string; event: string } | null;
}

// Guardados no banco (schema lexagile), com o segredo do webhook e a senha do banco cifrados (AES-256-GCM, LEXAGILE_SECRET).
// Cada webhook/conexão tem dono: só quem criou (Admin) enxerga e mexe.
let tables: Promise<unknown> | null = null;
export const ensureTables = () =>
  (tables ??= ddl(
      `create schema if not exists lexagile;
       create table if not exists lexagile.webhook (id text primary key, owner text not null, dados jsonb not null, "segredoCifrado" text not null);
       create table if not exists lexagile.integracao_banco (id text primary key, owner text not null, dados jsonb not null, "senhaCifrada" text not null);`,
    )
    .catch((error) => {
      tables = null;
      throw error;
    }));

type HookRow = { id: string; owner: string; dados: Omit<Webhook, 'id' | 'owner' | 'secret'>; segredoCifrado: string };
const toHook = (r: HookRow): Webhook => ({ ...r.dados, id: r.id, owner: r.owner, secret: decryptKey(r.segredoCifrado) });

const hooks = {
  async list(owner: string) {
    await ensureTables();
    const { rows } = await db().query<HookRow>(`select * from lexagile.webhook where owner = $1 order by dados->>'name'`, [owner]);
    return rows.map(toHook);
  },
  // Sem dono = qualquer um (para saber se o id já existe)
  async get(id: string, owner?: string) {
    await ensureTables();
    const { rows } = await db().query<HookRow>(`select * from lexagile.webhook where id = $1`, [id]);
    return rows[0] && (owner === undefined || rows[0].owner === owner) ? toHook(rows[0]) : undefined;
  },
  async save({ id, owner, secret, ...dados }: Webhook) {
    await db().query(
      `insert into lexagile.webhook (id, owner, dados, "segredoCifrado") values ($1, $2, $3, $4)
       on conflict (id) do update set dados = excluded.dados, "segredoCifrado" = excluded."segredoCifrado"`,
      [id, owner, JSON.stringify(dados), encryptKey(secret)],
    );
  },
  async remove(id: string, owner: string) {
    await ensureTables();
    await db().query(`delete from lexagile.webhook where id = $1 and owner = $2`, [id, owner]);
  },
};
const EVENT_PATTERN = /^(\*|[a-z_]+\.[a-z_]+)$/;

const publicWebhook = ({ secret, owner: _o, ...rest }: Webhook) => ({ ...rest, secretHint: secret.slice(-4) });

export function sign(secret: string, timestamp: string, body: string) {
  return 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

// O DNS é resolvido aqui e o IP é conferido na hora de conectar: um domínio que responde IP público na
// checagem e IP interno no envio (DNS rebinding) é barrado. Não segue redirecionamento.
function safeLookup(host: string, options: object, callback: (err: Error | null, address: string | LookupAddress[], family?: number) => void) {
  dnsLookup(host, { all: true }, (error, addresses) => {
    if (error) return callback(error, '');
    if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) return callback(new Error('Endereços internos não são permitidos.'), '');
    if ((options as { all?: boolean }).all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

function postSafely(url: string, headers: Record<string, string>, body: string) {
  return new Promise<number>((resolve, reject) => {
    const req = httpsRequest(url, { method: 'POST', headers, timeout: 10_000, lookup: safeLookup as never }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('timeout', () => req.destroy(new Error('Tempo esgotado.')));
    req.on('error', reject);
    req.end(body);
  });
}

async function deliver(hook: Webhook, event: string, data: unknown) {
  const body = JSON.stringify({ id: randomUUID(), event, created_at: new Date().toISOString(), data });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const problem = await checkWebhookUrl(hook.url); // confere de novo na hora de enviar (o DNS pode ter mudado)
  if (problem) {
    hook.lastDelivery = { at: new Date().toISOString(), ok: false, error: problem, event };
  } else {
    try {
      const status = await postSafely(
        hook.url,
        {
          'content-type': 'application/json',
          'user-agent': 'Stars-Webhooks/1.0',
          'x-stars-event': event,
          'x-stars-timestamp': timestamp,
          'x-stars-signature': sign(hook.secret, timestamp, body),
        },
        body,
      );
      hook.lastDelivery = { at: new Date().toISOString(), ok: status >= 200 && status < 300, status, event };
    } catch (error) {
      hook.lastDelivery = { at: new Date().toISOString(), ok: false, error: error instanceof Error ? error.message.slice(0, 200) : 'Falha no envio', event };
    }
  }
  await hooks.save(hook).catch(() => undefined);
  return hook.lastDelivery;
}

// Entrega os eventos de uma gravação (já confirmada no banco) aos webhooks inscritos dos Admins daquela empresa.
// Espera no máximo 8s: na Vercel, trabalho deixado para depois da resposta pode ser interrompido.
export async function deliverEvents(events: DomainEvent[]) {
  if (!events.length) return;
  try {
    await ensureTables();
    const deliveries: Promise<unknown>[] = [];
    for (const e of events) {
      const { rows } = await db().query<HookRow>(
        `select w.* from lexagile.webhook w
          where coalesce((w.dados->>'active')::boolean, true)
            and (w.dados->'events' ? $2 or w.dados->'events' ? '*')
            and exists (select 1 from "Usuario" u where lower(u.email) = w.owner and u."tenantId" = $1
                          and u.papel = 'DONO' and u.situacao = 'ATIVO' and u."removidoEm" is null)`,
        [e.tenantId, e.event],
      );
      for (const row of rows) deliveries.push(deliver(toHook(row), e.event, e.data));
    }
    await Promise.race([Promise.allSettled(deliveries), new Promise((resolve) => setTimeout(resolve, 8000))]);
  } catch (error) {
    console.error('[webhooks] falha ao entregar eventos:', (error as Error).message);
  }
}

// ---------- Bancos PostgreSQL ----------
interface DbConnection {
  id: string;
  owner: string; // e-mail do Admin que criou
  name: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: 'disable' | 'require' | 'verify-full';
  schema: string;
  connectTimeoutSec: number;
  statementTimeoutSec: number;
  poolMax: number;
  readOnly: boolean;
  applicationName: string;
  lastTest: { at: string; ok: boolean; info?: string; error?: string } | null;
}

type DbRow = { id: string; owner: string; dados: Omit<DbConnection, 'id' | 'owner' | 'password'>; senhaCifrada: string };
const toDb = (r: DbRow): DbConnection => ({ ...r.dados, id: r.id, owner: r.owner, password: r.senhaCifrada ? decryptKey(r.senhaCifrada) : '' });

const databases = {
  async list(owner: string) {
    await ensureTables();
    const { rows } = await db().query<DbRow>(`select * from lexagile.integracao_banco where owner = $1 order by dados->>'name'`, [owner]);
    return rows.map(toDb);
  },
  async get(id: string, owner?: string) {
    await ensureTables();
    const { rows } = await db().query<DbRow>(`select * from lexagile.integracao_banco where id = $1`, [id]);
    return rows[0] && (owner === undefined || rows[0].owner === owner) ? toDb(rows[0]) : undefined;
  },
  async save({ id, owner, password, ...dados }: DbConnection) {
    await db().query(
      `insert into lexagile.integracao_banco (id, owner, dados, "senhaCifrada") values ($1, $2, $3, $4)
       on conflict (id) do update set dados = excluded.dados, "senhaCifrada" = excluded."senhaCifrada"`,
      [id, owner, JSON.stringify(dados), password ? encryptKey(password) : ''],
    );
  },
  async remove(id: string, owner: string) {
    await ensureTables();
    await db().query(`delete from lexagile.integracao_banco where id = $1 and owner = $2`, [id, owner]);
  },
};
const publicDb = ({ password, owner: _o, ...rest }: DbConnection) => ({ ...rest, hasPassword: !!password });

const HOST_PATTERN = /^[a-zA-Z0-9.\-:\[\]]{1,253}$/;
const NAME_PATTERN = /^[\w$-]{1,63}$/; // nomes de banco, usuário e schema

function parseDb(body: any, existing?: DbConnection): Omit<DbConnection, 'id' | 'owner' | 'lastTest'> | string {
  const name = String(body?.name ?? '').trim().slice(0, 80);
  const host = String(body?.host ?? '').trim();
  const port = Number(body?.port ?? 5432);
  const database = String(body?.database ?? '').trim();
  const user = String(body?.user ?? '').trim();
  const password = typeof body?.password === 'string' && body.password ? body.password : (existing?.password ?? '');
  const ssl = ['disable', 'require', 'verify-full'].includes(body?.ssl) ? body.ssl : 'require';
  const schema = String(body?.schema ?? 'public').trim() || 'public';
  if (!name) return 'Dê um nome para a conexão.';
  if (!HOST_PATTERN.test(host)) return 'Host inválido.';
  if (!Number.isInteger(port) || port < 1 || port > 65535) return 'Porta inválida (1 a 65535).';
  if (!NAME_PATTERN.test(database)) return 'Nome do banco inválido.';
  if (!NAME_PATTERN.test(user)) return 'Usuário inválido.';
  if (!NAME_PATTERN.test(schema)) return 'Schema inválido.';
  if (password.length > 1000) return 'Senha longa demais.';
  const clamp = (value: unknown, min: number, max: number, fallback: number) => Math.min(max, Math.max(min, Math.round(Number(value ?? fallback)) || fallback));
  return {
    name,
    host,
    port,
    database,
    user,
    password,
    ssl,
    schema,
    connectTimeoutSec: clamp(body?.connectTimeoutSec, 1, 60, 10),
    statementTimeoutSec: clamp(body?.statementTimeoutSec, 1, 600, 30),
    poolMax: clamp(body?.poolMax, 1, 50, 10),
    readOnly: body?.readOnly !== false,
    applicationName: String(body?.applicationName ?? 'stars').replace(/[^\w .-]/g, '').slice(0, 60) || 'stars',
  };
}

export function clientConfig(db: Omit<DbConnection, 'id' | 'owner' | 'lastTest'>): pg.ClientConfig {
  return {
    host: db.host,
    port: db.port,
    database: db.database,
    user: db.user,
    password: db.password,
    ssl: db.ssl === 'disable' ? false : { rejectUnauthorized: db.ssl === 'verify-full' },
    connectionTimeoutMillis: db.connectTimeoutSec * 1000,
    statement_timeout: db.statementTimeoutSec * 1000,
    application_name: db.applicationName,
    // schema padrão e, se marcado, sessão somente leitura
    options: `-c search_path=${db.schema}${db.readOnly ? ' -c default_transaction_read_only=on' : ''}`,
  };
}

// Mensagem legível sem expor detalhes internos
function dbError(error: unknown) {
  const code = (error as { code?: string })?.code;
  const message = error instanceof Error ? error.message : '';
  if (code === '28P01' || code === '28000') return 'Usuário ou senha incorretos.';
  if (code === '3D000') return 'Banco de dados não encontrado.';
  if (code === 'ECONNREFUSED') return 'Conexão recusada: confira host, porta e se o banco aceita conexões externas.';
  if (code === 'ENOTFOUND') return 'Host não encontrado.';
  if (/timeout/i.test(message)) return 'Tempo de conexão esgotado.';
  if (/ssl/i.test(message)) return `Problema de SSL: ${message.slice(0, 160)}`;
  return message ? message.slice(0, 200) : 'Falha ao conectar.';
}

// ---------- Rotas ----------
// Integrações são configuração: só Admin (Dono) mexe, e cada um só nas suas
const ownerOf = (req: Request) => req.session!.email.toLowerCase();

// Erros de banco viram 503 sem detalhes
const safe =
  (handler: (req: Request, res: Response) => Promise<unknown>) =>
  async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (error) {
      console.error('[integracoes]', req.method, req.path, (error as Error).message);
      if (!res.headersSent) res.status(503).json({ error: 'Não foi possível concluir agora. Tente de novo.' });
    }
  };

export function integrationsRouter() {
  const router = Router();
  router.use(json({ limit: '100kb' }));
  router.use((req, res, next) =>
    req.session?.memberships.some((m) => m.papel === 'DONO') ? next() : void res.status(403).json({ error: 'Só Admin gerencia integrações.' }),
  );
  const validId = (id: string) => /^[\w-]{1,64}$/.test(id);

  router.get('/webhooks', safe(async (req, res) => res.json((await hooks.list(ownerOf(req))).map(publicWebhook))));

  // Criar ou atualizar. Na criação o segredo é gerado aqui e devolvido UMA vez.
  router.put(
    '/webhooks/:id',
    safe(async (req, res) => {
      const id = String(req.params['id']);
      if (!validId(id)) return void res.status(400).json({ error: 'Id inválido.' });
      const name = String(req.body?.name ?? '').trim().slice(0, 80);
      const url = String(req.body?.url ?? '').trim();
      const events: string[] = Array.isArray(req.body?.events)
        ? [...new Set<string>(req.body.events.map((e: unknown) => String(e)))].filter((e) => EVENT_PATTERN.test(e))
        : [];
      if (!name) return void res.status(400).json({ error: 'Dê um nome para o webhook.' });
      if (!events.length) return void res.status(400).json({ error: 'Escolha ao menos um evento.' });
      const problem = await checkWebhookUrl(url);
      if (problem) return void res.status(400).json({ error: problem });
      const existing = await hooks.get(id);
      if (existing && existing.owner !== ownerOf(req)) return void res.status(404).json({ error: 'Webhook não encontrado.' });
      const secret = existing?.secret ?? 'whsec_' + randomBytes(24).toString('hex');
      const hook: Webhook = { id, owner: ownerOf(req), name, url, events, active: req.body?.active !== false, secret, lastDelivery: existing?.lastDelivery ?? null };
      await hooks.save(hook);
      res.json({ ...publicWebhook(hook), secret: existing ? undefined : secret });
    }),
  );

  router.delete('/webhooks/:id', safe(async (req, res) => {
    await hooks.remove(String(req.params['id']), ownerOf(req));
    res.json({ ok: true });
  }));

  router.post('/webhooks/:id/test', safe(async (req, res) => {
    const hook = await hooks.get(String(req.params['id']), ownerOf(req));
    if (!hook) return void res.status(404).json({ error: 'Webhook não encontrado.' });
    const result = await deliver(hook, 'webhook.test', { message: 'Teste de entrega do LexÁgile', webhook: hook.name });
    res.status(result.ok ? 200 : 502).json(result);
  }));

  router.get('/databases', safe(async (req, res) => res.json((await databases.list(ownerOf(req))).map(publicDb))));

  // Senha em branco na atualização = manter a atual
  router.put('/databases/:id', safe(async (req, res) => {
    const id = String(req.params['id']);
    if (!validId(id)) return void res.status(400).json({ error: 'Id inválido.' });
    const existing = await databases.get(id);
    if (existing && existing.owner !== ownerOf(req)) return void res.status(404).json({ error: 'Conexão não encontrada.' });
    const parsed = parseDb(req.body, existing);
    if (typeof parsed === 'string') return void res.status(400).json({ error: parsed });
    const conn: DbConnection = { ...parsed, id, owner: ownerOf(req), lastTest: existing?.lastTest ?? null };
    await databases.save(conn);
    res.json(publicDb(conn));
  }));

  router.delete('/databases/:id', safe(async (req, res) => {
    await databases.remove(String(req.params['id']), ownerOf(req));
    res.json({ ok: true });
  }));

  router.post('/databases/:id/test', safe(async (req, res) => {
    const conn = await databases.get(String(req.params['id']), ownerOf(req));
    if (!conn) return void res.status(404).json({ error: 'Conexão não encontrada.' });
    // Sem varredura da rede interna: resolve o host uma vez, confere o IP e conecta NESSE IP (sem 2ª consulta de DNS)
    let address: string;
    try {
      const addrs = isIP(conn.host) ? [{ address: conn.host }] : await lookup(conn.host, { all: true });
      if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) return void res.status(400).json({ error: 'Endereços internos não são permitidos.' });
      address = addrs[0].address;
    } catch {
      return void res.status(400).json({ error: 'Host não encontrado.' });
    }
    const config = clientConfig(conn);
    const client = new pg.Client({ ...config, host: address, ssl: config.ssl && { ...(config.ssl as object), servername: isIP(conn.host) ? undefined : conn.host } });
    const started = Date.now();
    try {
      await client.connect();
      const { rows } = await client.query('select version() as version, current_database() as database, current_user as "user"');
      const version = String(rows[0].version).split(' ').slice(0, 2).join(' ');
      conn.lastTest = { at: new Date().toISOString(), ok: true, info: `${version} · ${rows[0].database} · ${Date.now() - started} ms` };
    } catch (error) {
      conn.lastTest = { at: new Date().toISOString(), ok: false, error: dbError(error) };
    } finally {
      await client.end().catch(() => undefined);
    }
    await databases.save(conn);
    res.status(conn.lastTest.ok ? 200 : 502).json(conn.lastTest);
  }));

  return router;
}
