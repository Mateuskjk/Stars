// Servidor MCP do LexÁgile: o Claude (site/app e Claude Code) consulta e altera o LexÁgile em nome de quem conectou.
// Toda ferramenta usa as MESMAS regras das telas: só vê o que a pessoa vê (visibilidade), só grava o que o cargo
// dela permite (Observador não grava) e toda mudança de status entra no histórico de movimentações.
import { Request, Response, Router, json } from 'express';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { db } from './db';
import { Session } from './auth';
import { meOf, seesAllTenants, tenantsOf, visibleActivitySql, visibleProjectSql } from './data';
import { HttpError, ensureSchema } from './migration';
import { applyActivity, createActivity, visibleActivity } from './writes';
import { SCOPE, appUrl, consentRouter, oauthProvider, sessionFromAuth } from './mcp-oauth';

const STATUS = ['RASCUNHO', 'PRONTO', 'EM_EXECUCAO', 'EM_REVISAO', 'CONCLUIDO'] as const;
const STATUS_TEXT = 'RASCUNHO (para refinar), PRONTO (pronta / a fazer), EM_EXECUCAO (em andamento), EM_REVISAO (em revisão), CONCLUIDO (finalizada)';

// ---------- Ajudantes ----------
const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

async function run<T>(s: Session | null, fn: (s: Session) => Promise<T>) {
  if (!s) return fail('Conecte o LexÁgile de novo (acesso vencido).');
  try {
    return ok(await fn(s));
  } catch (error) {
    if (error instanceof HttpError) return fail(error.message);
    console.error('[mcp] ferramenta falhou:', (error as Error).message);
    return fail('Não foi possível concluir agora. Tente de novo.');
  }
}

async function tx<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await db().connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

// Empresas da pessoa; "empresa" aceita nome (ou parte) ou sigla. Com uma empresa só, ela é o padrão.
async function empresas(s: Session) {
  const { rows } = await db().query<{ id: string; nome: string; sigla: string }>(
    `select id, nome, sigla from "Tenant" where id = any($1::text[]) and ativo order by nome`,
    [tenantsOf(s)],
  );
  return rows;
}

async function resolveTenant(s: Session, empresa?: string) {
  const list = await empresas(s);
  if (!empresa) {
    if (list.length === 1) return list[0];
    throw new HttpError(400, `Informe a empresa. Opções: ${list.map((e) => e.nome).join(', ')}.`);
  }
  const term = empresa.trim().toLowerCase();
  const found = list.find((e) => e.sigla.toLowerCase() === term) ?? list.find((e) => e.nome.toLowerCase() === term) ?? list.find((e) => e.nome.toLowerCase().includes(term));
  if (!found) throw new HttpError(404, `Empresa "${empresa}" não encontrada. Opções: ${list.map((e) => e.nome).join(', ')}.`);
  return found;
}

async function userByEmail(tenantId: string, email: string) {
  const { rows } = await db().query<{ id: string }>(
    `select id from "Usuario" where lower(email) = $1 and "tenantId" = $2 and situacao = 'ATIVO' and "removidoEm" is null limit 1`,
    [email.trim().toLowerCase(), tenantId],
  );
  if (!rows[0]) throw new HttpError(404, `Ninguém com o e-mail ${email} nessa empresa.`);
  return rows[0].id;
}

// "#12" ou "12" (número dentro da empresa) ou o id interno
async function resolveActivityId(s: Session, ref: string, empresa?: string) {
  const numero = ref.trim().replace(/^#/, '');
  if (!/^\d+$/.test(numero)) return ref.trim();
  const tenant = await resolveTenant(s, empresa);
  const { rows } = await db().query<{ id: string }>(`select id from "Atividade" where "tenantId" = $1 and numero = $2`, [tenant.id, Number(numero)]);
  if (!rows[0]) throw new HttpError(404, `Atividade #${numero} não encontrada em ${tenant.nome}.`);
  return rows[0].id;
}

async function visibleWhere(s: Session) {
  const installed = await ensureSchema();
  return {
    sql: visibleActivitySql(installed),
    projects: visibleProjectSql(installed),
    params: [tenantsOf(s), meOf(s), await seesAllTenants(s, installed)] as unknown[],
  };
}

const ACTIVITY_COLUMNS = `a.id, a.numero, a.titulo, a.status, a.prioridade, a.estimativa, to_char(a.prazo, 'YYYY-MM-DD') as prazo,
  a."bloqueioMotivo" is not null as bloqueada, a.tags, r.nome as responsavel, r.email as "responsavelEmail",
  p.nome as projeto, sp.nome as sprint, t.nome as empresa, a."atualizadoEm"`;
const ACTIVITY_JOINS = `left join "Usuario" r on r.id = a."responsavelId" left join "Projeto" p on p.id = a."projetoId"
  left join "Sprint" sp on sp.id = a."sprintId" join "Tenant" t on t.id = a."tenantId"`;

// ---------- Ferramentas ----------
export function buildServer(s: Session | null) {
  const server = new McpServer({ name: 'lexagile', version: '1.0.0' }, {
    instructions:
      'LexÁgile: gestão ágil do time (sprints de 7 dias úteis, backlog, kanbans por setor e projeto). ' +
      'As ferramentas agem como a pessoa que conectou e só enxergam o que ela pode ver. ' +
      'Atividades são identificadas por "#número" (dentro da empresa) ou pelo id. Status: ' + STATUS_TEXT + '. ' +
      'Antes de criar ou alterar algo, confirme com a pessoa o que será feito.',
  });
  const read = { readOnlyHint: true, openWorldHint: false };
  const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

  server.registerTool('quem_sou_eu', { title: 'Quem está conectado', description: 'Mostra a pessoa conectada e as empresas e cargos dela no LexÁgile.', annotations: read }, () =>
    run(s, async (s) => {
      const list = await empresas(s);
      return { nome: s.nome, email: s.email, empresas: list.map((e) => ({ nome: e.nome, sigla: e.sigla, cargo: s.memberships.find((m) => m.tenantId === e.id)?.papel })) };
    }),
  );

  server.registerTool(
    'listar_projetos',
    { title: 'Listar projetos', description: 'Projetos da empresa, com situação, setor, responsável e prazo.', inputSchema: { empresa: z.string().optional().describe('Nome ou sigla da empresa'), incluir_arquivados: z.boolean().optional() }, annotations: read },
    ({ empresa, incluir_arquivados }) =>
      run(s, async (s) => {
        const tenant = await resolveTenant(s, empresa);
        const v = await visibleWhere(s);
        const { rows } = await db().query(
          `select p.numero, p.nome, p.situacao, p.arquivado, se.nome as setor, u.nome as responsavel,
                  to_char(p."dataInicio", 'YYYY-MM-DD') as inicio, to_char(p."previsaoTermino", 'YYYY-MM-DD') as previsao, p.progresso
             from "Projeto" p left join "Setor" se on se.id = p."setorId" left join "Usuario" u on u.id = p."responsavelId"
            where ${v.projects} and p."tenantId" = $4 and ($5 or not p.arquivado) order by p.arquivado, p.nome`,
          [...v.params, tenant.id, !!incluir_arquivados],
        );
        return { empresa: tenant.nome, projetos: rows };
      }),
  );

  server.registerTool(
    'sprint_ativa',
    { title: 'Sprint ativa', description: 'A sprint ativa da empresa: período e quantas atividades (que você vê) estão em cada status.', inputSchema: { empresa: z.string().optional() }, annotations: read },
    ({ empresa }) =>
      run(s, async (s) => {
        const tenant = await resolveTenant(s, empresa);
        const installed = await ensureSchema();
        const { rows } = await db().query(
          `select s.id, s.nome ${installed ? `, to_char(p.inicio, 'YYYY-MM-DD') as inicio, to_char(p.fim, 'YYYY-MM-DD') as fim` : ''}
             from "Sprint" s ${installed ? 'left join lexagile.sprint_periodo p on p."sprintId" = s.id' : ''}
            where s."tenantId" = $1 and s.situacao = 'ATIVA' limit 1`,
          [tenant.id],
        );
        if (!rows[0]) return { empresa: tenant.nome, sprint: null, aviso: 'Não há sprint ativa nesta empresa.' };
        const v = await visibleWhere(s);
        const { rows: porStatus } = await db().query(
          `select a.status, count(*)::int as atividades from "Atividade" a where ${v.sql} and a."sprintId" = $4 and a."arquivadoEm" is null group by 1`,
          [...v.params, rows[0].id],
        );
        return { empresa: tenant.nome, sprint: rows[0], atividadesPorStatus: porStatus };
      }),
  );

  server.registerTool(
    'buscar_atividades',
    {
      title: 'Buscar atividades',
      description: 'Procura atividades que você pode ver, com filtros. Sem filtros, traz as atualizadas mais recentemente.',
      inputSchema: {
        texto: z.string().optional().describe('Parte do título'),
        empresa: z.string().optional(),
        projeto: z.string().optional().describe('Parte do nome do projeto'),
        sprint_ativa: z.boolean().optional().describe('Só as da sprint ativa'),
        status: z.enum(STATUS).optional(),
        responsavel: z.string().optional().describe('Nome ou e-mail (ou parte)'),
        bloqueadas: z.boolean().optional(),
        atrasadas: z.boolean().optional().describe('Prazo vencido e não concluídas'),
        limite: z.number().int().min(1).max(100).optional(),
      },
      annotations: read,
    },
    (a) =>
      run(s, async (s) => {
        const v = await visibleWhere(s);
        const params = [...v.params];
        let where = `${v.sql} and a."arquivadoEm" is null and a.tipo = 'NORMAL'`;
        if (a.empresa) where += ` and a."tenantId" = $${params.push((await resolveTenant(s, a.empresa)).id)}`;
        if (a.texto) where += ` and a.titulo ilike '%' || $${params.push(a.texto)} || '%'`;
        if (a.projeto) where += ` and p.nome ilike '%' || $${params.push(a.projeto)} || '%'`;
        if (a.sprint_ativa) where += ` and sp.situacao = 'ATIVA'`;
        if (a.status) where += ` and a.status = $${params.push(a.status)}`;
        if (a.responsavel) where += ` and (r.nome ilike '%' || $${params.push(a.responsavel)} || '%' or r.email ilike '%' || $${params.length} || '%')`;
        if (a.bloqueadas) where += ` and a."bloqueioMotivo" is not null`;
        if (a.atrasadas) where += ` and a.prazo < now() and a.status <> 'CONCLUIDO'`;
        const { rows } = await db().query(
          `select ${ACTIVITY_COLUMNS} from "Atividade" a ${ACTIVITY_JOINS} where ${where} order by a."atualizadoEm" desc limit ${a.limite ?? 30}`,
          params,
        );
        return { total: rows.length, atividades: rows };
      }),
  );

  server.registerTool(
    'ver_atividade',
    { title: 'Ver atividade', description: 'Detalhes de uma atividade: descrição, subtarefas, comentários e histórico de status.', inputSchema: { atividade: z.string().describe('"#número" ou id'), empresa: z.string().optional() }, annotations: read },
    ({ atividade, empresa }) =>
      run(s, async (s) => {
        const id = await resolveActivityId(s, atividade, empresa);
        const v = await visibleWhere(s);
        const { rows } = await db().query(
          `select ${ACTIVITY_COLUMNS}, a.descricao, a."criteriosAceite", a."bloqueioMotivo",
                  coalesce((select json_agg(json_build_object('titulo', st.titulo, 'feito', st.feito) order by st.ordem) from "Subtarefa" st where st."atividadeId" = a.id), '[]') as subtarefas,
                  coalesce((select json_agg(json_build_object('autor', u.nome, 'texto', c.texto, 'em', c."criadoEm") order by c."criadoEm") from "Comentario" c left join "Usuario" u on u.id = c."autorId" where c."atividadeId" = a.id), '[]') as comentarios,
                  coalesce((select json_agg(json_build_object('de', tr.de, 'para', tr.para, 'em', tr.em) order by tr.em desc) from "Transicao" tr where tr."atividadeId" = a.id), '[]') as historico
             from "Atividade" a ${ACTIVITY_JOINS} where ${v.sql} and a.id = $4`,
          [...v.params, id],
        );
        if (!rows[0]) throw new HttpError(404, 'Atividade não encontrada (ou você não tem acesso a ela).');
        return rows[0];
      }),
  );

  server.registerTool(
    'listar_pessoas',
    { title: 'Listar pessoas', description: 'Pessoas ativas da empresa (nome, e-mail e cargo) — use o e-mail para atribuir atividades.', inputSchema: { empresa: z.string().optional() }, annotations: read },
    ({ empresa }) =>
      run(s, async (s) => {
        const tenant = await resolveTenant(s, empresa);
        const { rows } = await db().query(
          `select nome, email, papel as cargo from "Usuario" where "tenantId" = $1 and situacao = 'ATIVO' and "removidoEm" is null order by nome`,
          [tenant.id],
        );
        return { empresa: tenant.nome, pessoas: rows };
      }),
  );

  server.registerTool(
    'movimentacoes',
    { title: 'Movimentações', description: 'Mudanças de status das atividades desde uma data (para a Daily).', inputSchema: { desde: z.string().optional().describe('Data/hora ISO; padrão: últimas 24h') }, annotations: read },
    ({ desde }) =>
      run(s, async (s) => {
        const since = desde && !isNaN(Date.parse(desde)) ? new Date(desde) : new Date(Date.now() - 86_400_000);
        const v = await visibleWhere(s);
        const { rows } = await db().query(
          `select a.numero, a.titulo, tr.de, tr.para, tr.em, r.nome as responsavel, p.nome as projeto
             from "Transicao" tr join "Atividade" a on a.id = tr."atividadeId" ${ACTIVITY_JOINS.replace('join "Tenant" t on t.id = a."tenantId"', '')}
            where ${v.sql} and tr.em >= $4 order by tr.em desc limit 200`,
          [...v.params, since.toISOString()],
        );
        return { desde: since.toISOString(), movimentacoes: rows };
      }),
  );

  // ----- Escrita -----
  server.registerTool(
    'criar_atividade',
    {
      title: 'Criar atividade',
      description: 'Cria uma atividade. Sem responsável, fica com você. Pode ir para um projeto e/ou direto para a sprint ativa.',
      inputSchema: {
        empresa: z.string().optional(),
        titulo: z.string().min(1).max(300),
        descricao: z.string().max(20000).optional(),
        projeto: z.string().optional().describe('Nome do projeto (exato ou parte)'),
        responsavel_email: z.string().optional(),
        prazo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('AAAA-MM-DD'),
        na_sprint_ativa: z.boolean().optional(),
      },
      annotations: write,
    },
    (a) =>
      run(s, async (s) => {
        const tenant = await resolveTenant(s, a.empresa);
        const body: Record<string, unknown> = { tenantId: tenant.id, titulo: a.titulo };
        if (a.descricao) body['descricao'] = a.descricao;
        if (a.prazo) body['prazo'] = a.prazo;
        if (a.responsavel_email) body['responsavelId'] = await userByEmail(tenant.id, a.responsavel_email);
        if (a.projeto) {
          const v = await visibleWhere(s);
          const { rows } = await db().query<{ id: string; nome: string }>(
            `select p.id, p.nome from "Projeto" p where ${v.projects} and p."tenantId" = $4 and not p.arquivado and p.nome ilike '%' || $5 || '%'
              order by (lower(p.nome) = lower($5)) desc limit 2`,
            [...v.params, tenant.id, a.projeto],
          );
          if (!rows[0]) throw new HttpError(404, `Projeto "${a.projeto}" não encontrado.`);
          body['projetoId'] = rows[0].id;
        }
        if (a.na_sprint_ativa) {
          const { rows } = await db().query<{ id: string }>(`select id from "Sprint" where "tenantId" = $1 and situacao = 'ATIVA' limit 1`, [tenant.id]);
          if (!rows[0]) throw new HttpError(409, 'Não há sprint ativa nesta empresa.');
          body['sprintId'] = rows[0].id;
          body['status'] = 'PRONTO';
        }
        const id = await tx((client) => createActivity(client, s, body));
        const { rows } = await db().query<{ numero: number }>(`select numero from "Atividade" where id = $1`, [id]);
        console.log(`[mcp] ${s.email} criou a atividade #${rows[0]?.numero} em ${tenant.nome}`);
        return { criada: true, numero: rows[0]?.numero, id, empresa: tenant.nome };
      }),
  );

  server.registerTool(
    'mover_atividade',
    { title: 'Mudar status', description: `Muda o status de uma atividade (entra no histórico). Status: ${STATUS_TEXT}.`, inputSchema: { atividade: z.string().describe('"#número" ou id'), status: z.enum(STATUS), empresa: z.string().optional() }, annotations: write },
    (a) =>
      run(s, async (s) => {
        const id = await resolveActivityId(s, a.atividade, a.empresa);
        await tx(async (client) => applyActivity(client, s, id, await visibleActivity(client, s, id), { status: a.status }));
        console.log(`[mcp] ${s.email} moveu ${a.atividade} para ${a.status}`);
        return { atualizada: true, atividade: a.atividade, status: a.status };
      }),
  );

  server.registerTool(
    'atualizar_atividade',
    {
      title: 'Atualizar atividade',
      description: 'Altera título, descrição, prazo, responsável ou bloqueio de uma atividade (só os campos informados).',
      inputSchema: {
        atividade: z.string().describe('"#número" ou id'),
        empresa: z.string().optional(),
        titulo: z.string().min(1).max(300).optional(),
        descricao: z.string().max(20000).optional(),
        prazo: z.string().optional().describe('AAAA-MM-DD, ou vazio para tirar o prazo'),
        responsavel_email: z.string().optional(),
        bloqueada: z.boolean().optional(),
      },
      annotations: write,
    },
    (a) =>
      run(s, async (s) => {
        const id = await resolveActivityId(s, a.atividade, a.empresa);
        await tx(async (client) => {
          const tenantId = await visibleActivity(client, s, id);
          const body: Record<string, unknown> = {};
          if (a.titulo !== undefined) body['titulo'] = a.titulo;
          if (a.descricao !== undefined) body['descricao'] = a.descricao;
          if (a.prazo !== undefined) body['prazo'] = a.prazo;
          if (a.bloqueada !== undefined) body['bloqueado'] = a.bloqueada;
          if (a.responsavel_email) body['responsavelId'] = await userByEmail(tenantId, a.responsavel_email);
          if (!Object.keys(body).length) throw new HttpError(400, 'Nada para alterar.');
          await applyActivity(client, s, id, tenantId, body);
        });
        console.log(`[mcp] ${s.email} atualizou ${a.atividade}`);
        return { atualizada: true, atividade: a.atividade };
      }),
  );

  server.registerTool(
    'comentar_atividade',
    { title: 'Comentar', description: 'Adiciona um comentário (em seu nome) numa atividade.', inputSchema: { atividade: z.string(), texto: z.string().min(1).max(5000), empresa: z.string().optional() }, annotations: write },
    (a) =>
      run(s, async (s) => {
        const id = await resolveActivityId(s, a.atividade, a.empresa);
        await tx(async (client) => applyActivity(client, s, id, await visibleActivity(client, s, id), { comentario: a.texto }));
        return { comentado: true, atividade: a.atividade };
      }),
  );

  return server;
}

// ---------- Rotas ----------
export function mcpRouters() {
  const router = Router();
  const base = appUrl();
  const resource = new URL(`${base}/mcp`);

  // OAuth: /.well-known/oauth-authorization-server, /.well-known/oauth-protected-resource/mcp, /register, /authorize, /token, /revoke
  router.use(mcpAuthRouter({ provider: oauthProvider, issuerUrl: new URL(base), resourceServerUrl: resource, scopesSupported: [SCOPE], resourceName: 'LexÁgile' }));
  router.use(consentRouter());

  // MCP (Streamable HTTP, sem estado: funciona em funções da Vercel). Sem token válido, 401 com o endereço do login.
  const auth = requireBearerAuth({ verifier: oauthProvider, requiredScopes: [SCOPE], resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resource) });
  router.post('/mcp', auth, json({ limit: '1mb' }), async (req: Request, res: Response) => {
    const server = buildServer(sessionFromAuth(req.auth));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('[mcp] erro:', (error as Error).message);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Erro interno.' }, id: null });
    }
  });
  // Sem estado: não há fluxo de eventos (GET) nem sessão para encerrar (DELETE)
  router.all('/mcp', (_req, res) => void res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Use POST.' }, id: null }));
  return router;
}
