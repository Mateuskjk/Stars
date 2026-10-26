// Regra: atividade na sprint ou de projeto precisa de responsável (vale para o site, o MCP e a API).
import { IDS, TestEnv, startTestEnv } from './testing/test-db';

let env: TestEnv;
beforeAll(async () => {
  env = await startTestEnv();
}, 60_000);
afterAll(async () => env?.close());

const patch = (id: string, body: unknown) => env.call('donoA', 'PATCH', `/api/data/atividades/${id}`, body);

describe('responsável obrigatório', () => {
  it('sem responsável não entra na sprint; com responsável entra', async () => {
    const id = IDS.atividadeDoAtendente;
    expect((await patch(id, { responsavelId: null })).status).toBe(200); // fora da sprint, pode ficar sem
    expect((await patch(id, { sprintId: IDS.sprintAtivaA })).status).toBe(400);
    expect((await patch(id, { sprintId: IDS.sprintAtivaA, responsavelId: 'u-atendente-a' })).status).toBe(200);
  });

  it('na sprint ou em projeto, não dá para tirar o responsável', async () => {
    expect((await patch(IDS.atividadeDoAtendente, { responsavelId: null })).status).toBe(400); // já está na sprint
    expect((await patch(IDS.atividadeEscondida, { responsavelId: null })).status).toBe(400); // é de projeto
  });

  it('editar outros campos continua livre (mesmo em atividade antiga sem responsável)', async () => {
    await env.db.exec(`reset role; update "Atividade" set "responsavelId" = null where id = '${IDS.atividadeEscondida}'; set role lexagile_app;`);
    expect((await patch(IDS.atividadeEscondida, { titulo: 'Novo título' })).status).toBe(200);
  });
});
