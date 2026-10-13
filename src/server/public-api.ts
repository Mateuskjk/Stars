// API pública v1 (somente leitura) + registro de tokens e trilha de acesso — roda SOMENTE no servidor.
import { createHash, randomUUID } from 'node:crypto';
import { NextFunction, Request, RequestHandler, Response, Router, json } from 'express';
import { db } from './db';
import { hit } from './limits';

type Access = 'none' | 'view' | 'edit';
type Feature = 'dashboards' | 'chat' | 'projects' | 'daily' | 'backlog' | 'planning' | 'notes' | 'settings';

interface TokenOwner {
  issuer: string; // e-mail do Admin que gerou: o token só lê o retrato enviado por ele (dados que ele já vê)
  memberId: number;
  name: string;
  role: string;
  permissions: Record<Feature, Access>;
}

// Tudo no banco (schema lexagile): vale em todas as cópias do servidor na Vercel e sobrevive a reinícios.
// - api_token: o token em si nunca fica guardado, só o hash SHA-256
// - api_retrato: retrato dos dados enviado pelo app (sem segredos), um por pessoa logada: ninguém lê nem sobrescreve o de outro.
//   ponytail: até a API ler direto do banco (filtrando pela empresa do token), ela lê o retrato de quem emitiu o token
// - api_acesso: trilha de acesso (tela de Auditorias), guardada por 30 dias
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const EMPTY: Record<string, unknown[]> = { projects: [], activities: [], sprints: [], teams: [], members: [] };

let tables: Promise<unknown> | null = null;
const ensureTables = () =>
  (tables ??= db()
    .query(
      `create schema if not exists lexagile;
       create table if not exists lexagile.api_token ("tokenHash" text primary key, issuer text not null, "memberId" int not null,
         nome text not null, papel text not null, permissoes jsonb not null, "criadoEm" timestamptz not null default now());
       create table if not exists lexagile.api_retrato (issuer text primary key, dados jsonb not null, "atualizadoEm" timestamptz not null default now());
       create table if not exists lexagile.api_acesso (id text primary key, issuer text not null, em timestamptz not null default now(),
         ator text not null, metodo text not null, caminho text not null, status int not null, ip text not null);`,
    )
    .catch((error) => {
      tables = null;
      throw error;
    }));

async function ownerOfToken(token: string): Promise<TokenOwner | undefined> {
  await ensureTables();
  const { rows } = await db().query<TokenOwner>(
    `select issuer, "memberId", nome as name, papel as role, permissoes as permissions from lexagile.api_token where "tokenHash" = $1`,
    [hashToken(token)],
  );
  return rows[0];
}

const FEATURES: Feature[] = ['dashboards', 'chat', 'projects', 'daily', 'backlog', 'planning', 'notes', 'settings'];
const ROLES = ['admin', 'supervisor', 'member'];
// Só as funcionalidades conhecidas, só "view"/"edit"; qualquer outra coisa vira "none"
function cleanPermissions(raw: unknown) {
  const p = (typeof raw === 'object' && raw ? raw : {}) as Record<string, unknown>;
  return Object.fromEntries(FEATURES.map((f) => [f, p[f] === 'view' || p[f] === 'edit' ? p[f] : 'none'])) as Record<Feature, Access>;
}

// Limite por token: 60 requisições por minuto (contador no banco, vale em todas as cópias do servidor)
const RATE_LIMIT = 60;
export async function rateLimited(key: string) {
  return (await hit(`api:${key}`, 60)) > RATE_LIMIT;
}

// ---------- Endpoints documentados (fonte única da documentação e das rotas) ----------
interface Endpoint {
  path: string; // formato OpenAPI: /projects/{id}
  summary: string;
  description: string;
  tag: string;
  feature: Feature | null; // permissão exigida (null = só precisa de token válido)
  collection?: string; // coleção do retrato
  params?: { name: string; in: 'path' | 'query'; description: string; enum?: string[] }[];
  example: unknown;
}

export const ENDPOINTS: Endpoint[] = [
  {
    path: '/me',
    tag: 'Conta',
    summary: 'Quem é o dono do token',
    description: 'Retorna o membro dono do token e as permissões dele. Útil para testar a conexão.',
    feature: null,
    example: { memberId: 4, name: 'Diego Rocha', role: 'member', permissions: { projects: 'view', backlog: 'edit' } },
  },
  {
    path: '/projects',
    tag: 'Projetos',
    summary: 'Listar projetos',
    description: 'Todos os projetos cadastrados.',
    feature: 'projects',
    collection: 'projects',
    example: [{ id: 1, name: 'Redesign do site', status: 'in-progress', owner: 'Bruna Alves', company: 'Acme Ltda', team: 'Design' }],
  },
  {
    path: '/projects/{id}',
    tag: 'Projetos',
    summary: 'Detalhe de um projeto',
    description: 'Um projeto pelo id.',
    feature: 'projects',
    collection: 'projects',
    params: [{ name: 'id', in: 'path', description: 'Id do projeto' }],
    example: { id: 1, name: 'Redesign do site', description: 'Nova identidade visual e home', status: 'in-progress', costInitial: 40000 },
  },
  {
    path: '/activities',
    tag: 'Atividades',
    summary: 'Listar atividades do backlog',
    description: 'Atividades gerais do backlog. Filtre pela coluna com ?status=.',
    feature: 'backlog',
    collection: 'activities',
    params: [{ name: 'status', in: 'query', description: 'Coluna do backlog', enum: ['to-refine', 'refined', 'waiting', 'refinement-done', 'archived', 'canceled'] }],
    example: [{ id: 3, name: 'Política de férias 2027', status: 'refined', assignee: 'Felipe Costa', due: '2026-10-06', tags: ['RH'], locked: false }],
  },
  {
    path: '/activities/{id}',
    tag: 'Atividades',
    summary: 'Detalhe de uma atividade',
    description: 'Uma atividade do backlog pelo id.',
    feature: 'backlog',
    collection: 'activities',
    params: [{ name: 'id', in: 'path', description: 'Id da atividade' }],
    example: { id: 3, name: 'Política de férias 2027', description: 'Definir janelas e regras de aprovação.', subtasks: 0, comments: 1 },
  },
  {
    path: '/sprints',
    tag: 'Sprints',
    summary: 'Listar sprints',
    description: 'Sprints com período e status (active, closed, archived, canceled).',
    feature: 'planning',
    collection: 'sprints',
    params: [{ name: 'status', in: 'query', description: 'Status da sprint', enum: ['active', 'closed', 'archived', 'canceled'] }],
    example: [{ id: 12, name: 'Sprint 12', start: '2026-10-05', end: '2026-10-11', goal: 'Organizar processos internos do time', status: 'active' }],
  },
  {
    path: '/teams',
    tag: 'Equipes',
    summary: 'Listar equipes',
    description: 'Equipes com membros, projetos e atividades delegadas (por id).',
    feature: 'settings',
    collection: 'teams',
    example: [{ id: 1, name: 'Produto', focus: 'Experiência do cliente', memberIds: [1, 2, 3], projectIds: [1, 2], activityIds: [1, 4] }],
  },
  {
    path: '/members',
    tag: 'Membros',
    summary: 'Listar membros',
    description: 'Membros com cargo, empresa e status. E-mails e tokens não são expostos.',
    feature: 'settings',
    collection: 'members',
    example: [{ id: 1, name: 'Ana Souza', role: 'admin', company: 'Acme Ltda', status: 'active' }],
  },
];

export function openApiSpec(serverUrl: string) {
  const paths: Record<string, unknown> = {};
  for (const e of ENDPOINTS) {
    paths[e.path] = {
      get: {
        tags: [e.tag],
        summary: e.summary,
        description: e.description + (e.feature ? ` Exige a permissão “${e.feature}” (ver ou editar).` : ''),
        parameters: (e.params ?? []).map((p) => ({
          name: p.name,
          in: p.in,
          required: p.in === 'path',
          description: p.description,
          schema: p.enum ? { type: 'string', enum: p.enum } : { type: p.in === 'path' ? 'integer' : 'string' },
        })),
        responses: {
          200: { description: 'OK', content: { 'application/json': { example: e.example } } },
          401: { description: 'Token ausente ou inválido' },
          403: { description: 'O dono do token não tem permissão para este recurso' },
          404: { description: 'Não encontrado' },
          429: { description: 'Limite de 60 requisições por minuto atingido' },
        },
      },
    };
  }
  return {
    openapi: '3.0.3',
    info: { title: 'LexÁgile — API pública', version: '1.0.0', description: 'API somente leitura. Autentique com o token pessoal gerado em Configurações › Membros.' },
    servers: [{ url: serverUrl }],
    security: [{ bearerAuth: [] }],
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'Token pessoal: stars_…' } } },
    paths,
  };
}

// ---------- API v1 (com token) ----------
export function publicApiRouter() {
  const router = Router();

  router.get('/openapi.json', (req, res) => {
    res.json(openApiSpec(`${req.protocol}://${req.get('host')}/api/v1`));
  });

  // Autenticação + limite + trilha de acesso (inclusive das tentativas recusadas)
  router.use(async (req: Request, res: Response, next: NextFunction) => {
    const header = req.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    let owner: TokenOwner | undefined;
    try {
      owner = token ? await ownerOfToken(token) : undefined;
    } catch {
      return void res.status(503).json({ error: 'API indisponível agora. Tente de novo.' });
    }
    res.on('finish', () => {
      void db()
        .query(
          `insert into lexagile.api_acesso (id, issuer, ator, metodo, caminho, status, ip) values ($1, $2, $3, $4, $5, $6, $7)`,
          [randomUUID(), owner?.issuer ?? '', owner?.name ?? (token ? 'Token inválido' : 'Sem token'), req.method, req.originalUrl.split('?')[0].slice(0, 300), res.statusCode, req.ip ?? ''],
        )
        .then(() => (Math.random() < 0.01 ? db().query(`delete from lexagile.api_acesso where em < now() - interval '30 days'`) : undefined))
        .catch(() => undefined);
    });
    if (!owner) return void res.status(401).json({ error: 'Envie um token válido: Authorization: Bearer stars_…' });
    if (await rateLimited(hashToken(token))) return void res.status(429).json({ error: 'Limite de 60 requisições por minuto atingido.' });
    res.locals['owner'] = owner;
    next();
  });

  router.get('/me', (_req, res) => void res.json(res.locals['owner']));

  for (const endpoint of ENDPOINTS.filter((e) => e.collection)) {
    const expressPath = endpoint.path.replace(/\{(\w+)\}/g, ':$1');
    router.get(expressPath, async (req, res) => {
      const owner = res.locals['owner'] as TokenOwner;
      // Nega por padrão: só passa com permissão explícita de ver ou editar
      if (endpoint.feature && !['view', 'edit'].includes(owner.permissions[endpoint.feature])) {
        return void res.status(403).json({ error: `Sem permissão para ${endpoint.tag.toLowerCase()}.` });
      }
      const { rows } = await db().query<{ dados: Record<string, unknown[]> }>(`select dados from lexagile.api_retrato where issuer = $1`, [owner.issuer]);
      const items = ((rows[0]?.dados ?? EMPTY)[endpoint.collection!] ?? []) as { id: number; status?: string }[];
      if (req.params['id'] !== undefined) {
        const item = items.find((i) => String(i.id) === req.params['id']);
        return void (item ? res.json(item) : res.status(404).json({ error: 'Não encontrado.' }));
      }
      const status = typeof req.query['status'] === 'string' ? req.query['status'] : null;
      res.json(status ? items.filter((i) => i.status === status) : items);
    });
  }

  router.use((_req, res) => void res.status(404).json({ error: 'Endpoint não encontrado. Veja /api/v1/openapi.json' }));
  return router;
}

// ---------- Rotas internas usadas pelo próprio app (montadas com login: requireAuth) ----------
const issuerOf = (req: Request) => req.session!.email.toLowerCase();
// Tokens e trilha de acesso são configuração: só Admin (Dono), e cada Admin só mexe nos tokens que ele gerou
const onlyOwner: RequestHandler = (req, res, next) =>
  req.session?.memberships.some((m) => m.papel === 'DONO') ? next() : void res.status(403).json({ error: 'Só Admin gerencia tokens de API.' });
const memberIdOf = (req: Request) => Number(req.params['memberId']);

// Erros de banco viram 503 sem detalhes
const safe = (handler: RequestHandler): RequestHandler => async (req, res, next) => {
  try {
    await ensureTables();
    await handler(req, res, next);
  } catch (error) {
    console.error('[api-publica]', req.method, req.path, (error as Error).message);
    res.status(503).json({ error: 'Não foi possível salvar agora. Tente de novo.' });
  }
};

export function publicApiInternalRouter() {
  const router = Router();
  router.use(json({ limit: '2mb' }));

  // Registrar token (o app gera; aqui guardamos só o hash + quem emitiu + permissões limpas). O anterior deixa de valer.
  router.put('/tokens/:memberId', onlyOwner, safe(async (req, res) => {
    const memberId = memberIdOf(req);
    const token = String(req.body?.token ?? '');
    if (!Number.isInteger(memberId) || !/^stars_[0-9a-f]{48}$/.test(token)) return void res.status(400).json({ error: 'Token inválido.' });
    await db().query(`delete from lexagile.api_token where issuer = $1 and "memberId" = $2`, [issuerOf(req), memberId]);
    await db().query(
      `insert into lexagile.api_token ("tokenHash", issuer, "memberId", nome, papel, permissoes) values ($1, $2, $3, $4, $5, $6)`,
      [hashToken(token), issuerOf(req), memberId, String(req.body?.name ?? '').slice(0, 120), ROLES.includes(req.body?.role) ? req.body.role : 'member', JSON.stringify(cleanPermissions(req.body?.permissions))],
    );
    res.json({ ok: true });
  }));

  // Revogar (ou atualizar permissões, se o cargo/permissões mudaram): só os tokens que este Admin gerou
  router.delete('/tokens/:memberId', onlyOwner, safe(async (req, res) => {
    await db().query(`delete from lexagile.api_token where issuer = $1 and "memberId" = $2`, [issuerOf(req), memberIdOf(req)]);
    res.json({ ok: true });
  }));

  router.patch('/tokens/:memberId', onlyOwner, safe(async (req, res) => {
    const sets: string[] = [];
    const values: unknown[] = [issuerOf(req), memberIdOf(req)];
    if (req.body?.name !== undefined) sets.push(`nome = ${values.push(String(req.body.name).slice(0, 120))}`);
    if (ROLES.includes(req.body?.role)) sets.push(`papel = ${values.push(req.body.role)}`);
    if (req.body?.permissions !== undefined) sets.push(`permissoes = ${values.push(JSON.stringify(cleanPermissions(req.body.permissions)))}`);
    if (sets.length) await db().query(`update lexagile.api_token set ${sets.join(', ')} where issuer = $1 and "memberId" = $2`, values);
    res.json({ ok: true });
  }));

  // Cada pessoa grava só o próprio retrato (o que ela já vê no app)
  router.put('/snapshot', safe(async (req, res) => {
    const body = req.body ?? {};
    const pick = (key: string) => (Array.isArray(body[key]) ? body[key].slice(0, 5000) : []);
    const dados = { projects: pick('projects'), activities: pick('activities'), sprints: pick('sprints'), teams: pick('teams'), members: pick('members') };
    await db().query(
      `insert into lexagile.api_retrato (issuer, dados, "atualizadoEm") values ($1, $2, now())
       on conflict (issuer) do update set dados = excluded.dados, "atualizadoEm" = now()`,
      [issuerOf(req), JSON.stringify(dados)],
    );
    res.json({ ok: true });
  }));

  // Trilha de acesso: só dos tokens que este Admin gerou (últimos 1000)
  router.get('/api-access', onlyOwner, safe(async (req, res) => {
    const { rows } = await db().query(
      `select id, to_char(em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at, ator as actor, metodo as method, caminho as path, status, ip
         from lexagile.api_acesso where issuer = $1 order by em desc limit 1000`,
      [issuerOf(req)],
    );
    res.json(rows);
  }));

  return router;
}
