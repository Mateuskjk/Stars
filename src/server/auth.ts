// Login com a tabela "Usuario" do banco — roda SOMENTE no servidor.
// A senha é conferida contra o senhaHash (scrypt$N$r$p$salt$hash); o hash nunca sai do servidor.
// A sessão é um token aleatório num cookie httpOnly (o JavaScript da página não consegue ler).
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { NextFunction, Request, Response, Router, json } from 'express';
import { db, ddl, onDbReset, isDevelopment } from './db';
import { isAllowedEmail } from './domains';
import { hit, reset, undo } from './limits';

// Uma pessoa (e-mail) pode ter um usuário em cada empresa (Tenant)
export interface Membership {
  usuarioId: string;
  tenantId: string;
  papel: string; // DONO | GESTOR | ATENDENTE | OBSERVADOR
}

// Papéis do banco → cargos do LexÁgile. Observador entra como membro, mas só leitura.
export type Role = 'admin' | 'supervisor' | 'member';
export function roleOf(papel: string): Role {
  return papel === 'DONO' ? 'admin' : papel === 'GESTOR' ? 'supervisor' : 'member';
}
export const isReadOnly = (papel: string) => papel === 'OBSERVADOR';

export interface Session {
  key: string; // hash do token (é o que fica guardado; o token mesmo só existe no cookie)
  nome: string;
  email: string;
  memberships: Membership[];
  expiresAt: number;
}

declare module 'express-serve-static-core' {
  interface Request {
    session?: Session;
  }
}

// Prefixo __Host-: o navegador só aceita o cookie com Secure, sem Domain e com Path=/ (outro subdomínio não o sobrescreve)
const COOKIE = '__Host-lex_session';
const SESSION_MS = 12 * 60 * 60 * 1000;
export const REMEMBER_BUSINESS_DAYS = 7;

// "Manter conectado": vence depois de N dias úteis (sábado e domingo não contam), no mesmo horário, em Brasília
export function businessDaysFrom(now: number, days: number) {
  const BRT = 3 * 60 * 60 * 1000; // UTC-3 (sem horário de verão desde 2019)
  const d = new Date(now - BRT);
  for (let left = days; left > 0; ) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) left--;
  }
  return d.getTime() + BRT;
}
// Sessões no banco (lexagile.sessao): valem em qualquer cópia do servidor (Vercel e afins) e sobrevivem a reinícios.
// A memória é só um atalho para não ir ao banco a cada requisição.
const sessions = new Map<string, Session>();
const CACHE_MS = 60_000;

let sessionTable: Promise<boolean> | null = null;
export function ensureSessionTable() {
  sessionTable ??= ddl(
      `create schema if not exists lexagile;
       create table if not exists lexagile.sessao (
         "tokenHash" text primary key,
         nome text not null,
         email text not null,
         memberships jsonb not null,
         "expiraEm" timestamptz not null
       )`,
    )
    .then(() => true)
    .catch((error) => {
      console.error('[auth] sem tabela de sessões, usando só a memória:', (error as Error).message);
      sessionTable = null;
      return false;
    });
  return sessionTable;
}
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

// ---------- Senha ----------
function scryptAsync(password: string, salt: Buffer | string, keylen: number, opts: { N: number; r: number; p: number }) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, keylen, { ...opts, maxmem: 256 * opts.N * opts.r }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const parts = stored?.split('$');
  if (!parts || parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const opts = { N: Number(n), r: Number(r), p: Number(p) };
  if (!expected.length || !Number.isInteger(opts.N) || opts.N > 2 ** 17) return false;
  // O salt pode ter sido usado como bytes (base64 decodificado) ou como o próprio texto
  for (const s of [Buffer.from(salt, 'base64'), salt]) {
    const key = await scryptAsync(password, s, expected.length, opts);
    if (timingSafeEqual(key, expected)) return true;
  }
  return false;
}

const DUMMY_HASH = `scrypt$32768$8$1$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(32).toString('base64')}`;

// ---------- Limite de tentativas de login (no banco: vale em todas as cópias do servidor) ----------
// Em 15 minutos: 5 erros do mesmo e-mail no mesmo IP, 20 de um IP, 30 contra um e-mail (de vários IPs).
// Separados assim, um atacante não tranca a conta de outra pessoa só errando a senha dela 5 vezes.
const WINDOW_S = 15 * 60;
export const loginKeys = (email: string, ip: string) => ({ [`login:${email}|${ip}`]: 5, [`login-ip:${ip}`]: 20, [`login-email:${email}`]: 30 });

// Conta a tentativa ANTES de conferir a senha (soma atômica no banco): disparar centenas de tentativas ao mesmo
// tempo não passa do limite. Devolve true se passou do limite.
export async function overLimit(keys: Record<string, number>) {
  const over = await Promise.all(Object.entries(keys).map(async ([k, max]) => (await hit(k, WINDOW_S)) > max));
  return over.some(Boolean);
}

// Acertou a senha: a tentativa não conta (um escritório inteiro entrando pelo mesmo IP não se bloqueia)
async function forgive(keys: Record<string, number>) {
  await Promise.all(Object.keys(keys).map((k) => undo(k)));
}

// ---------- Sessão ----------
const cachedAt = new Map<string, number>();
onDbReset(() => {
  sessionTable = null;
  sessions.clear();
  cachedAt.clear();
});

export async function readSession(req: Request): Promise<Session | undefined> {
  const token = parseCookie(req.headers.cookie)[COOKIE];
  if (!token) return undefined;
  const key = hashToken(token);
  const cached = sessions.get(key);
  if (cached && cached.expiresAt >= Date.now() && Date.now() - (cachedAt.get(key) ?? 0) < CACHE_MS) return cached;
  sessions.delete(key);
  if (!(await ensureSessionTable())) return undefined; // sem conferir no banco, não confia na memória (falha fechado)
  const { rows } = await db().query<{ nome: string; email: string; memberships: Membership[]; expira: string }>(
    `select nome, email, memberships, "expiraEm" as expira from lexagile.sessao where "tokenHash" = $1 and "expiraEm" > now()`,
    [key],
  );
  if (!rows[0]) return undefined;
  // Empresas e cargos de AGORA (relidos a cada minuto): removido, rebaixado, empresa desativada ou domínio
  // retirado perde o acesso na hora, sem esperar a sessão de 12h vencer
  const memberships = await liveMemberships(rows[0].email, rows[0].memberships);
  if (!memberships.length) {
    await db().query(`delete from lexagile.sessao where "tokenHash" = $1`, [key]);
    return undefined;
  }
  const session: Session = { key, nome: rows[0].nome, email: rows[0].email, memberships, expiresAt: new Date(rows[0].expira).getTime() };
  sessions.set(key, session);
  cachedAt.set(key, Date.now());
  return session;
}

// Grava as empresas da sessão de novo (ex.: depois de criar uma empresa, quem criou passa a ser Dono dela)
export async function saveSession(session: Session) {
  sessions.set(session.key, session);
  cachedAt.set(session.key, Date.now());
  if (await ensureSessionTable()) {
    await db().query(`update lexagile.sessao set memberships = $1 where "tokenHash" = $2`, [JSON.stringify(session.memberships), session.key]);
  }
}

// Lê os cookies sem quebrar: valor com "=" fica inteiro e "%" malformado (cookie de outro sistema) é ignorado
export function parseCookie(header = ''): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const key = part.slice(0, i).trim();
    const raw = part.slice(i + 1).trim();
    if (!key || !raw) continue;
    try {
      cookies[key] = decodeURIComponent(raw);
    } catch {
      cookies[key] = raw;
    }
  }
  return cookies;
}

// Cookie httpOnly (o JavaScript da página não lê), sempre Secure (só HTTPS; o navegador aceita também em http://localhost)
export function setCookie(res: Response, value: string, maxAgeMs: number, name = COOKIE) {
  res.append('Set-Cookie', `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}`);
}

// Abre a sessão com os usuários (um por empresa) que provaram ser a pessoa — por senha ou pelo Google
// remember: "Manter conectado" marcado (7 dias úteis); sem ele, 12 horas
export async function startSession(res: Response, email: string, users: { id: string; nome: string; papel: string; tenantId: string }[], remember = false) {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  const session: Session = {
    key: hashToken(token),
    nome: users[0].nome,
    email,
    memberships: users.map((u) => ({ usuarioId: u.id, tenantId: u.tenantId, papel: u.papel })),
    expiresAt: remember ? businessDaysFrom(now, REMEMBER_BUSINESS_DAYS) : now + SESSION_MS,
  };
  if (await ensureSessionTable()) {
    await db().query(`delete from lexagile.sessao where "expiraEm" < now()`); // limpa as vencidas
    await db().query(
      `insert into lexagile.sessao ("tokenHash", nome, email, memberships, "expiraEm") values ($1, $2, $3, $4, to_timestamp($5 / 1000.0))`,
      [session.key, session.nome, email, JSON.stringify(session.memberships), session.expiresAt],
    );
  }
  sessions.set(session.key, session);
  cachedAt.set(session.key, Date.now());
  setCookie(res, token, session.expiresAt - now);
}

// Usuários (um por empresa) com acesso hoje: ativo, empresa ativa e domínio permitido
export async function usersForEmail(email: string) {
  if (!(await isAllowedEmail(email))) return [];
  const { rows } = await db().query<{ id: string; nome: string; papel: string; tenantId: string }>(
    `select u.id, u.nome, u.papel, u."tenantId"
       from "Usuario" u join "Tenant" t on t.id = u."tenantId"
      where lower(u.email) = $1 and u.situacao = 'ATIVO' and u."removidoEm" is null and t.ativo`,
    [email.trim().toLowerCase()],
  );
  return rows;
}

// Recalcula as empresas e cargos de quem já está logado (site ou Claude): pelos usuários da sessão (o login
// pelo Google acha a conta pelo vínculo, e o e-mail do Google pode ser outro) e pelo e-mail (empresas novas)
export async function liveMemberships(email: string, before: Membership[]): Promise<Membership[]> {
  if (!(await isAllowedEmail(email))) return [];
  const { rows } = await db().query<Membership>(
    `select u.id as "usuarioId", u."tenantId", u.papel
       from "Usuario" u join "Tenant" t on t.id = u."tenantId"
      where (u.id = any($1::text[]) or lower(u.email) = $2) and u.situacao = 'ATIVO' and u."removidoEm" is null and t.ativo`,
    [before.map((m) => m.usuarioId), email.trim().toLowerCase()],
  );
  return rows;
}

// Superadmin: configurações que valem para TODAS as empresas (domínios permitidos, modelos de IA).
// Ser Dono de uma empresa não basta (senão o Dono da empresa A mexeria no login e na IA da empresa B).
// Lista de e-mails em LEXAGILE_SUPERADMINS, separados por vírgula. Sem a variável, só em desenvolvimento (NODE_ENV) qualquer Dono vale.
export function isSuperAdmin(s: Session) {
  const list = (process.env['LEXAGILE_SUPERADMINS'] ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (list.length) return list.includes(s.email.toLowerCase());
  return isDevelopment() && s.memberships.some((m) => m.papel === 'DONO');
}
export const SUPERADMIN_ONLY = 'Só o superadmin do LexÁgile altera esta configuração (variável LEXAGILE_SUPERADMINS no servidor).';

// Rotas protegidas: sem sessão válida, 401
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  let session: Session | undefined;
  try {
    session = await readSession(req);
  } catch (error) {
    console.error('[auth] falha ao ler a sessão:', (error as Error).message);
    res.status(503).json({ error: 'Não foi possível conferir o login agora. Tente de novo.' });
    return;
  }
  if (!session) {
    res.status(401).json({ error: 'Faça login para continuar.' });
    return;
  }
  req.session = session;
  next();
}

export function authRouter() {
  const router = Router();
  router.use(json({ limit: '10kb' }));

  router.post('/login', async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const senha = String(req.body?.senha ?? '');
    const keys = loginKeys(email, req.ip ?? '');
    if (!email || !senha || senha.length > 200) {
      res.status(400).json({ error: 'Informe e-mail e senha.' });
      return;
    }
    if (await overLimit(keys)) {
      res.status(429).json({ error: 'Muitas tentativas. Tente de novo em alguns minutos.' });
      return;
    }
    if (!(await isAllowedEmail(email))) {
      res.status(403).json({ error: 'Esse e-mail não tem acesso ao LexÁgile. Use o e-mail da sua empresa.' });
      return;
    }
    try {
      const { rows } = await db().query<{ id: string; nome: string; email: string; papel: string; tenantId: string; senhaHash: string }>(
        `select u.id, u.nome, u.email, u.papel, u."tenantId", u."senhaHash"
           from "Usuario" u join "Tenant" t on t.id = u."tenantId"
          where lower(u.email) = $1 and u.situacao = 'ATIVO' and u."removidoEm" is null and t.ativo`,
        [email],
      );
      const matched = [];
      for (const row of rows) if (await verifyPassword(senha, row.senhaHash)) matched.push(row);
      // E-mail sem conta: faz o mesmo trabalho de conferir a senha, para o tempo de resposta não denunciar
      if (!rows.length) await verifyPassword(senha, DUMMY_HASH);
      if (!matched.length) {
        // (a tentativa já foi contada antes de conferir a senha)
        // Mesma mensagem para e-mail inexistente e senha errada (não revela quem tem conta)
        res.status(401).json({ error: 'E-mail ou senha incorretos.' });
        return;
      }
      await forgive(keys);
      await reset(`login:${email}|${req.ip ?? ''}`); // acertou: zera os erros deste e-mail neste IP
      await startSession(res, email, matched, req.body?.lembrar === true);
      res.json({ nome: matched[0].nome, empresas: matched.length });
    } catch (error) {
      console.error('[auth] falha no login:', (error as Error).message);
      res.status(500).json({ error: 'Não foi possível entrar agora.' });
    }
  });

  router.post('/logout', async (req, res) => {
    const token = parseCookie(req.headers.cookie)[COOKIE];
    if (token) {
      sessions.delete(hashToken(token));
      if (await ensureSessionTable().catch(() => false)) {
        await db().query(`delete from lexagile.sessao where "tokenHash" = $1`, [hashToken(token)]).catch(() => undefined);
      }
    }
    setCookie(res, '', 0);
    res.status(204).end();
  });

  router.get('/me', requireAuth, (req, res) => {
    const { nome, email, memberships } = req.session!;
    res.json({
      nome,
      email,
      memberships: memberships.map((m) => ({ ...m, role: roleOf(m.papel), readOnly: isReadOnly(m.papel) })),
    });
  });

  return router;
}
