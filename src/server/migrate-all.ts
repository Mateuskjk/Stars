// Cria ou atualiza TODAS as tabelas do schema lexagile, de uma vez. Precisa do usuário DONO do banco (postgres):
// o usuário do app em produção (lexagile_app) não tem permissão de DDL. Rodado por "npm run db:migrate" e pelos testes.
import { db } from './db';
import { ensureSessionTable } from './auth';
import { ensureSchema } from './migration';
import { ensureTable as ensureAi } from './ai';
import { ensureTable as ensureDomains } from './domains';
import { ensureTables as ensureIntegrations } from './integrations';
import { ensureTable as ensureLimits } from './limits';
import { ensureTables as ensureOauth } from './mcp-oauth';
import { ensureTables as ensurePublicApi } from './public-api';

// Tabelas que o app espera encontrar (as do INSTALL_SQL só existem depois do assistente de migração)
const EXPECTED = [
  'sessao', 'limite', 'dominio', 'ia_config', 'webhook', 'integracao_banco', 'api_token', 'api_acesso',
  'oauth_cliente', 'oauth_codigo', 'oauth_token',
];

export async function migrateAll() {
  const installed = await ensureSchema(); // INSTALL_SQL (empresa_config, setor_membro, extra…), se o assistente já rodou
  await ensureSessionTable();
  await ensureLimits();
  await ensureDomains();
  await ensureAi();
  await ensureIntegrations();
  await ensurePublicApi();
  await ensureOauth();
  const { rows } = await db().query<{ t: string }>(`select relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'lexagile'`);
  const have = new Set(rows.map((r) => r.t));
  return { installed, missing: EXPECTED.filter((t) => !have.has(t)) };
}

// Se o papel restrito do app existe, garante que ele acessa as tabelas novas do schema lexagile
export async function grantAppRole() {
  const { rows } = await db().query(`select 1 from pg_roles where rolname = 'lexagile_app'`);
  if (!rows.length) return false;
  await db().query(`grant usage on schema lexagile to lexagile_app;
    grant select, insert, update, delete on all tables in schema lexagile to lexagile_app;
    grant usage, select on all sequences in schema lexagile to lexagile_app;
    -- Anotações (tela Notas): cada um lê, edita e apaga as suas; o Admin direciona para o perfil certo (troca o autor)
    grant select, update, delete on "Anotacao" to lexagile_app;
    drop policy if exists lexagile_app_acesso on "Anotacao";
    create policy lexagile_app_acesso on "Anotacao" for all to lexagile_app using (true) with check (true);`);
  return true;
}
