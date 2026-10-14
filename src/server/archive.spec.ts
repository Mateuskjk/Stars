// Tela Arquivo: só as atividades arquivadas que a pessoa vê; empresas suspensas só para quem é Admin delas.
import { IDS, TestEnv, startTestEnv } from './testing/test-db';

let env: TestEnv;
beforeAll(async () => {
  env = await startTestEnv();
  await env.db.exec(`reset role;
    update "Atividade" set "arquivadoEm" = now(), "arquivadoTipo" = 'ARQUIVADO' where id in ('${IDS.atividadeDoAtendente}', '${IDS.atividadeEscondida}');
    insert into "Tenant" (id, nome, sigla, ativo) values ('tenant-off', 'Suspensa', 'SP', false);
    insert into "Usuario" (id, nome, email, papel, "tenantId") values ('u-dono-off', 'dono', 'dono.a@lexgroup.com.br', 'DONO', 'tenant-off');
    set role lexagile_app;`);
}, 60_000);
afterAll(async () => env?.close());
// Sem a lista, em teste qualquer Admin vale como superadmin (que vê todas): aqui a lista é de outra pessoa
beforeEach(() => vi.stubEnv('LEXAGILE_SUPERADMINS', 'super@lexgroup.com.br'));
afterEach(() => vi.unstubAllEnvs());

const ids = (data: unknown) => (data as { id: string }[]).map((x) => x.id).sort();

describe('arquivo', () => {
  it('lista só as atividades arquivadas, com a mesma visibilidade de sempre', async () => {
    expect(ids((await env.call('donoA', 'GET', '/api/data/atividades?arquivadas=somente')).data)).toEqual([IDS.atividadeDoAtendente, IDS.atividadeEscondida].sort());
    expect(ids((await env.call('atendenteA', 'GET', '/api/data/atividades?arquivadas=somente')).data)).toEqual([IDS.atividadeDoAtendente]);
    expect(ids((await env.call('donoB', 'GET', '/api/data/atividades?arquivadas=somente')).data)).toEqual([]);
    expect(ids((await env.call('donoA', 'GET', '/api/data/atividades')).data)).not.toContain(IDS.atividadeDoAtendente); // as telas normais não mudam
  });

  it('empresa suspensa aparece para quem é Admin dela (pelo e-mail) e para mais ninguém', async () => {
    const dono = (await env.call('donoA', 'GET', '/api/data/empresas/suspensas')).data as { nome: string; membros: number }[];
    expect(dono).toEqual([expect.objectContaining({ nome: 'Suspensa', membros: 1 })]);
    expect((await env.call('gestorA', 'GET', '/api/data/empresas/suspensas')).data).toEqual([]);
    expect((await env.call('donoB', 'GET', '/api/data/empresas/suspensas')).data).toEqual([]);
  });

  it('restaura atividade (quem grava na empresa) e ela volta para as telas', async () => {
    expect((await env.call('observadorA', 'PATCH', `/api/data/atividades/${IDS.atividadeDoAtendente}`, { arquivado: null })).status).not.toBe(200);
    expect((await env.call('atendenteA', 'PATCH', `/api/data/atividades/${IDS.atividadeDoAtendente}`, { arquivado: null })).status).toBe(200);
    expect(ids((await env.call('atendenteA', 'GET', '/api/data/atividades')).data)).toContain(IDS.atividadeDoAtendente);
  });

  it('só o Admin da empresa suspensa (ou o superadmin) reativa; a sessão ganha a empresa na hora', async () => {
    expect((await env.call('gestorA', 'POST', '/api/data/empresas/tenant-off/reativar')).status).toBe(404);
    expect((await env.call('donoB', 'POST', '/api/data/empresas/tenant-off/reativar')).status).toBe(404);
    expect(ids((await env.call('donoA', 'GET', '/api/data/empresas')).data)).not.toContain('tenant-off');

    expect((await env.call('donoA', 'POST', '/api/data/empresas/tenant-off/reativar')).status).toBe(200);
    expect(ids((await env.call('donoA', 'GET', '/api/data/empresas')).data)).toContain('tenant-off');
    expect((await env.call('donoA', 'GET', '/api/data/empresas/suspensas')).data).toEqual([]);
    expect((await env.call('donoA', 'POST', '/api/data/empresas/tenant-off/reativar')).status).toBe(404); // já está ativa
  });
});
