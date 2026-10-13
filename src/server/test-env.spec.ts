// Os testes rodam sem isolamento (vários arquivos no mesmo processo, como no CI): trocar de banco precisa zerar o que
// cada módulo guardou sobre o banco anterior ("tabela já criada" etc. — onDbReset em db.ts). Sem isso, o 2º banco
// não ganha as tabelas do lexagile e os testes falham só no CI.
import { startTestEnv } from './testing/test-db';

it('dois bancos de teste em sequência no mesmo processo funcionam', async () => {
  const a = await startTestEnv();
  expect((await a.call('donoA', 'GET', '/api/data/projetos')).status).toBe(200);
  await a.close();
  const b = await startTestEnv();
  expect((await b.call('donoA', 'GET', '/api/data/projetos')).status).toBe(200);
  await b.close();
}, 60_000);
