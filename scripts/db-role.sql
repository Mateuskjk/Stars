-- Usuário restrito do LexÁgile (lexagile_app): o app deixa de usar o "postgres" (dono de tudo).
-- Rodar UMA vez no Supabase › SQL Editor (como postgres). Pode rodar de novo: é idempotente.
--
-- O que ele PODE: ler e gravar só as 15 tabelas do sistema atual que o LexÁgile usa (e só as operações
-- que o app faz em cada uma) e as tabelas do schema lexagile.
-- O que ele NÃO pode: criar/alterar/apagar tabelas (DDL), ignorar o RLS, criar usuários, ver as outras
-- tabelas do sistema atual (Documento, Anexo, Integracao, Notificacao…) nem os schemas do Supabase (auth, storage).

-- 1) O usuário. TROQUE a senha antes de rodar (gere uma forte: 32+ caracteres, sem aspas).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'lexagile_app') then
    create role lexagile_app login password 'TROQUE-ESTA-SENHA' nosuperuser nocreatedb nocreaterole noinherit nobypassrls connection limit 30;
  end if;
end $$;

-- 2) Sistema atual (schema public): só as tabelas e operações usadas
grant usage on schema public to lexagile_app;
grant select, insert on
  "Tenant", "Usuario", "Setor", "Equipe", "EquipeMembro", "Projeto", "Sprint", "Atividade",
  "Subtarefa", "Comentario", "Favorito", "Transicao", "Canal", "CanalMembro", "Mensagem"
  to lexagile_app;
grant update on "Tenant", "Usuario", "Setor", "Equipe", "Projeto", "Sprint", "Atividade" to lexagile_app;
grant delete on "EquipeMembro", "Favorito", "Subtarefa" to lexagile_app;

-- RLS: essas tabelas já têm RLS ligado e nenhuma política (a API pública do Supabase — anon/authenticated —
-- não vê nada, e continua assim). Abre só para o lexagile_app; quem filtra empresa/visibilidade é o servidor.
do $$
declare t text;
begin
  foreach t in array array['Tenant','Usuario','Setor','Equipe','EquipeMembro','Projeto','Sprint','Atividade',
                           'Subtarefa','Comentario','Favorito','Transicao','Canal','CanalMembro','Mensagem'] loop
    execute format('drop policy if exists lexagile_app_acesso on %I', t);
    execute format('create policy lexagile_app_acesso on %I for all to lexagile_app using (true) with check (true)', t);
  end loop;
end $$;

-- 3) Schema próprio do LexÁgile: leitura e gravação (sem DDL: as tabelas vêm do "npm run db:migrate")
grant usage on schema lexagile to lexagile_app;
grant select, insert, update, delete on all tables in schema lexagile to lexagile_app;
alter default privileges for role postgres in schema lexagile grant select, insert, update, delete on tables to lexagile_app;
