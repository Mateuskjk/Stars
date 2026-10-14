// Anexos (tabela "Anexo"): quem vê a atividade lista e baixa; quem grava na empresa anexa e remove; o resto é recusado.
import { IDS, TestEnv, startTestEnv } from './testing/test-db';

let env: TestEnv;
beforeAll(async () => {
  env = await startTestEnv();
}, 60_000);
afterAll(async () => env?.close());

// O call() do ambiente manda JSON; aqui o corpo é o arquivo cru
async function fetchUpload(who: 'atendenteA' | 'observadorA' | 'donoB', atividade: string, body: string) {
  return env.raw(who, 'POST', `/api/data/atividades/${atividade}/anexos`, body, { 'content-type': 'application/pdf', 'x-file-name': encodeURIComponent('relatório final.pdf') });
}

describe('anexos', () => {
  it('anexa, lista, baixa e remove na atividade que a pessoa vê', async () => {
    const created = await fetchUpload('atendenteA', IDS.atividadeDoAtendente, 'conteudo-do-pdf');
    expect(created.status).toBe(201);
    const id = (created.data as { id: string }).id;

    const list = (await env.call('atendenteA', 'GET', `/api/data/atividades/${IDS.atividadeDoAtendente}/anexos`)).data as { id: string; nome: string; tamanho: number }[];
    expect(list).toMatchObject([{ id, nome: 'relatório final.pdf', tamanho: 15 }]);

    const file = await env.raw('atendenteA', 'GET', `/api/data/anexos/${id}`);
    expect(file.status).toBe(200);
    expect(file.text).toBe('conteudo-do-pdf');
    expect(file.headers.get('content-type')).toBe('application/octet-stream'); // nunca abre como página do site
    expect(file.headers.get('content-disposition')).toContain('attachment');

    // Outra empresa não lista, não baixa, não anexa e não remove
    expect((await env.call('donoB', 'GET', `/api/data/atividades/${IDS.atividadeDoAtendente}/anexos`)).status).toBe(404);
    expect((await env.raw('donoB', 'GET', `/api/data/anexos/${id}`)).status).toBe(404);
    expect((await fetchUpload('donoB', IDS.atividadeDoAtendente, 'x')).status).toBe(404);
    expect((await env.call('donoB', 'DELETE', `/api/data/anexos/${id}`)).status).toBe(404);

    // Observador não grava (403, ou 404 se nem vê a atividade)
    expect([403, 404]).toContain((await fetchUpload('observadorA', IDS.atividadeDoAtendente, 'x')).status);
    expect([403, 404]).toContain((await env.call('observadorA', 'DELETE', `/api/data/anexos/${id}`)).status);

    // Atendente não vê a atividade escondida: nem anexa nela
    expect((await fetchUpload('atendenteA', IDS.atividadeEscondida, 'x')).status).toBe(404);

    expect((await env.call('atendenteA', 'DELETE', `/api/data/anexos/${id}`)).status).toBe(204);
    expect((await env.call('atendenteA', 'GET', `/api/data/atividades/${IDS.atividadeDoAtendente}/anexos`)).data).toEqual([]);
  });

  it('recusa arquivo acima de 4 MB', async () => {
    const r = await fetchUpload('atendenteA', IDS.atividadeDoAtendente, 'x'.repeat(4 * 1024 * 1024 + 1));
    expect(r.status).toBe(413);
  });
});
