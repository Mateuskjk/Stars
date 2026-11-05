// Análise diária da IA (Cron da Vercel às 10h): só roda com o CRON_SECRET, grava por empresa e só quem vê tudo lê.
import { encryptKey } from './ai';
import { dayIn } from './daily-ai';
import { A, IDS, TestEnv, startTestEnv } from './testing/test-db';

let env: TestEnv;
const realFetch = globalThis.fetch;
let prompts: string[] = [];

beforeAll(async () => {
  env = await startTestEnv();
  // Um modelo de IA configurado como assistente e uma atividade geral na sprint ativa da empresa A
  await env.db.query(`insert into lexagile.ia_config (id, dados, "chaveCifrada", assistente) values ('m1', $1, $2, true)`, [
    JSON.stringify({ name: 'Teste', provider: 'anthropic', model: 'claude-test', temperature: 0.5, maxTokens: 800, systemPrompt: '', keyHint: '0000', lastTest: null }),
    encryptKey('sk-teste'),
  ]);
  await env.db.query(`update "Atividade" set "sprintId" = $1, prazo = now() - interval '3 days' where id = $2`, [IDS.sprintAtivaA, IDS.atividadeDoAtendente]);
  // Só a chamada ao fornecedor de IA é falsa; o resto (as chamadas à API de teste) segue de verdade
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input).startsWith('https://api.anthropic.com/')) {
      prompts.push(JSON.parse(String(init!.body)).messages[0].content);
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Diagnóstico do dia.' }] }), { status: 200 });
    }
    return realFetch(input, init);
  });
}, 60_000);
afterAll(async () => {
  vi.restoreAllMocks();
  delete process.env['CRON_SECRET'];
  await env?.close();
});

describe('análise diária da IA (cron das 10h)', () => {
  it('sem CRON_SECRET não roda; com o segredo errado, recusa', async () => {
    delete process.env['CRON_SECRET'];
    expect((await env.call(null, 'GET', '/api/cron/analise-ia')).status).toBe(503);
    process.env['CRON_SECRET'] = 'segredo-de-teste';
    expect((await env.call(null, 'GET', '/api/cron/analise-ia', undefined, { authorization: 'Bearer errado' })).status).toBe(401);
    expect(prompts).toEqual([]);
  });

  it('com o segredo, analisa cada empresa e grava o texto do dia (uma vez só)', async () => {
    process.env['CRON_SECRET'] = 'segredo-de-teste';
    const auth = { authorization: 'Bearer segredo-de-teste' };
    const first = await env.call(null, 'GET', '/api/cron/analise-ia', undefined, auth);
    expect(first.status).toBe(200);
    expect(first.data.feitas).toBeGreaterThanOrEqual(1);
    const setores = prompts.find((p) => p.includes('atividades gerais dos setores da empresa Empresa A'))!;
    expect(setores).toContain('Do atendente'); // atrasada na sprint ativa
    expect(setores).not.toMatch(/@lexgroup/); // sem e-mails no prompt

    const { rows } = await env.db.query<{ dia: string; texto: string }>(
      `select to_char(dia, 'YYYY-MM-DD') as dia, texto from lexagile.ia_analise_diaria where "tenantId" = $1 and painel = 'setores'`,
      [A],
    );
    expect(rows).toEqual([{ dia: dayIn('America/Sao_Paulo'), texto: 'Diagnóstico do dia.' }]);

    // A Vercel pode repetir a chamada: não gasta de novo com a IA
    const count = prompts.length;
    expect((await env.call(null, 'GET', '/api/cron/analise-ia', undefined, auth)).data.feitas).toBe(0);
    expect(prompts.length).toBe(count);
  });

  it('só quem vê tudo da empresa lê a análise', async () => {
    const path = `/api/data/analise-diaria?empresa=${A}&painel=setores`;
    expect((await env.call('donoA', 'GET', path)).data.texto).toBe('Diagnóstico do dia.');
    expect((await env.call('gestorA', 'GET', path)).status).toBe(200);
    expect((await env.call('atendenteA', 'GET', path)).status).toBe(403); // empresa A é restrita
    expect((await env.call('donoB', 'GET', path)).status).toBe(403); // outra empresa
    expect((await env.call(null, 'GET', path)).status).toBe(401);
  });
});
