// Login com a tabela "Usuario" do banco — roda SOMENTE no servidor.
// A senha é conferida contra o senhaHash (scrypt$N$r$p$salt$hash); o hash nunca sai do servidor.
// A sessão é um token aleatório num cookie httpOnly (o JavaScript da página não consegue ler).
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { NextFunction, Request, Response, Router, json } from 'express';
import { db } from './db';

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

const COOKIE = 'lex_session';
const SESSION_MS = 12 * 60 * 60 * 1000;
// ponytail: sessões em memória (somem ao reiniciar o servidor); quando gravarmos no banco, viram uma tabela
const sessions = new Map<string, Session>();
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

// ---------- Limite de tentativas: 5 erros em 15 minutos por e-mail e por IP ----------
const failures = new Map<string, { count: number; since: number }>();
const WINDOW = 15 * 60 * 1000;

export function tooManyAttempts(keys: string[], now = Date.now()) {
  return keys.some((k) => {
    const f = failures.get(k);
    return !!f && now - f.since < WINDOW && f.count >= 5;
  });
}

function recordFailure(keys: string[], now = Date.now()) {
  for (const k of keys) {
    const f = failures.get(k);
    if (!f || now - f.since >= WINDOW) failures.set(k, { count: 1, since: now });
    else f.count++;
  }
}

// ---------- Sessão ----------
export function readSession(req: Request): Session | undefined {
  const token = parseCookie(req.headers.cookie)[COOKIE];
  if (!token) return undefined;
  const key = hashToken(token);
  const session = sessions.get(key);
  if (session && session.expiresAt < Date.now()) sessions.delete(key);
  return session && session.expiresAt >= Date.now() ? session : undefined;
}

export function parseCookie(header = ''): Record<string, string> {
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim().split('='))
      .filter(([k, v]) => k && v)
      .map(([k, v]) => [k, decodeURIComponent(v)]),
  );
}

// Cookie httpOnly (o JavaScript da página não lê); em produção só trafega em HTTPS
export function setCookie(res: Response, value: string, maxAgeMs: number, name = COOKIE) {
  const secure = process.env['NODE_ENV'] === 'production' ? '; Secure' : '';
  res.append('Set-Cookie', `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`);
}

// Abre a sessão com os usuários (um por empresa) que provaram ser a pessoa — por senha ou pelo Google
export function startSession(res: Response, email: string, users: { id: string; nome: string; papel: string; tenantId: string }[]) {
  const token = randomBytes(32).toString('base64url');
  sessions.set(hashToken(token), {
    nome: users[0].nome,
    email,
    memberships: users.map((u) => ({ usuarioId: u.id, tenantId: u.tenantId, papel: u.papel })),
    expiresAt: Date.now() + SESSION_MS,
  });
  setCookie(res, token, SESSION_MS);
}

// Rotas protegidas: sem sessão válida, 401
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = readSession(req);
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
    const keys = [`email:${email}`, `ip:${req.ip}`];
    if (!email || !senha || senha.length > 200) {
      res.status(400).json({ error: 'Informe e-mail e senha.' });
      return;
    }
    if (tooManyAttempts(keys)) {
      res.status(429).json({ error: 'Muitas tentativas. Tente de novo em alguns minutos.' });
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
        recordFailure(keys);
        // Mesma mensagem para e-mail inexistente e senha errada (não revela quem tem conta)
        res.status(401).json({ error: 'E-mail ou senha incorretos.' });
        return;
      }
      startSession(res, email, matched);
      res.json({ nome: matched[0].nome, empresas: matched.length });
    } catch (error) {
      console.error('[auth] falha no login:', (error as Error).message);
      res.status(500).json({ error: 'Não foi possível entrar agora.' });
    }
  });

  router.post('/logout', (req, res) => {
    const token = parseCookie(req.headers.cookie)[COOKIE];
    if (token) sessions.delete(hashToken(token));
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
