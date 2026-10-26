// Nova sprint traz as pendências: o que ficou aberto em sprints já fechadas da empresa (concluídas ficam onde estão).
import { A, IDS, TestEnv, startTestEnv } from './testing/test-db';

let env: TestEnv;
beforeAll(async () => {
  env = await startTestEnv();
  await env.db.exec(`reset role;
    update "Sprint" set situacao = 'FECHADA' where id = '${IDS.sprintAtivaA}';
    update "Atividade" set "sprintId" = '${IDS.sprintFechadaA}', status = 'EM_EXECUCAO' where id = '${IDS.atividadeDoAtendente}';
    update "Atividade" set "sprintId" = '${IDS.sprintFechadaA}', status = 'CONCLUIDO' where id = '${IDS.atividadeEscondida}';
    set role lexagile_app;`);
}, 60_000);
afterAll(async () => env?.close());

const sprintOf = async (id: string) => (await env.db.query<{ sprintId: string }>(`select "sprintId" from "Atividade" where id = $1`, [id])).rows[0].sprintId;

describe('nova sprint', () => {
  it('leva as atividades abertas das sprints fechadas; concluídas e outras empresas não', async () => {
    const r = await env.call('donoA', 'POST', '/api/data/sprints', { tenantId: A, nome: 'Sprint nova', inicio: '2026-11-02', fim: '2026-11-10' });
    expect(r.status).toBe(200);
    expect(r.data.levadas).toBe(1);
    expect(await sprintOf(IDS.atividadeDoAtendente)).toBe(r.data.id); // aberta: veio
    expect(await sprintOf(IDS.atividadeEscondida)).toBe(IDS.sprintFechadaA); // concluída: ficou
    expect(await sprintOf(IDS.atividadeB)).not.toBe(r.data.id); // outra empresa: intocada
  });
});
