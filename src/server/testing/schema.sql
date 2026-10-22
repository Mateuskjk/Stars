-- Estrutura (sem dados) das tabelas do sistema atual usadas pelo LexÁgile, para os testes de autorização.
-- Gerado a partir do catálogo do banco (somente leitura). Regenerar se o outro sistema mudar o schema.


create table "Tenant" (
  "id" text not null,
  "nome" text not null,
  "sigla" text not null,
  "cor" text not null default 'sky'::text,
  "ordem" integer not null default 0,
  "avatarUrl" text,
  "ativo" boolean not null default true,
  "fusoHorario" text not null default 'America/Sao_Paulo'::text,
  "visibilidade" text not null default 'TUDO'::text,
  "tokenHash" text,
  "tokenPrefixo" text,
  "tokenCriadoEm" timestamp(3) without time zone,
  primary key (id)
);

create table "Usuario" (
  "id" text not null,
  "nome" text not null,
  "email" text,
  "papel" text not null default 'ATENDENTE'::text,
  "situacao" text not null default 'ATIVO'::text,
  "avatarUrl" text,
  "senhaHash" text,
  "senhaAtualizadaEm" timestamp(3) without time zone,
  "presenca" text not null default 'AUTOMATICO'::text,
  "ultimoAcessoEm" timestamp(3) without time zone,
  "convidadoEm" timestamp(3) without time zone,
  "conviteAbertoEm" timestamp(3) without time zone,
  "removidoEm" timestamp(3) without time zone,
  "tenantId" text not null,
  "idExterno" text,
  "origemExterna" text,
  "senhaHashLegado" text,
  "tema" text not null default 'ESCURO'::text,
  "googleSub" text,
  primary key (id)
);
CREATE UNIQUE INDEX "Usuario_tenantId_origemExterna_idExterno_key" ON "Usuario" USING btree ("tenantId", "origemExterna", "idExterno");

create table "Setor" (
  "id" text not null,
  "nome" text not null,
  "cor" text not null default 'sky'::text,
  "ordem" integer not null default 0,
  "arquivado" boolean not null default false,
  "tenantId" text not null,
  "criadoEm" timestamp(3) without time zone not null default CURRENT_TIMESTAMP,
  "atualizadoEm" timestamp(3) without time zone not null,
  primary key (id)
);
CREATE UNIQUE INDEX "Setor_tenantId_nome_key" ON "Setor" USING btree ("tenantId", nome);

create table "Equipe" (
  "id" text not null,
  "nome" text not null,
  "ativa" boolean not null default true,
  "visaoCompartilhada" boolean not null default true,
  "tenantId" text not null,
  "criadoEm" timestamp(3) without time zone not null default CURRENT_TIMESTAMP,
  primary key (id)
);
CREATE UNIQUE INDEX "Equipe_tenantId_nome_key" ON "Equipe" USING btree ("tenantId", nome);

create table "EquipeMembro" (
  "equipeId" text not null,
  "usuarioId" text not null,
  primary key ("equipeId", "usuarioId")
);

create table "Projeto" (
  "id" text not null,
  "nome" text not null,
  "descricao" text not null default ''::text,
  "dataInicio" timestamp(3) without time zone not null,
  "previsaoTermino" timestamp(3) without time zone,
  "status" text not null default 'ATIVO'::text,
  "pontosEntrega" text not null default '[]'::text,
  "responsavelId" text not null,
  "equipeId" text,
  "tenantId" text not null,
  "criadoEm" timestamp(3) without time zone not null default CURRENT_TIMESTAMP,
  "atualizadoEm" timestamp(3) without time zone not null,
  "arquivado" boolean not null default false,
  "custoPrevisto" integer not null default 0,
  "custoRealizado" integer not null default 0,
  "links" text not null default '[]'::text,
  "notas" text not null default ''::text,
  "numero" integer,
  "objetivo" text not null default ''::text,
  "orcamento" integer not null default 0,
  "prioridade" text,
  "progresso" integer not null default 0,
  "setorId" text,
  "situacao" text not null default 'NAO_INICIADO'::text,
  primary key (id)
);
CREATE UNIQUE INDEX "Projeto_tenantId_numero_key" ON "Projeto" USING btree ("tenantId", numero);

create table "Sprint" (
  "id" text not null,
  "nome" text not null,
  "situacao" text not null default 'PREPARACAO'::text,
  "capacidade" integer,
  "tenantId" text not null,
  primary key (id)
);

create table "Atividade" (
  "id" text not null,
  "titulo" text not null,
  "descricao" text not null default ''::text,
  "tenantId" text not null,
  "status" text not null default 'RASCUNHO'::text,
  "estimativa" integer,
  "criteriosAceite" text not null default ''::text,
  "observacao" text not null default ''::text,
  "iniciadoEm" timestamp(3) without time zone,
  "bloqueioMotivo" text,
  "aceito" boolean not null default false,
  "pontosEntrega" text not null default '[]'::text,
  "compartilhadoCom" text not null default '[]'::text,
  "origemExterna" text,
  "idExterno" text,
  "statusExterno" text,
  "responsavelId" text,
  "sprintId" text,
  "projetoId" text,
  "criadoPorId" text,
  "tipo" text not null default 'NORMAL'::text,
  "paiId" text,
  "mapaX" integer,
  "mapaY" integer,
  "criadoEm" timestamp(3) without time zone not null default CURRENT_TIMESTAMP,
  "atualizadoEm" timestamp(3) without time zone not null,
  "prioridade" text,
  "arquivadoEm" timestamp(3) without time zone,
  "arquivadoMotivo" text,
  "arquivadoPorId" text,
  "arquivadoTipo" text,
  "numero" integer,
  "prazo" timestamp(3) without time zone,
  "tags" text not null default '[]'::text,
  primary key (id)
);
CREATE UNIQUE INDEX "Atividade_tenantId_origemExterna_idExterno_key" ON "Atividade" USING btree ("tenantId", "origemExterna", "idExterno");
CREATE UNIQUE INDEX "Atividade_tenantId_numero_key" ON "Atividade" USING btree ("tenantId", numero);

create table "Subtarefa" (
  "id" text not null,
  "titulo" text not null,
  "feito" boolean not null default false,
  "ordem" integer not null default 0,
  "atividadeId" text not null,
  primary key (id)
);

create table "Comentario" (
  "id" text not null,
  "atividadeId" text not null,
  "autorId" text,
  "texto" text not null,
  "criadoEm" timestamp(3) without time zone not null default CURRENT_TIMESTAMP,
  "editadoEm" timestamp(3) without time zone,
  primary key (id)
);

create table "Transicao" (
  "id" text not null,
  "regraId" text not null,
  "regraTitulo" text not null,
  "de" text not null,
  "para" text not null,
  "porque" text not null,
  "em" timestamp(3) without time zone not null default CURRENT_TIMESTAMP,
  "atividadeId" text not null,
  primary key (id)
);

-- Como no banco real: RLS ligado em todas, sem políticas (a API pública do Supabase não vê nada).
-- O acesso do lexagile_app vem das políticas de scripts/db-role.sql.
alter table "Tenant" enable row level security;
alter table "Usuario" enable row level security;
alter table "Setor" enable row level security;
alter table "Equipe" enable row level security;
alter table "EquipeMembro" enable row level security;
alter table "Projeto" enable row level security;
alter table "Sprint" enable row level security;
alter table "Atividade" enable row level security;
alter table "Subtarefa" enable row level security;
alter table "Comentario" enable row level security;
alter table "Transicao" enable row level security;

create table "Anotacao" (
  "id" text not null,
  "texto" text not null,
  "cor" text not null,
  "ordem" integer not null,
  "autorId" text not null references "Usuario"(id) on update cascade on delete cascade,
  "tenantId" text not null references "Tenant"(id) on update cascade on delete cascade,
  "criadoEm" timestamp without time zone not null,
  "atualizadoEm" timestamp without time zone not null,
  primary key (id)
);
create table "AnotacaoCompartilhada" (
  "anotacaoId" text not null references "Anotacao"(id) on update cascade on delete cascade,
  "usuarioId" text not null references "Usuario"(id) on update cascade on delete cascade,
  primary key ("anotacaoId", "usuarioId")
);
alter table "Anotacao" enable row level security;
alter table "AnotacaoCompartilhada" enable row level security;

create table "Anexo" (
  "id" text not null,
  "atividadeId" text not null references "Atividade"(id) on update cascade on delete cascade,
  "nome" text not null,
  "mime" text not null,
  "tamanho" integer not null,
  "conteudo" bytea not null,
  "enviadoPorId" text references "Usuario"(id) on update cascade on delete set null,
  "criadoEm" timestamp without time zone not null,
  primary key (id)
);
alter table "Anexo" enable row level security;
