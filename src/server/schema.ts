// Schema próprio do LexÁgile ("lexagile") sobre o banco existente — roda SOMENTE no servidor.
// O que o banco não tem fica no schema "lexagile", sem mexer nas tabelas do outro sistema:
//   empresa_config (visibilidade), setor_membro (membros/gestores do setor),
//   atividade_setor (atividades gerais do setor) e sprint_periodo (datas da sprint).
import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { db, ddl, onDbReset } from './db';
import { Session, saveSession } from './auth';

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
onDbReset(() => {
  schemaReady = null;
});
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

const COLORS = ['sky', 'emerald', 'amber', 'rose', 'violet'];

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
