// Anotações (tabela "Anotacao"): cada um só vê/edita/apaga as suas; só o Admin da empresa direciona, e só para gente da empresa.
import { A, B, TestEnv, startTestEnv } from './testing/test-db';

let env: TestEnv;
beforeAll(async () => {
  env = await startTestEnv();
  await env.db.exec(`reset role;
    insert into "Anotacao" (id, texto, cor, ordem, "autorId", "tenantId", "criadoEm", "atualizadoEm") values
      ('n-1', E'Ideias\\nlinha 2', 'amarelo', 0, 'u-atendente-a', '${A}', now(), now()),
      ('n-2', 'Do gestor', 'amarelo', 0, 'u-gestor-a', '${A}', now(), now()),
      ('n-b', 'Da B', 'amarelo', 0, 'u-dono-b', '${B}', now(), now());
    set role lexagile_app;`);
}, 60_000);
afterAll(async () => env?.close());

const autorDe = async (id: string) => (await env.db.query<{ autorId: string }>(`select "autorId" from "Anotacao" where id = $1`, [id])).rows[0]?.autorId;

describe('anotações', () => {
  it('cada um vê, edita e apaga só as suas', async () => {
    const r = await env.call('atendenteA', 'GET', '/api/data/anotacoes');
    expect((r.data as { id: string }[]).map((n) => n.id)).toEqual(['n-1']);
    expect((await env.call('atendenteA', 'PATCH', '/api/data/anotacoes/n-2', { texto: 'invadido' })).status).toBe(404);
    expect((await env.call('atendenteA', 'DELETE', '/api/data/anotacoes/n-2')).status).toBe(404);
    expect((await env.call('atendenteA', 'PATCH', '/api/data/anotacoes/n-1', { texto: 'Ideias\nnovas' })).status).toBe(204);
    expect((await env.db.query<{ texto: string }>(`select texto from "Anotacao" where id = 'n-1'`)).rows[0].texto).toBe('Ideias\nnovas');
  });

  it('só o Admin direciona, e só para pessoas ativas da mesma empresa da anotação', async () => {
    expect((await env.call('gestorA', 'GET', '/api/data/anotacoes/direcionar')).status).toBe(403);
    expect((await env.call('gestorA', 'POST', '/api/data/anotacoes/direcionar', { itens: [{ id: 'n-2', usuarioId: 'u-gestor-a' }] })).status).toBe(403);

    const list = (await env.call('donoA', 'GET', '/api/data/anotacoes/direcionar')).data as { anotacoes: { id: string; previa: string }[]; pessoas: { tenantId: string }[] };
    expect(list.anotacoes.map((n) => n.id).sort()).toEqual(['n-1', 'n-2']); // a da B não aparece
    expect(list.anotacoes.find((n) => n.id === 'n-1')!.previa).toBe('Ideias'); // só a 1ª linha
    expect(list.pessoas.every((p) => p.tenantId === A)).toBe(true);

    // Dono da B não mexe na A; ninguém manda anotação da A para alguém da B
    await env.call('donoB', 'POST', '/api/data/anotacoes/direcionar', { itens: [{ id: 'n-2', usuarioId: 'u-dono-b' }] });
    const r = await env.call('donoA', 'POST', '/api/data/anotacoes/direcionar', {
      itens: [
        { id: 'n-2', usuarioId: 'u-dono-b' },
        { id: 'n-1', usuarioId: 'u-observador-a' },
      ],
    });
    expect(r.data).toEqual({ movidas: 1 });
    expect(await autorDe('n-2')).toBe('u-gestor-a');
    expect(await autorDe('n-1')).toBe('u-observador-a');

    // Agora aparece para o novo dono e some para o antigo
    expect(((await env.call('observadorA', 'GET', '/api/data/anotacoes')).data as { id: string }[]).map((n) => n.id)).toEqual(['n-1']);
    expect((await env.call('atendenteA', 'GET', '/api/data/anotacoes')).data).toEqual([]);
  });
});
