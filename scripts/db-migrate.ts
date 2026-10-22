// npm run db:migrate — cria/atualiza as tabelas do LexÁgile (schema lexagile) com o usuário DONO do banco.
// Use DATABASE_ADMIN_URL (usuário postgres) quando o DATABASE_URL do app for o usuário restrito lexagile_app.
// Não mexe em nenhuma tabela do sistema atual (schema public). Pode rodar quantas vezes quiser.
import { db } from '../src/server/db';
import { grantAppRole, migrateAll } from '../src/server/migrate-all';

try {
  process.loadEnvFile();
} catch {
  // sem .env: usa as variáveis de ambiente
}
if (process.env['DATABASE_ADMIN_URL']) process.env['DATABASE_URL'] = process.env['DATABASE_ADMIN_URL'];

try {
  const { missing } = await migrateAll();
  const granted = await grantAppRole();
  console.log(granted ? '• Permissões do usuário lexagile_app atualizadas.' : '• Usuário lexagile_app não existe (ok se o app ainda usa o postgres).');
  if (missing.length) {
    console.error(`✘ Faltam tabelas: ${missing.join(', ')}. Confira se DATABASE_ADMIN_URL usa o usuário dono (postgres).`);
    process.exitCode = 1;
  } else {
    console.log('✔ Schema lexagile em dia.');
  }
} catch (error) {
  console.error('✘ Falha na migração:', (error as Error).message);
  process.exitCode = 1;
} finally {
  await db().end();
}
