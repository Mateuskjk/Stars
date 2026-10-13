// Migração / instalação do LexÁgile sobre o banco existente — roda SOMENTE no servidor e só para admins (papel DONO).
// O que já existe no banco (empresas, setores, usuários, projetos, atividades) é gravado nas tabelas dele.
// O que o banco não tem fica no schema "lexagile", sem mexer nas tabelas do outro sistema:
//   empresa_config (visibilidade), setor_membro (membros/gestores do setor),
//   atividade_setor (atividades gerais do setor), sprint_periodo (datas da sprint) e migracao_log.
import { randomBytes } from 'node:crypto';
import { NextFunction, Request, Response, Router, json } from 'express';
import type { PoolClient } from 'pg';
import { db, ddl } from './db';
import { Session, requireAuth, saveSession } from './auth';

export const INSTALL_SQL = `
create schema if not exists lexagile;
create table if not exists lexagile.empresa_config (
  "tenantId" text primary key references public."Tenant"(id) on delete cascade,
  visibilidade text not null default 'TUDO' check (visibilidade in ('TUDO', 'RESTRITA'))
);
create table if not exists lexagile.setor_membro (
  "setorId" text not null references public."Setor"(id) on delete cascade,
  "usuarioId" text not null references public."Usuario"(id) on delete cascade,
  gestor boolean not null default false,
  primary key ("setorId", "usuarioId")
);
create table if not exists lexagile.atividade_setor (
  "atividadeId" text primary key references public."Atividade"(id) on delete cascade,
  "setorId" text not null references public."Setor"(id) on delete cascade
);
create table if not exists lexagile.sprint_periodo (
  "sprintId" text primary key references public."Sprint"(id) on delete cascade,
  inicio date not null,
  fim date not null check (fim >= inicio)
);
create table if not exists lexagile.atividade_front (
  "atividadeId" text primary key references public."Atividade"(id) on delete cascade,
  "colunaBacklog" text,
  "colunaSprint" text
);
-- Dados das telas que o banco atual não tem (descrição e site da empresa, descrição e colunas do setor,
-- foco da equipe, status exato e documentos do projeto), por registro
create table if not exists lexagile.extra (
  tipo text not null,
  "registroId" text not null,
  "tenantId" text not null references public."Tenant"(id) on delete cascade,
  dados jsonb not null default '{}',
  primary key (tipo, "registroId")
);
alter table lexagile.atividade_front add column if not exists planning text;
create table if not exists lexagile.migracao_log (
  id bigserial primary key,
  em timestamptz not null default now(),
  "usuarioId" text,
  acao text not null,
  detalhe text not null default ''
);
do $$ begin
  -- o schema não é exposto pela API REST do Supabase; ainda assim, nada para os papéis públicos
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on schema lexagile from anon, authenticated;
  end if;
end $$;
`;

// Id no formato cuid (25 caracteres) usado pelo banco
export function newId() {
  const random = BigInt('0x' + randomBytes(12).toString('hex')).toString(36).padStart(16, '0').slice(-16);
  return ('c' + Date.now().toString(36).padStart(8, '0') + random).slice(0, 25);
}

export async function isInstalled() {
  const { rows } = await db().query(`select to_regclass('lexagile.sprint_periodo') is not null as ok`);
  return rows[0].ok as boolean;
}

// Banco já preparado: garante as tabelas do LexÁgile que vieram em versões mais novas (só cria o que falta,
// e só dentro do schema "lexagile"). Roda uma vez por processo.
let schemaReady: Promise<boolean> | null = null;
export function ensureSchema() {
  schemaReady ??= isInstalled()
    .then(async (installed) => {
      if (installed) await ddl(INSTALL_SQL);
      return installed;
    })
    .catch((error) => {
      schemaReady = null; // tenta de novo na próxima chamada
      throw error;
    });
  return schemaReady;
}

// Cria a empresa; quem cria vira Dono dela (cópia do seu usuário, com a mesma senha)
export async function createTenant(client: PoolClient, s: Session, data: { nome: string; sigla: string; cor?: string }) {
  const source = s.memberships.find((m) => m.papel === 'DONO');
  if (!source) throw new HttpError(403, 'Só administradores criam empresas.');
  const id = newId();
  await client.query(
    `insert into "Tenant" (id, nome, sigla, cor, ordem) values ($1, $2, $3, $4, (select coalesce(max(ordem), 0) + 1 from "Tenant"))`,
    [id, data.nome, data.sigla, COLORS.includes(data.cor ?? '') ? data.cor : 'sky'],
  );
  const usuarioId = newId();
  await client.query(
    `insert into "Usuario" (id, nome, email, papel, situacao, "avatarUrl", "senhaHash", "senhaAtualizadaEm", tema, "tenantId")
     select $1, nome, email, 'DONO', 'ATIVO', "avatarUrl", "senhaHash", "senhaAtualizadaEm", tema, $2 from "Usuario" where id = $3`,
    [usuarioId, id, source.usuarioId],
  );
  s.memberships.push({ usuarioId, tenantId: id, papel: 'DONO' });
  await saveSession(s);
  return id;
}

const adminTenants = (s: Session) => s.memberships.filter((m) => m.papel === 'DONO').map((m) => m.tenantId);
const adminUserIn = (s: Session, tenantId: string) => s.memberships.find((m) => m.tenantId === tenantId && m.papel === 'DONO')?.usuarioId;

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!adminTenants(req.session!).length) {
    res.status(403).json({ error: 'Só administradores (papel Dono) podem fazer a migração.' });
    return;
  }
  next();
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const text = (v: unknown, max = 120) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s || s.length > max) throw new HttpError(400, 'Preencha os campos obrigatórios (até ' + max + ' caracteres).');
  return s;
};
const optionalId = (v: unknown) => (v === null || v === '' || v === undefined ? null : text(v, 60));
const isoDate = (v: unknown) => {
  const s = text(v, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s))) throw new HttpError(400, 'Data inválida.');
  return s;
};
const COLORS = ['sky', 'emerald', 'amber', 'rose', 'violet'];

// Garante que o registro existe e é de uma empresa onde a pessoa é admin; devolve o tenantId
async function tenantOf(client: PoolClient, table: string, id: string, s: Session) {
  const { rows } = await client.query(`select "tenantId" from "${table}" where id = $1`, [id]);
  const tenantId: string | undefined = rows[0]?.tenantId;
  if (!tenantId || !adminTenants(s).includes(tenantId)) throw new HttpError(404, 'Registro não encontrado.');
  return tenantId;
}

// Cada ação roda numa transação e fica registrada em lexagile.migracao_log
function action(name: string, handler: (client: PoolClient, req: Request, s: Session) => Promise<{ result?: unknown; detail: string }>) {
  return async (req: Request, res: Response) => {
    const client = await db().connect();
    try {
      await client.query('begin');
      const { result, detail } = await handler(client, req, req.session!);
      if (await isInstalled()) {
        await client.query(`insert into lexagile.migracao_log ("usuarioId", acao, detalhe) values ($1, $2, $3)`, [
          req.session!.memberships[0].usuarioId,
          name,
          detail,
        ]);
      }
      await client.query('commit');
      console.log(`[migracao] ${req.session!.email} · ${name} · ${detail}`);
      res.json(result ?? { ok: true });
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      if (error instanceof HttpError) {
        res.status(error.status).json({ error: error.message });
      } else if ((error as { code?: string }).code === '23505') {
        res.status(409).json({ error: 'Já existe um registro com esse nome/número nesta empresa.' });
      } else {
        console.error('[migracao]', name, (error as Error).message);
        res.status(500).json({ error: 'Não foi possível salvar. Nada foi alterado.' });
      }
    } finally {
      client.release();
    }
  };
}

export function migrationRouter() {
  const router = Router();
  router.use(requireAuth, requireAdmin, json({ limit: '200kb' }));

  router.get('/status', async (req, res) => {
    try {
      res.json({ instalado: await isInstalled(), empresas: adminTenants(req.session!).length });
    } catch (error) {
      console.error('[migracao] status', (error as Error).message);
      res.status(500).json({ error: 'Não foi possível falar com o banco.' });
    }
  });

  router.post(
    '/instalar',
    action('instalar', async (client) => {
      await client.query(INSTALL_SQL);
      schemaReady = null; // a API de dados volta a conferir o schema
      return { detail: 'schema lexagile criado/atualizado' };
    }),
  );

  // Tudo que as etapas da migração mostram, das empresas onde a pessoa é admin
  router.get('/dados', async (req, res) => {
    const tenants = adminTenants(req.session!);
    try {
      const installed = await isInstalled();
      const q = (sql: string) => db().query(sql, [tenants]).then((r) => r.rows);
      const [empresas, setores, usuarios, projetos, sprints, atividades] = await Promise.all([
        q(`select t.id, t.nome, t.sigla, t.cor, t.ativo,
                  ${installed ? `coalesce(ec.visibilidade, 'TUDO')` : `'TUDO'`} as visibilidade
             from "Tenant" t ${installed ? `left join lexagile.empresa_config ec on ec."tenantId" = t.id` : ''}
            where t.id = any($1::text[]) order by t.ordem, t.nome`),
        q(`select s.id, s.nome, s.cor, s."tenantId",
                  ${installed ? `coalesce((select json_agg(json_build_object('usuarioId', m."usuarioId", 'gestor', m.gestor)) from lexagile.setor_membro m where m."setorId" = s.id), '[]')` : `'[]'::json`} as membros
             from "Setor" s where s."tenantId" = any($1::text[]) and not s.arquivado order by s.ordem, s.nome`),
        q(`select id, nome, email, papel, situacao, "tenantId" from "Usuario"
            where "tenantId" = any($1::text[]) and "removidoEm" is null order by nome`),
        q(`select id, numero, nome, "setorId", "tenantId", "responsavelId", situacao, arquivado, "dataInicio", "previsaoTermino"
             from "Projeto" where "tenantId" = any($1::text[]) order by arquivado, nome`),
        q(`select s.id, s.nome, s.situacao, s."tenantId",
                  ${installed ? `to_char(p.inicio, 'YYYY-MM-DD') as inicio, to_char(p.fim, 'YYYY-MM-DD') as fim` : `null as inicio, null as fim`}
             from "Sprint" s ${installed ? `left join lexagile.sprint_periodo p on p."sprintId" = s.id` : ''}
            where s."tenantId" = any($1::text[]) order by s.nome desc`),
        q(`select a.id, a.numero, a.titulo, a.status, a."tenantId", a."projetoId", a."sprintId", a."responsavelId",
                  ${installed ? `g."setorId"` : 'null'} as "setorGeral"
             from "Atividade" a ${installed ? `left join lexagile.atividade_setor g on g."atividadeId" = a.id` : ''}
            where a."tenantId" = any($1::text[]) and a."arquivadoEm" is null and a.tipo = 'NORMAL'
            order by a."atualizadoEm" desc limit 3000`),
      ]);
      res.json({ instalado: installed, empresas, setores, usuarios, projetos, sprints, atividades });
    } catch (error) {
      console.error('[migracao] dados', (error as Error).message);
      res.status(500).json({ error: 'Não foi possível carregar os dados.' });
    }
  });

  // ---------- Empresas ----------
  router.post(
    '/empresas',
    action('criar empresa', async (client, req, s) => {
      const nome = text(req.body?.nome, 80);
      const sigla = text(req.body?.sigla, 4).toUpperCase();
      const id = await createTenant(client, s, { nome, sigla, cor: req.body?.cor });
      return { result: { id }, detail: `${nome} (${sigla})` };
    }),
  );

  router.patch(
    '/empresas/:id',
    action('visibilidade', async (client, req, s) => {
      const id = String(req.params['id']);
      if (!adminTenants(s).includes(id)) throw new HttpError(404, 'Empresa não encontrada.');
      if (!(await isInstalled())) throw new HttpError(409, 'Prepare o banco (etapa 1) antes.');
      const visibilidade = req.body?.visibilidade === 'RESTRITA' ? 'RESTRITA' : 'TUDO';
      await client.query(
        `insert into lexagile.empresa_config ("tenantId", visibilidade) values ($1, $2)
         on conflict ("tenantId") do update set visibilidade = excluded.visibilidade`,
        [id, visibilidade],
      );
      return { detail: `${id} → ${visibilidade}` };
    }),
  );

  // ---------- Setores ----------
  router.post(
    '/setores',
    action('criar setor', async (client, req, s) => {
      const tenantId = text(req.body?.tenantId, 60);
      if (!adminTenants(s).includes(tenantId)) throw new HttpError(404, 'Empresa não encontrada.');
      const nome = text(req.body?.nome, 60);
      const cor = COLORS.includes(req.body?.cor) ? req.body.cor : 'sky';
      const id = newId();
      await client.query(
        `insert into "Setor" (id, nome, cor, ordem, "tenantId", "atualizadoEm")
         values ($1, $2, $3, (select coalesce(max(ordem), 0) + 1 from "Setor" where "tenantId" = $4), $4, now())`,
        [id, nome, cor, tenantId],
      );
      return { result: { id }, detail: nome };
    }),
  );

  // Membros e gestores do setor (substitui a lista inteira)
  router.put(
    '/setores/:id/membros',
    action('membros do setor', async (client, req, s) => {
      const setorId = String(req.params['id']);
      const tenantId = await tenantOf(client, 'Setor', setorId, s);
      if (!(await isInstalled())) throw new HttpError(409, 'Prepare o banco (etapa 1) antes.');
      const membros: { usuarioId: string; gestor: boolean }[] = Array.isArray(req.body?.membros) ? req.body.membros.slice(0, 500) : [];
      const ids = membros.map((m) => text(m.usuarioId, 60));
      const { rows } = await client.query(`select count(*)::int as n from "Usuario" where id = any($1::text[]) and "tenantId" = $2`, [ids, tenantId]);
      if (rows[0].n !== new Set(ids).size) throw new HttpError(400, 'Só usuários da mesma empresa podem entrar no setor.');
      await client.query(`delete from lexagile.setor_membro where "setorId" = $1`, [setorId]);
      for (const m of membros) {
        await client.query(`insert into lexagile.setor_membro ("setorId", "usuarioId", gestor) values ($1, $2, $3) on conflict do nothing`, [
          setorId,
          m.usuarioId,
          !!m.gestor,
        ]);
      }
      return { detail: `${setorId}: ${membros.length} membros` };
    }),
  );

  // ---------- Usuários: dar acesso a outra empresa (cópia do usuário, mesma senha) ----------
  router.post(
    '/usuarios',
    action('usuário em empresa', async (client, req, s) => {
      const usuarioId = text(req.body?.usuarioId, 60);
      const tenantId = text(req.body?.tenantId, 60);
      await tenantOf(client, 'Usuario', usuarioId, s);
      if (!adminTenants(s).includes(tenantId)) throw new HttpError(404, 'Empresa não encontrada.');
      const papel = ['DONO', 'GESTOR', 'ATENDENTE', 'OBSERVADOR'].includes(req.body?.papel) ? req.body.papel : 'ATENDENTE';
      const { rows: dup } = await client.query(
        `select 1 from "Usuario" u join "Usuario" o on lower(o.email) = lower(u.email)
          where u.id = $1 and o."tenantId" = $2 and o."removidoEm" is null`,
        [usuarioId, tenantId],
      );
      if (dup.length) throw new HttpError(409, 'Essa pessoa já está nessa empresa.');
      const id = newId();
      await client.query(
        `insert into "Usuario" (id, nome, email, papel, situacao, "avatarUrl", "senhaHash", "senhaAtualizadaEm", tema, "tenantId")
         select $1, nome, email, $2, 'ATIVO', "avatarUrl", "senhaHash", "senhaAtualizadaEm", tema, $3 from "Usuario" where id = $4`,
        [id, papel, tenantId, usuarioId],
      );
      return { result: { id }, detail: `${usuarioId} → ${tenantId} (${papel})` };
    }),
  );

  // ---------- Projetos ----------
  router.post(
    '/projetos',
    action('criar projeto', async (client, req, s) => {
      const tenantId = text(req.body?.tenantId, 60);
      if (!adminTenants(s).includes(tenantId)) throw new HttpError(404, 'Empresa não encontrada.');
      const nome = text(req.body?.nome, 120);
      const responsavelId = optionalId(req.body?.responsavelId) ?? adminUserIn(s, tenantId)!;
      const setorId = optionalId(req.body?.setorId);
      if ((await tenantOf(client, 'Usuario', responsavelId, s)) !== tenantId) throw new HttpError(400, 'Responsável de outra empresa.');
      if (setorId && (await tenantOf(client, 'Setor', setorId, s)) !== tenantId) throw new HttpError(400, 'Setor de outra empresa.');
      const inicio = isoDate(req.body?.dataInicio);
      const fim = req.body?.previsaoTermino ? isoDate(req.body.previsaoTermino) : null;
      const id = newId();
      await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [tenantId]); // número único por empresa (max + 1)
      await client.query(
        `insert into "Projeto" (id, numero, nome, "dataInicio", "previsaoTermino", "responsavelId", "setorId", "tenantId", "atualizadoEm")
         values ($1, (select coalesce(max(numero), 0) + 1 from "Projeto" where "tenantId" = $7), $2, $3, $4, $5, $6, $7, now())`,
        [id, nome, inicio, fim, responsavelId, setorId, tenantId],
      );
      return { result: { id }, detail: nome };
    }),
  );

  router.patch(
    '/projetos/:id',
    action('setor do projeto', async (client, req, s) => {
      const id = String(req.params['id']);
      const tenantId = await tenantOf(client, 'Projeto', id, s);
      const setorId = optionalId(req.body?.setorId);
      if (setorId && (await tenantOf(client, 'Setor', setorId, s)) !== tenantId) throw new HttpError(400, 'Setor de outra empresa.');
      await client.query(`update "Projeto" set "setorId" = $1, "atualizadoEm" = now() where id = $2`, [setorId, id]);
      return { detail: `${id} → setor ${setorId ?? 'nenhum'}` };
    }),
  );

  // ---------- Atividades (em lote): projeto, sprint e "geral do setor" ----------
  router.patch(
    '/atividades',
    action('atividades', async (client, req, s) => {
      const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 1000).map((v: unknown) => text(v, 60)) : [];
      if (!ids.length) throw new HttpError(400, 'Selecione ao menos uma atividade.');
      const { rows } = await client.query(`select distinct "tenantId" from "Atividade" where id = any($1::text[])`, [ids]);
      if (rows.length !== 1 || !adminTenants(s).includes(rows[0].tenantId)) throw new HttpError(400, 'Selecione atividades de uma empresa só.');
      const tenantId: string = rows[0].tenantId;
      const changes: string[] = [];

      if ('projetoId' in (req.body ?? {})) {
        const projetoId = optionalId(req.body.projetoId);
        if (projetoId && (await tenantOf(client, 'Projeto', projetoId, s)) !== tenantId) throw new HttpError(400, 'Projeto de outra empresa.');
        await client.query(`update "Atividade" set "projetoId" = $1, "atualizadoEm" = now() where id = any($2::text[])`, [projetoId, ids]);
        changes.push(`projeto ${projetoId ?? 'nenhum'}`);
      }
      if ('sprintId' in (req.body ?? {})) {
        const sprintId = optionalId(req.body.sprintId);
        if (sprintId && (await tenantOf(client, 'Sprint', sprintId, s)) !== tenantId) throw new HttpError(400, 'Sprint de outra empresa.');
        await client.query(`update "Atividade" set "sprintId" = $1, "atualizadoEm" = now() where id = any($2::text[])`, [sprintId, ids]);
        changes.push(`sprint ${sprintId ?? 'nenhuma'}`);
      }
      if ('setorGeral' in (req.body ?? {})) {
        if (!(await isInstalled())) throw new HttpError(409, 'Prepare o banco (etapa 1) antes.');
        const setorId = optionalId(req.body.setorGeral);
        if (setorId && (await tenantOf(client, 'Setor', setorId, s)) !== tenantId) throw new HttpError(400, 'Setor de outra empresa.');
        if (setorId) {
          await client.query(
            `insert into lexagile.atividade_setor ("atividadeId", "setorId") select unnest($1::text[]), $2
             on conflict ("atividadeId") do update set "setorId" = excluded."setorId"`,
            [ids, setorId],
          );
        } else {
          await client.query(`delete from lexagile.atividade_setor where "atividadeId" = any($1::text[])`, [ids]);
        }
        changes.push(`geral do setor ${setorId ?? 'nenhum'}`);
      }
      if (!changes.length) throw new HttpError(400, 'Nada para alterar.');
      return { detail: `${ids.length} atividades: ${changes.join(', ')}` };
    }),
  );

  // ---------- Sprints: período (início e fim) ----------
  router.put(
    '/sprints/:id/periodo',
    action('período da sprint', async (client, req, s) => {
      const id = String(req.params['id']);
      await tenantOf(client, 'Sprint', id, s);
      if (!(await isInstalled())) throw new HttpError(409, 'Prepare o banco (etapa 1) antes.');
      const inicio = isoDate(req.body?.inicio);
      const fim = isoDate(req.body?.fim);
      if (fim < inicio) throw new HttpError(400, 'O fim precisa ser depois do início.');
      await client.query(
        `insert into lexagile.sprint_periodo ("sprintId", inicio, fim) values ($1, $2, $3)
         on conflict ("sprintId") do update set inicio = excluded.inicio, fim = excluded.fim`,
        [id, inicio, fim],
      );
      return { detail: `${id}: ${inicio} → ${fim}` };
    }),
  );

  return router;
}
