// API de dados (leitura) — roda SOMENTE no servidor.
// O servidor conecta como dono do banco (passa por cima do RLS do Supabase), então TODA consulta aqui
// filtra pelas empresas (tenantId) da sessão e aplica a regra de visibilidade das atividades.
import { Request, Response, Router } from 'express';
import { db, parseJson } from './db';
import { Session, isSuperAdmin, requireAuth } from './auth';
import { ensureSchema, isInstalled } from './schema';

export const tenantsOf = (s: Session) => s.memberships.map((m) => m.tenantId);
export const meOf = (s: Session) => s.memberships.map((m) => m.usuarioId);

// Visibilidade das atividades (mesma regra do front, agora garantida no servidor):
// vê tudo da empresa: DONO e GESTOR, ou empresa com visibilidade 'TUDO';
// os demais veem as próprias (responsável ou criador), as compartilhadas com eles, as da equipe
// (equipes ativas com visão compartilhada) e tudo dos setores de que fazem parte
// (atividades gerais do setor e atividades dos projetos do setor).
export const SECTOR_MANAGER_SQL = `
    or a.id in (
      select g."atividadeId" from lexagile.atividade_setor g
        join lexagile.setor_membro sm on sm."setorId" = g."setorId"
       where sm."usuarioId" = any($2::text[])
    )
    or a."projetoId" in (
      select p.id from "Projeto" p
        join lexagile.setor_membro sm on sm."setorId" = p."setorId"
       where sm."usuarioId" = any($2::text[])
    )`;

export const visibleActivitySql = (installed: boolean) => `
  a."tenantId" = any($1::text[]) and (
    a."tenantId" = any($3::text[])
    or a."responsavelId" = any($2::text[])
    or a."criadoPorId" = any($2::text[])
    or exists (select 1 from unnest($2::text[]) m where a."compartilhadoCom" like '%"' || m || '"%')
    or a."responsavelId" in (
      select outro."usuarioId" from "EquipeMembro" eu
        join "Equipe" e on e.id = eu."equipeId" and e.ativa and e."visaoCompartilhada"
        join "EquipeMembro" outro on outro."equipeId" = e.id
       where eu."usuarioId" = any($2::text[])
    )${installed ? SECTOR_MANAGER_SQL : ''}
  )`;

// Projetos visíveis (alias "p"; mesmos parâmetros: $1 empresas, $2 usuários, $3 empresas em que vê tudo).
// Atendente/Observador numa empresa restrita: os do seu setor, da sua equipe, os que é responsável e os que têm
// alguma atividade que ele vê. Usada na tela, nos extras, ao criar atividade e no MCP.
export const visibleProjectSql = (installed: boolean) => `
  p."tenantId" = any($1::text[]) and (
    p."tenantId" = any($3::text[])
    or p."responsavelId" = any($2::text[])
    or p."equipeId" in (select em."equipeId" from "EquipeMembro" em join "Equipe" eq on eq.id = em."equipeId" and eq.ativa
                         where em."usuarioId" = any($2::text[]))
    or exists (select 1 from "Atividade" a where a."projetoId" = p.id and ${visibleActivitySql(installed)})${
      installed ? `
    or p."setorId" in (select "setorId" from lexagile.setor_membro where "usuarioId" = any($2::text[]))` : ''
    }
  )`;

export async function seesAllTenants(s: Session, installed: boolean) {
  const { rows } = await db().query<{ id: string }>(
    installed
      ? `select t.id from "Tenant" t left join lexagile.empresa_config ec on ec."tenantId" = t.id
          where t.id = any($1::text[]) and coalesce(ec.visibilidade, t.visibilidade) = 'TUDO'`
      : `select id from "Tenant" where id = any($1::text[]) and visibilidade = 'TUDO'`,
    [tenantsOf(s)],
  );
  const open = new Set(rows.map((r) => r.id));
  return s.memberships.filter((m) => m.papel === 'DONO' || m.papel === 'GESTOR' || open.has(m.tenantId)).map((m) => m.tenantId);
}

// Cada rota: consulta + tratamento de erro sem vazar detalhes do banco
function route(handler: (req: Request, s: Session) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      res.json(await handler(req, req.session!));
    } catch (error) {
      console.error('[data]', req.path, (error as Error).message);
      res.status(500).json({ error: 'Não foi possível carregar os dados.' });
    }
  };
}

const str = (v: unknown) => (typeof v === 'string' && v.length <= 100 ? v : undefined);

export function dataRouter() {
  const router = Router();
  router.use(requireAuth);

  // Empresas da pessoa logada (sem token/hash da empresa)
  router.get(
    '/empresas',
    route(async (_req, s) => {
      const { rows } = await db().query(
        `select id, nome, sigla, cor, ordem, "avatarUrl", ativo, visibilidade, "fusoHorario"
           from "Tenant" where id = any($1::text[]) order by ordem, nome`,
        [tenantsOf(s)],
      );
      return rows;
    }),
  );

  // Empresas suspensas (Tenant.ativo = false): não entram na sessão, então vêm à parte para a tela Arquivo.
  // Só as em que a pessoa (pelo e-mail) é Admin; o superadmin vê todas.
  router.get(
    '/empresas/suspensas',
    route(async (_req, s) => {
      const { rows } = await db().query(
        `select t.id, t.nome, t.sigla, t."avatarUrl",
                (select count(*)::int from "Usuario" u where u."tenantId" = t.id and u.situacao = 'ATIVO' and u."removidoEm" is null) as membros
           from "Tenant" t
          where not t.ativo and ($2 or exists (select 1 from "Usuario" u where u."tenantId" = t.id and lower(u.email) = $1 and u.papel = 'DONO' and u.situacao = 'ATIVO' and u."removidoEm" is null))
          order by t.nome`,
        [s.email.trim().toLowerCase(), isSuperAdmin(s)],
      );
      return rows;
    }),
  );

  // Setores: quem não vê a empresa toda (Atendente/Observador) só recebe os setores de que faz parte
  router.get(
    '/setores',
    route(async (_req, s) => {
      const { rows } = await db().query(
        (await isInstalled())
          ? `select s.id, s.nome, s.cor, s.ordem, s."tenantId",
                    coalesce((select json_agg(json_build_object('usuarioId', m."usuarioId", 'gestor', m.gestor))
                                from lexagile.setor_membro m where m."setorId" = s.id), '[]') as membros
               from "Setor" s where s."tenantId" = any($1::text[]) and not s.arquivado
                and (s."tenantId" = any($2::text[])
                     or exists (select 1 from lexagile.setor_membro m where m."setorId" = s.id and m."usuarioId" = any($3::text[])))
              order by s.ordem, s.nome`
          : `select id, nome, cor, ordem, "tenantId", '[]'::json as membros from "Setor"
              where "tenantId" = any($1::text[]) and not arquivado order by ordem, nome`,
        (await isInstalled()) ? [tenantsOf(s), await seesAllTenants(s, true), meOf(s)] : [tenantsOf(s)],
      );
      return rows;
    }),
  );

  // Membros das mesmas empresas. Nunca devolve senhaHash, googleSub ou ids externos.
  router.get(
    '/usuarios',
    route(async (_req, s) => {
      const { rows } = await db().query(
        `select id, nome, email, papel, situacao, "avatarUrl", "tenantId", "ultimoAcessoEm", "convidadoEm"
           from "Usuario" where "tenantId" = any($1::text[]) and "removidoEm" is null order by nome`,
        [tenantsOf(s)],
      );
      return rows;
    }),
  );

  router.get(
    '/equipes',
    route(async (_req, s) => {
      const { rows } = await db().query(
        `select e.id, e.nome, e.ativa, e."visaoCompartilhada", e."tenantId",
                coalesce(array_agg(m."usuarioId") filter (where m."usuarioId" is not null), '{}') as membros
           from "Equipe" e left join "EquipeMembro" m on m."equipeId" = e.id
          where e."tenantId" = any($1::text[]) and e.ativa group by e.id order by e.nome`,
        [tenantsOf(s)],
      );
      return rows;
    }),
  );

  // Projetos: idem — Atendente/Observador só recebe os do seu setor, da sua equipe, os que é responsável
  // e os que têm alguma atividade que ele vê
  router.get(
    '/projetos',
    route(async (_req, s) => {
      const installed = await isInstalled();
      const { rows } = await db().query(
        `select id, numero, nome, descricao, objetivo, "dataInicio", "previsaoTermino", status, situacao, prioridade,
                progresso, "responsavelId", "equipeId", "setorId", "tenantId", arquivado,
                orcamento, "custoPrevisto", "custoRealizado", "pontosEntrega", links, "criadoEm", "atualizadoEm"
           from "Projeto" p where ${visibleProjectSql(installed)}
          order by numero nulls last, nome`,
        [tenantsOf(s), meOf(s), await seesAllTenants(s, installed)],
      );
      return rows.map((p) => ({ ...p, pontosEntrega: parseJson(p.pontosEntrega, []), links: parseJson(p.links, []) }));
    }),
  );

  router.get(
    '/sprints',
    route(async (_req, s) => {
      const { rows } = await db().query(
        (await isInstalled())
          ? `select s.id, s.nome, s.situacao, s.capacidade, s."tenantId",
                    to_char(p.inicio, 'YYYY-MM-DD') as inicio, to_char(p.fim, 'YYYY-MM-DD') as fim
               from "Sprint" s left join lexagile.sprint_periodo p on p."sprintId" = s.id
              where s."tenantId" = any($1::text[]) order by s.nome desc`
          : `select id, nome, situacao, capacidade, "tenantId", null as inicio, null as fim
               from "Sprint" where "tenantId" = any($1::text[]) order by nome desc`,
        [tenantsOf(s)],
      );
      return rows;
    }),
  );

  // Movimentações dos cartões (histórico de status) desde uma data — Daily. ?desde=ISO (padrão: últimas 24h)
  router.get(
    '/movimentos',
    route(async (req, s) => {
      const desdeParam = str(req.query['desde']);
      const desde = desdeParam && !isNaN(Date.parse(desdeParam)) ? new Date(desdeParam) : new Date(Date.now() - 86_400_000);
      const installed = await isInstalled();
      const { rows } = await db().query(
        `select t.de, t.para, t.em, a.titulo, a."responsavelId", p.nome as projeto
           from "Transicao" t
           join "Atividade" a on a.id = t."atividadeId"
           left join "Projeto" p on p.id = a."projetoId"
          where ${visibleActivitySql(installed)} and t.em >= $4
          order by t.em desc limit 500`,
        [tenantsOf(s), meOf(s), await seesAllTenants(s, installed), desde.toISOString()],
      );
      return rows;
    }),
  );

  // Dados das telas que o banco atual não tem (schema lexagile): descrição da empresa, colunas do setor…
  router.get(
    '/extras',
    route(async (_req, s) => {
      if (!(await ensureSchema())) return [];
      // Extras de projeto e de setor seguem a mesma visibilidade dos projetos e setores
      const { rows } = await db().query(
        `select e.tipo, e."registroId", e.dados from lexagile.extra e
          where e."tenantId" = any($1::text[]) and e.tipo <> 'daily' and (
            e.tipo not in ('projeto', 'setor')
            or (e.tipo = 'projeto' and exists (select 1 from "Projeto" p where p.id = e."registroId" and ${visibleProjectSql(true)}))
            or (e.tipo = 'setor' and (e."tenantId" = any($3::text[])
                or exists (select 1 from lexagile.setor_membro m where m."setorId" = e."registroId" and m."usuarioId" = any($2::text[]))))
          )`,
        [tenantsOf(s), meOf(s), await seesAllTenants(s, true)],
      );
      return rows;
    }),
  );

  // Atividades visíveis para quem está logado. Filtros opcionais: ?sprintId= &projetoId= &arquivadas=1
  router.get(
    '/atividades',
    route(async (req, s) => {
      const installed = await ensureSchema();
      const params: unknown[] = [tenantsOf(s), meOf(s), await seesAllTenants(s, installed)];
      let where = visibleActivitySql(installed);
      const sprintId = str(req.query['sprintId']);
      const projetoId = str(req.query['projetoId']);
      if (sprintId) where += ` and a."sprintId" = $${params.push(sprintId)}`;
      if (projetoId) where += ` and a."projetoId" = $${params.push(projetoId)}`;
      if (req.query['arquivadas'] === 'somente') where += ` and a."arquivadoEm" is not null`; // tela Arquivo
      else if (req.query['arquivadas'] !== '1') where += ` and a."arquivadoEm" is null`;
      const { rows } = await db().query(
        `select a.id, a.numero, a.titulo, a.descricao, a.status, a.tipo, a.prioridade, a.estimativa, a.prazo,
                a."criteriosAceite", a.observacao, a."bloqueioMotivo", a.aceito, a.tags, a."compartilhadoCom",
                a."responsavelId", a."criadoPorId", a."sprintId", a."projetoId", a."paiId", a."tenantId",
                a."iniciadoEm", a."arquivadoEm", a."arquivadoTipo", a."criadoEm", a."atualizadoEm",
                coalesce((select json_agg(json_build_object('id', st.id, 'titulo', st.titulo, 'feito', st.feito) order by st.ordem)
                            from "Subtarefa" st where st."atividadeId" = a.id), '[]') as subtarefas,
                coalesce((select json_agg(json_build_object('id', c.id, 'autor', u.nome, 'texto', c.texto, 'em', c."criadoEm") order by c."criadoEm")
                            from "Comentario" c left join "Usuario" u on u.id = c."autorId" where c."atividadeId" = a.id), '[]') as comentarios,
                ${installed ? `(select g."setorId" from lexagile.atividade_setor g where g."atividadeId" = a.id)` : 'null'} as "setorGeral",
                ${installed ? `(select x."colunaBacklog" from lexagile.atividade_front x where x."atividadeId" = a.id)` : 'null'} as "colunaBacklog",
                ${installed ? `(select x."colunaSprint" from lexagile.atividade_front x where x."atividadeId" = a.id)` : 'null'} as "colunaSprint",
                ${installed ? `(select x.planning from lexagile.atividade_front x where x."atividadeId" = a.id)` : 'null'} as planning
           from "Atividade" a where ${where}
          order by a."atualizadoEm" desc limit 2000`,
        params,
      );
      return rows.map((a) => ({ ...a, tags: parseJson(a.tags, []), compartilhadoCom: parseJson(a.compartilhadoCom, []) }));
    }),
  );

  return router;
}
