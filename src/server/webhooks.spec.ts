// Eventos de webhook emitidos pelo servidor: só depois do commit e só para os Admins da empresa da mudança.
// Os webhooks de teste apontam para um endereço interno: o filtro de SSRF recusa na hora (nada sai para a rede),
// mas a "última entrega" fica registrada com o evento — é por ela que o teste vê quem recebeu o quê.
import { encryptKey } from './ai';
import { A, IDS, TestEnv, startTestEnv } from './testing/test-db';

let env: TestEnv;
beforeAll(async () => {
  env = await startTestEnv();
  await env.call('donoA', 'GET', '/api/integrations/webhooks'); // cria as tabelas de integração
  for (const [id, owner] of [['hook-a', 'dono.a@lexgroup.com.br'], ['hook-b', 'dono.b@lexgroup.com.br']]) {
    await env.db.query(`insert into lexagile.webhook (id, owner, dados, "segredoCifrado") values ($1, $2, $3, $4)`, [
      id,
      owner,
      JSON.stringify({ name: id, url: 'https://127.0.0.1/hook', events: ['*'], active: true, lastDelivery: null }),
      encryptKey('whsec_teste'),
    ]);
  }
}, 60_000);
afterAll(async () => env?.close());

const lastEvent = async (id: string) =>
  (await env.db.query<{ e: string | null }>(`select dados->'lastDelivery'->>'event' as e from lexagile.webhook where id = $1`, [id])).rows[0].e;
const reset = () => env.db.query(`update lexagile.webhook set dados = jsonb_set(dados, '{lastDelivery}', 'null')`);

describe('webhooks emitidos pelo servidor', () => {
  it('mover um cartão na empresa A avisa só o webhook do Admin da A', async () => {
    await reset();
    const r = await env.call('atendenteA', 'PATCH', `/api/data/atividades/${IDS.atividadeDoAtendente}`, { status: 'EM_EXECUCAO' });
    expect(r.status).toBe(200);
    expect(await lastEvent('hook-a')).toBe('activity.move');
    expect(await lastEvent('hook-b')).toBeNull();
  });

  it('gravação que falha (rollback) não emite evento', async () => {
    await reset();
    // muda o status (enfileira activity.move) e depois falha: setor de outra empresa
    const r = await env.call('atendenteA', 'PATCH', `/api/data/atividades/${IDS.atividadeDoAtendente}`, { status: 'CONCLUIDO', setorGeral: 'setor-b1' });
    expect(r.status).toBe(400);
    expect(await lastEvent('hook-a')).toBeNull();
  });

  it('salvar sem mudar nada não emite evento', async () => {
    await reset();
    const r = await env.call('atendenteA', 'PATCH', `/api/data/atividades/${IDS.atividadeDoAtendente}`, { status: 'EM_EXECUCAO' });
    expect(r.status).toBe(200);
    expect(await lastEvent('hook-a')).toBeNull();
  });

  it('criar atividade emite activity.create', async () => {
    await reset();
    expect((await env.call('donoA', 'POST', '/api/data/atividades', { tenantId: A, titulo: 'Nova' })).status).toBe(200);
    expect(await lastEvent('hook-a')).toBe('activity.create');
  });

  it('o navegador não consegue mais forjar eventos (rota /events removida)', async () => {
    const r = await env.call('donoA', 'POST', '/api/integrations/events', { event: 'activity.move', data: {} });
    expect(r.status).toBe(404);
  });
});
