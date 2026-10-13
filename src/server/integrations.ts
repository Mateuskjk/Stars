// Integrações (webhooks e bancos PostgreSQL externos) — roda SOMENTE no servidor.
// Segredos de webhook e senhas de banco ficam aqui e nunca voltam para o navegador.
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { Request, Router, json } from 'express';
import pg from 'pg';

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

// ponytail: guardados na memória do servidor (somem ao reiniciar); em produção, banco com os segredos cifrados e empresa (tenantId).
// Cada webhook/conexão tem dono: só quem criou (Admin) enxerga e mexe.
const webhooks = new Map<string, Webhook>();
const EVENT_PATTERN = /^(\*|[a-z_]+\.[a-z_]+)$/;

const publicWebhook = ({ secret, owner: _o, ...rest }: Webhook) => ({ ...rest, secretHint: secret.slice(-4) });

export function sign(secret: string, timestamp: string, body: string) {
  return 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

async function deliver(hook: Webhook, event: string, data: unknown) {
  const body = JSON.stringify({ id: randomUUID(), event, created_at: new Date().toISOString(), data });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const problem = await checkWebhookUrl(hook.url); // confere de novo na hora de enviar (o DNS pode ter mudado)
  if (problem) {
    hook.lastDelivery = { at: new Date().toISOString(), ok: false, error: problem, event };
    return hook.lastDelivery;
  }
  try {
    const response = await fetch(hook.url, {
      method: 'POST',
      redirect: 'manual', // não segue redirecionamento (poderia levar para a rede interna)
      signal: AbortSignal.timeout(10_000),
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Stars-Webhooks/1.0',
        'x-stars-event': event,
        'x-stars-timestamp': timestamp,
        'x-stars-signature': sign(hook.secret, timestamp, body),
      },
      body,
    });
    hook.lastDelivery = { at: new Date().toISOString(), ok: response.ok, status: response.status, event };
  } catch (error) {
    hook.lastDelivery = { at: new Date().toISOString(), ok: false, error: error instanceof Error ? error.message : 'Falha no envio', event };
  }
  return hook.lastDelivery;
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

const databases = new Map<string, DbConnection>();
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
const mine = <T extends { owner: string }>(map: Map<string, T>, req: Request, id: string) => {
  const item = map.get(id);
  return item && item.owner === ownerOf(req) ? item : undefined;
};

export function integrationsRouter() {
  const router = Router();
  router.use(json({ limit: '100kb' }));
  router.use((req, res, next) =>
    req.session?.memberships.some((m) => m.papel === 'DONO') ? next() : void res.status(403).json({ error: 'Só Admin gerencia integrações.' }),
  );
  const validId = (id: string) => /^[\w-]{1,64}$/.test(id);

  router.get('/webhooks', (req, res) => void res.json([...webhooks.values()].filter((h) => h.owner === ownerOf(req)).map(publicWebhook)));

  // Criar ou atualizar. Na criação o segredo é gerado aqui e devolvido UMA vez.
  router.put('/webhooks/:id', async (req, res) => {
    const id = req.params.id;
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
    if (webhooks.has(id) && !mine(webhooks, req, id)) return void res.status(404).json({ error: 'Webhook não encontrado.' });
    const existing = webhooks.get(id);
    const secret = existing?.secret ?? 'whsec_' + randomBytes(24).toString('hex');
    const hook: Webhook = { id, owner: ownerOf(req), name, url, events, active: req.body?.active !== false, secret, lastDelivery: existing?.lastDelivery ?? null };
    webhooks.set(id, hook);
    res.json({ ...publicWebhook(hook), secret: existing ? undefined : secret });
  });

  router.delete('/webhooks/:id', (req, res) => {
    if (mine(webhooks, req, req.params.id)) webhooks.delete(req.params.id);
    res.json({ ok: true });
  });

  router.post('/webhooks/:id/test', async (req, res) => {
    const hook = mine(webhooks, req, req.params.id);
    if (!hook) return void res.status(404).json({ error: 'Webhook não encontrado.' });
    const result = await deliver(hook, 'webhook.test', { message: 'Teste de entrega do LexÁgile', webhook: hook.name });
    res.status(result.ok ? 200 : 502).json(result);
  });

  // Eventos do sistema (vindos das ações registradas na auditoria): entrega só aos webhooks de quem fez a ação.
  // ponytail: o evento vem do navegador; o certo é o servidor emitir depois de gravar (fase 2)
  router.post('/events', (req, res) => {
    const event = String(req.body?.event ?? '');
    if (!EVENT_PATTERN.test(event) || event === '*') return void res.status(400).json({ error: 'Evento inválido.' });
    const data = req.body?.data ?? {};
    const targets = [...webhooks.values()].filter((hook) => hook.owner === ownerOf(req) && hook.active && (hook.events.includes('*') || hook.events.includes(event)));
    for (const hook of targets) void deliver(hook, event, data); // não espera: a tela não fica travada
    res.status(202).json({ queued: targets.length });
  });

  router.get('/databases', (req, res) => void res.json([...databases.values()].filter((d) => d.owner === ownerOf(req)).map(publicDb)));

  // Senha em branco na atualização = manter a atual
  router.put('/databases/:id', (req, res) => {
    const id = req.params.id;
    if (!validId(id)) return void res.status(400).json({ error: 'Id inválido.' });
    if (databases.has(id) && !mine(databases, req, id)) return void res.status(404).json({ error: 'Conexão não encontrada.' });
    const existing = databases.get(id);
    const parsed = parseDb(req.body, existing);
    if (typeof parsed === 'string') return void res.status(400).json({ error: parsed });
    const db: DbConnection = { ...parsed, id, owner: ownerOf(req), lastTest: existing?.lastTest ?? null };
    databases.set(id, db);
    res.json(publicDb(db));
  });

  router.delete('/databases/:id', (req, res) => {
    if (mine(databases, req, req.params.id)) databases.delete(req.params.id);
    res.json({ ok: true });
  });

  router.post('/databases/:id/test', async (req, res) => {
    const db = mine(databases, req, req.params.id);
    if (!db) return void res.status(404).json({ error: 'Conexão não encontrada.' });
    // Sem varredura da rede interna: o host precisa resolver para um endereço público
    try {
      const addrs = isIP(db.host) ? [{ address: db.host }] : await lookup(db.host, { all: true });
      if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) return void res.status(400).json({ error: 'Endereços internos não são permitidos.' });
    } catch {
      return void res.status(400).json({ error: 'Host não encontrado.' });
    }
    const client = new pg.Client(clientConfig(db));
    const started = Date.now();
    try {
      await client.connect();
      const { rows } = await client.query('select version() as version, current_database() as database, current_user as "user"');
      const version = String(rows[0].version).split(' ').slice(0, 2).join(' ');
      db.lastTest = { at: new Date().toISOString(), ok: true, info: `${version} · ${rows[0].database} · ${Date.now() - started} ms` };
    } catch (error) {
      db.lastTest = { at: new Date().toISOString(), ok: false, error: dbError(error) };
    } finally {
      await client.end().catch(() => undefined);
    }
    res.status(db.lastTest.ok ? 200 : 502).json(db.lastTest);
  });

  return router;
}
