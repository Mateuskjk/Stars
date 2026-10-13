// API pública v1 (somente leitura) + registro de tokens e trilha de acesso — roda SOMENTE no servidor.
import { createHash, randomUUID } from 'node:crypto';
import { NextFunction, Request, RequestHandler, Response, Router, json } from 'express';

type Access = 'none' | 'view' | 'edit';
type Feature = 'dashboards' | 'chat' | 'projects' | 'daily' | 'backlog' | 'planning' | 'notes' | 'settings';

interface TokenOwner {
  issuer: string; // e-mail do Admin que gerou: o token só lê o retrato enviado por ele (dados que ele já vê)
  memberId: number;
  name: string;
  role: string;
  permissions: Record<Feature, Access>;
}

// O token em si nunca fica guardado: só o hash SHA-256 (se vazar a memória, não vaza o token)
const tokens = new Map<string, TokenOwner>();
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

// Retrato dos dados enviado pelo app (sem segredos), um por pessoa logada: ninguém lê nem sobrescreve o de outro.
// ponytail: até a API ler direto do banco (filtrando pela empresa do token), ela lê o retrato de quem emitiu o token
const snapshots = new Map<string, Record<string, unknown[]>>();
const EMPTY: Record<string, unknown[]> = { projects: [], activities: [], sprints: [], teams: [], members: [] };

const FEATURES: Feature[] = ['dashboards', 'chat', 'projects', 'daily', 'backlog', 'planning', 'notes', 'settings'];
const ROLES = ['admin', 'supervisor', 'member'];
// Só as funcionalidades conhecidas, só "view"/"edit"; qualquer outra coisa vira "none"
function cleanPermissions(raw: unknown) {
  const p = (typeof raw === 'object' && raw ? raw : {}) as Record<string, unknown>;
  return Object.fromEntries(FEATURES.map((f) => [f, p[f] === 'view' || p[f] === 'edit' ? p[f] : 'none'])) as Record<Feature, Access>;
}

// Trilha de acesso à API (vai para a tela de Auditorias)
export interface AccessEntry {
  id: string;
  issuer: string;
  at: string;
  actor: string;
  method: string;
  path: string;
  status: number;
  ip: string;
}
const accessLog: AccessEntry[] = [];
const LOG_LIMIT = 1000;

// Limite simples por token: 60 requisições por minuto
const RATE_LIMIT = 60;
const usage = new Map<string, { windowStart: number; count: number }>();

export function rateLimited(key: string, now = Date.now()) {
  const current = usage.get(key);
  if (!current || now - current.windowStart >= 60_000) {
    usage.set(key, { windowStart: now, count: 1 });
    return false;
  }
  current.count++;
  return current.count > RATE_LIMIT;
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
  router.use((req: Request, res: Response, next: NextFunction) => {
    const header = req.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const owner = token ? tokens.get(hashToken(token)) : undefined;
    res.on('finish', () => {
      accessLog.unshift({
        id: randomUUID(),
        issuer: owner?.issuer ?? '',
        at: new Date().toISOString(),
        actor: owner?.name ?? (token ? 'Token inválido' : 'Sem token'),
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        ip: req.ip ?? '',
      });
      accessLog.length = Math.min(accessLog.length, LOG_LIMIT);
    });
    if (!owner) return void res.status(401).json({ error: 'Envie um token válido: Authorization: Bearer stars_…' });
    if (rateLimited(hashToken(token))) return void res.status(429).json({ error: 'Limite de 60 requisições por minuto atingido.' });
    res.locals['owner'] = owner;
    next();
  });

  router.get('/me', (_req, res) => void res.json(res.locals['owner']));

  for (const endpoint of ENDPOINTS.filter((e) => e.collection)) {
    const expressPath = endpoint.path.replace(/\{(\w+)\}/g, ':$1');
    router.get(expressPath, (req, res) => {
      const owner = res.locals['owner'] as TokenOwner;
      // Nega por padrão: só passa com permissão explícita de ver ou editar
      if (endpoint.feature && !['view', 'edit'].includes(owner.permissions[endpoint.feature])) {
        return void res.status(403).json({ error: `Sem permissão para ${endpoint.tag.toLowerCase()}.` });
      }
      const items = ((snapshots.get(owner.issuer) ?? EMPTY)[endpoint.collection!] ?? []) as { id: number; status?: string }[];
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
const sameToken = (req: Request, owner: TokenOwner) => owner.issuer === issuerOf(req) && owner.memberId === Number(req.params['memberId']);

export function publicApiInternalRouter() {
  const router = Router();
  router.use(json({ limit: '2mb' }));

  // Registrar token (o app gera; aqui guardamos só o hash + quem emitiu + permissões limpas)
  router.put('/tokens/:memberId', onlyOwner, (req, res) => {
    const memberId = Number(req.params['memberId']);
    const token = String(req.body?.token ?? '');
    if (!Number.isInteger(memberId) || !/^stars_[0-9a-f]{48}$/.test(token)) return void res.status(400).json({ error: 'Token inválido.' });
    for (const [hash, owner] of tokens) if (sameToken(req, owner)) tokens.delete(hash); // o token anterior deixa de valer
    tokens.set(hashToken(token), {
      issuer: issuerOf(req),
      memberId,
      name: String(req.body?.name ?? '').slice(0, 120),
      role: ROLES.includes(req.body?.role) ? req.body.role : 'member',
      permissions: cleanPermissions(req.body?.permissions),
    });
    res.json({ ok: true });
  });

  // Revogar (ou atualizar permissões, se o cargo/permissões mudaram)
  router.delete('/tokens/:memberId', onlyOwner, (req, res) => {
    for (const [hash, owner] of tokens) if (sameToken(req, owner)) tokens.delete(hash);
    res.json({ ok: true });
  });

  router.patch('/tokens/:memberId', onlyOwner, (req, res) => {
    for (const owner of tokens.values()) {
      if (!sameToken(req, owner)) continue;
      if (req.body?.name !== undefined) owner.name = String(req.body.name).slice(0, 120);
      if (ROLES.includes(req.body?.role)) owner.role = req.body.role;
      if (req.body?.permissions !== undefined) owner.permissions = cleanPermissions(req.body.permissions);
    }
    res.json({ ok: true });
  });

  // Cada pessoa grava só o próprio retrato (o que ela já vê no app)
  router.put('/snapshot', (req, res) => {
    const body = req.body ?? {};
    const pick = (key: string) => (Array.isArray(body[key]) ? body[key].slice(0, 5000) : []);
    snapshots.set(issuerOf(req), { projects: pick('projects'), activities: pick('activities'), sprints: pick('sprints'), teams: pick('teams'), members: pick('members') });
    res.json({ ok: true });
  });

  // Trilha de acesso: só dos tokens que este Admin gerou
  router.get('/api-access', onlyOwner, (req, res) => void res.json(accessLog.filter((e) => e.issuer === issuerOf(req)).map(({ issuer: _i, ...e }) => e)));

  return router;
}
