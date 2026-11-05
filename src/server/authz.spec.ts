// Testes de autorização: cada rota tentada por quem NÃO pode (outra empresa, Observador, Atendente) e por quem pode
// (controle: garante que a recusa não é só o teste quebrado). Banco Postgres em memória (testing/test-db.ts).
import { createHash, randomBytes } from 'node:crypto';
import { A, B, IDS, TestEnv, startTestEnv } from './testing/test-db';

let env: TestEnv;
beforeAll(async () => {
  env = await startTestEnv();
}, 60_000);
afterAll(async () => env?.close());

const denied = (status: number) => status === 403 || status === 404;
const papelDe = async (id: string) => (await env.db.query<{ papel: string }>(`select papel from "Usuario" where id = $1`, [id])).rows[0].papel;
const tituloDe = async (id: string) => (await env.db.query<{ titulo: string }>(`select titulo from "Atividade" where id = $1`, [id])).rows[0].titulo;

describe('outra empresa (Dono da B tentando mexer na A)', () => {
  it('não vê atividades, projetos nem setores da A', async () => {
    const ativs = (await env.call('donoB', 'GET', '/api/data/atividades')).data as { id: string }[];
    const projs = (await env.call('donoB', 'GET', '/api/data/projetos')).data as { id: string }[];
    const setores = (await env.call('donoB', 'GET', '/api/data/setores')).data as { tenantId: string }[];
    expect(ativs.map((a) => a.id)).toEqual([IDS.atividadeB]);
    expect(projs.map((p) => p.id)).toEqual([IDS.projetoB]);
    expect(setores.every((s) => s.tenantId === B)).toBe(true);
  });

  it('não altera nada da A', async () => {
    const tries: [string, string, unknown][] = [
      ['PATCH', `/api/data/atividades/${IDS.atividadeDoAtendente}`, { titulo: 'invadido' }],
      ['POST', '/api/data/atividades', { tenantId: A, titulo: 'invadido' }],
      ['PATCH', `/api/data/projetos/${IDS.projetoVisivel}`, { nome: 'invadido' }],
      ['PATCH', `/api/data/setores/${IDS.setorDoAtendente}`, { nome: 'invadido' }],
      ['DELETE', `/api/data/setores/${IDS.setorDoAtendente}`, undefined],
      ['PATCH', `/api/data/empresas/${A}`, { nome: 'invadido' }],
      ['PATCH', `/api/data/sprints/${IDS.sprintAtivaA}`, { situacao: 'FECHADA' }],
      ['POST', '/api/data/sprints', { tenantId: A, nome: 'x', inicio: '2026-01-01', fim: '2026-01-10' }],
      ['POST', '/api/data/usuarios', { tenantId: A, nome: 'x', email: 'x@lexgroup.com.br', papel: 'DONO' }],
      ['POST', '/api/data/projetos', { tenantId: A, nome: 'invadido' }],
      ['POST', '/api/data/equipes', { tenantId: A, nome: 'invadido' }],
      ['POST', '/api/data/dailies', { tenantId: A, record: { date: new Date().toISOString(), participants: [] } }],
    ];
    for (const [method, path, body] of tries) {
      const r = await env.call('donoB', method, path, body);
      expect(denied(r.status), `${method} ${path} → ${r.status}`).toBe(true);
    }
    expect(await tituloDe(IDS.atividadeDoAtendente)).toBe('Do atendente');
  });

  it('não lê as dailies da A', async () => {
    expect((await env.call('donoB', 'GET', `/api/data/dailies?tenantId=${A}`)).data).toEqual([]);
  });

  it('não promove ninguém da A (PATCH /pessoas só vale nas empresas onde quem altera é Dono)', async () => {
    const r = await env.call('donoB', 'PATCH', '/api/data/pessoas', { email: 'atendente.a@lexgroup.com.br', papel: 'DONO' });
    expect(r.status).toBe(200); // não é erro: só não encontra ninguém na B
    expect(await papelDe('u-atendente-a')).toBe('ATENDENTE');
  });
});

describe('Observador (só leitura)', () => {
  it('não grava em nenhuma rota', async () => {
    const tries: [string, string, unknown][] = [
      ['POST', '/api/data/atividades', { tenantId: A, titulo: 'x' }],
      ['POST', '/api/data/sprints', { tenantId: A, nome: 'x', inicio: '2026-01-01', fim: '2026-01-10' }],
      ['POST', '/api/data/projetos', { tenantId: A, nome: 'x' }],
      ['POST', '/api/data/equipes', { tenantId: A, nome: 'x' }],
      ['POST', '/api/data/dailies', { tenantId: A, record: { date: new Date().toISOString(), participants: [] } }],
      ['PATCH', `/api/data/empresas/${A}`, { nome: 'x' }],
    ];
    for (const [method, path, body] of tries) {
      const r = await env.call('observadorA', method, path, body);
      expect(r.status, `${method} ${path}`).toBe(403);
    }
  });

  it('continua lendo', async () => {
    expect((await env.call('observadorA', 'GET', '/api/data/projetos')).status).toBe(200);
  });
});

describe('Atendente (sem configuração)', () => {
  it('não mexe em configuração, sprints, membros nem integrações', async () => {
    const tries: [string, string, unknown][] = [
      ['POST', '/api/data/setores', { tenantId: A, nome: 'x' }],
      ['PATCH', `/api/data/setores/${IDS.setorDoAtendente}`, { nome: 'x' }],
      ['PATCH', `/api/data/empresas/${A}`, { nome: 'x' }],
      ['POST', '/api/data/usuarios', { tenantId: A, nome: 'x', email: 'x@lexgroup.com.br' }],
      ['PATCH', '/api/data/pessoas', { email: 'dono.a@lexgroup.com.br', papel: 'OBSERVADOR' }],
      ['POST', '/api/data/pessoas/remover', { email: 'dono.a@lexgroup.com.br' }],
      ['POST', '/api/data/projetos', { tenantId: A, nome: 'x' }],
      ['POST', '/api/data/equipes', { tenantId: A, nome: 'x' }],
      ['POST', '/api/data/sprints', { tenantId: A, nome: 'x', inicio: '2026-01-01', fim: '2026-01-10' }],
      ['PATCH', `/api/data/sprints/${IDS.sprintAtivaA}`, { situacao: 'FECHADA' }],
      ['POST', '/api/data/dominios', { dominio: 'gmail.com' }],
      ['PUT', '/api/internal/tokens/1', { token: 'stars_' + 'a'.repeat(48), role: 'admin', permissions: {} }],
    ];
    for (const [method, path, body] of tries) {
      const r = await env.call('atendenteA', method, path, body);
      expect(r.status, `${method} ${path}`).toBe(403);
    }
    expect(await papelDe('u-dono-a')).toBe('DONO');
  });

  it('não apaga a daily do time (Admin apaga)', async () => {
    const daily = await env.call('donoA', 'POST', '/api/data/dailies', { tenantId: A, record: { date: new Date().toISOString(), participants: [] } });
    expect(daily.status).toBe(200);
    expect((await env.call('atendenteA', 'DELETE', `/api/data/dailies/${daily.data.id}`)).status).toBe(403);
    expect((await env.call('donoA', 'DELETE', `/api/data/dailies/${daily.data.id}`)).status).toBe(200);
  });

  it('trabalha nas próprias atividades', async () => {
    expect((await env.call('atendenteA', 'PATCH', `/api/data/atividades/${IDS.atividadeDoAtendente}`, { titulo: 'Do atendente' })).status).toBe(200);
    expect((await env.call('atendenteA', 'POST', '/api/data/atividades', { tenantId: A, titulo: 'Nova do atendente' })).status).toBe(200);
  });
});

describe('visibilidade restrita (Atendente da A)', () => {
  it('vê só os projetos e atividades a que tem direito', async () => {
    const projs = ((await env.call('atendenteA', 'GET', '/api/data/projetos')).data as { id: string }[]).map((p) => p.id);
    const ativs = ((await env.call('atendenteA', 'GET', '/api/data/atividades')).data as { id: string }[]).map((a) => a.id);
    const extras = ((await env.call('atendenteA', 'GET', '/api/data/extras')).data as { registroId: string }[]).map((e) => e.registroId);
    expect(projs).toContain(IDS.projetoVisivel);
    expect(projs).not.toContain(IDS.projetoEscondido);
    expect(ativs).toContain(IDS.atividadeDoAtendente);
    expect(ativs).not.toContain(IDS.atividadeEscondida);
    expect(extras).not.toContain(IDS.projetoEscondido);
  });

  it('não altera a atividade escondida nem cria cartão no projeto escondido', async () => {
    expect((await env.call('atendenteA', 'PATCH', `/api/data/atividades/${IDS.atividadeEscondida}`, { titulo: 'x' })).status).toBe(404);
    expect((await env.call('atendenteA', 'POST', '/api/data/atividades', { tenantId: A, titulo: 'x', projetoId: IDS.projetoEscondido })).status).toBe(400);
    expect(await tituloDe(IDS.atividadeEscondida)).toBe('Escondida');
  });

  it('o Dono vê tudo da empresa', async () => {
    const projs = ((await env.call('donoA', 'GET', '/api/data/projetos')).data as { id: string }[]).map((p) => p.id);
    expect(projs).toEqual(expect.arrayContaining([IDS.projetoVisivel, IDS.projetoEscondido]));
  });
});

describe('sessão', () => {
  it('quem é removido perde o acesso na hora', async () => {
    const token = randomBytes(32).toString('base64url');
    await env.db.query(`insert into "Usuario" (id, nome, email, papel, "tenantId") values ('u-temp', 'Temp', 'temp@lexgroup.com.br', 'DONO', $1)`, [A]);
    await env.db.query(`insert into lexagile.sessao ("tokenHash", nome, email, memberships, "expiraEm") values ($1, 'Temp', 'temp@lexgroup.com.br', $2, now() + interval '1 hour')`, [
      createHash('sha256').update(token).digest('hex'),
      JSON.stringify([{ usuarioId: 'u-temp', tenantId: A, papel: 'DONO' }]),
    ]);
    await env.db.query(`update "Usuario" set situacao = 'REMOVIDO', "removidoEm" = now() where id = 'u-temp'`);
    const r = await env.call(null, 'GET', '/api/data/projetos', undefined, { cookie: `__Host-lex_session=${token}` });
    expect(r.status).toBe(401);
  });

  it('sem login, nada', async () => {
    for (const path of ['/api/data/projetos', '/api/data/atividades']) {
      expect((await env.call(null, 'GET', path)).status, path).toBe(401);
    }
  });
});

describe('CSRF', () => {
  it('gravação vinda de outro site é recusada; do próprio site passa', async () => {
    const body = { tenantId: A, titulo: 'csrf' };
    expect((await env.call('donoA', 'POST', '/api/data/atividades', body, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await env.call('donoA', 'POST', '/api/data/atividades', body, { 'sec-fetch-site': 'same-origin' })).status).toBe(200);
  });
});

describe('API pública (tokens)', () => {
  it('token vale para o MEMBRO: lê o que ele vê (não o que o Admin vê), só na empresa; PATCH e revogação', async () => {
    const token = 'stars_' + randomBytes(24).toString('hex');
    const emitir = { token, name: 'Atendente', email: 'atendente.a@lexgroup.com.br', permissions: {} };
    expect((await env.call('donoA', 'PUT', '/api/internal/tokens/7', emitir)).status).toBe(200);
    const bearer = { authorization: `Bearer ${token}` };
    expect((await env.call(null, 'GET', '/api/v1/projects', undefined, bearer)).status).toBe(403); // sem permissão: nega
    expect((await env.call('donoA', 'PATCH', '/api/internal/tokens/7', { permissions: { projects: 'view' } })).status).toBe(200);
    // Visão do Atendente: o projeto do setor dele sim; o escondido e os da empresa B não
    const ids = ((await env.call(null, 'GET', '/api/v1/projects', undefined, bearer)).data as { id: string }[]).map((p) => p.id);
    expect(ids).toContain(IDS.projetoVisivel);
    expect(ids).not.toContain(IDS.projetoEscondido);
    expect(ids).not.toContain(IDS.projetoB);
    expect((await env.call(null, 'GET', `/api/v1/projects/${IDS.projetoEscondido}`, undefined, bearer)).status).toBe(404);
    // /me sem e-mails
    const me = (await env.call(null, 'GET', '/api/v1/me', undefined, bearer)).data;
    expect(JSON.stringify(me)).not.toContain('@');
    expect((await env.call('donoB', 'DELETE', '/api/internal/tokens/7')).status).toBe(200); // B não revoga o da A
    expect((await env.call(null, 'GET', '/api/v1/projects', undefined, bearer)).status).toBe(200);
    expect((await env.call('donoA', 'DELETE', '/api/internal/tokens/7')).status).toBe(200);
    expect((await env.call(null, 'GET', '/api/v1/projects', undefined, bearer)).status).toBe(401);
  });

  it('não emite token para quem não está ativo numa empresa em que o Admin é Dono', async () => {
    const token = 'stars_' + randomBytes(24).toString('hex');
    const r = await env.call('donoA', 'PUT', '/api/internal/tokens/8', { token, name: 'B', email: 'dono.b@lexgroup.com.br', permissions: { projects: 'view' } });
    expect(r.status).toBe(400);
  });
});

describe('limite de login (no banco)', () => {
  it('15 tentativas erradas disparadas ao mesmo tempo: só 5 chegam a conferir a senha', async () => {
    const tries = await Promise.all(
      Array.from({ length: 15 }, () => env.call(null, 'POST', '/api/auth/login', { email: 'alvo.paralelo@lexgroup.com.br', senha: 'errada' })),
    );
    expect(tries.filter((r) => r.status === 401)).toHaveLength(5);
    expect(tries.filter((r) => r.status === 429)).toHaveLength(10);
  });
});

describe('endurecimento (2ª análise)', () => {
  it('CSRF não é contornado escrevendo o caminho em maiúsculas', async () => {
    const r = await env.call('donoA', 'POST', '/API/data/atividades', { tenantId: A, titulo: 'x' }, { 'sec-fetch-site': 'cross-site' });
    expect(r.status).toBe(403);
  });

  it('fuso horário inválido é recusado (quebraria a tela de todos)', async () => {
    expect((await env.call('donoA', 'PATCH', `/api/data/empresas/${A}`, { fusoHorario: 'Lua/Base_Alfa' })).status).toBe(400);
    expect((await env.call('donoA', 'PATCH', `/api/data/empresas/${A}`, { fusoHorario: 'America/Manaus' })).status).toBe(200);
  });

  it('"não pode mudar o próprio cargo" vale mesmo com a sessão em outro e-mail (conta achada pelo Google)', async () => {
    const token = randomBytes(32).toString('base64url');
    await env.db.query(`insert into lexagile.sessao ("tokenHash", nome, email, memberships, "expiraEm") values ($1, 'x', 'outro.email@lexgroup.com.br', $2, now() + interval '1 hour')`, [
      createHash('sha256').update(token).digest('hex'),
      JSON.stringify([{ usuarioId: 'u-dono-a', tenantId: A, papel: 'DONO' }]),
    ]);
    const r = await env.call(null, 'PATCH', '/api/data/pessoas', { email: 'dono.a@lexgroup.com.br', papel: 'ATENDENTE' }, { cookie: `__Host-lex_session=${token}` });
    expect(r.status).toBe(400);
    expect(await papelDe('u-dono-a')).toBe('DONO');
  });

  it('configuração da IA: quem não é superadmin não vê prompt nem final da chave', async () => {
    const { encryptKey } = await import('./ai');
    await env.db.query(`insert into lexagile.ia_config (id, dados, "chaveCifrada", assistente) values ('ia-1', $1, $2, true)`, [
      JSON.stringify({ name: 'Assistente', provider: 'anthropic', model: 'claude-haiku', systemPrompt: 'PROMPT SECRETO', keyHint: 'abcd', lastTest: null }),
      encryptKey('sk-teste'),
    ]);
    const r = await env.call('atendenteA', 'GET', '/api/ai/configs');
    expect(r.status).toBe(200);
    expect(r.data[0]).toEqual({ id: 'ia-1', name: 'Assistente', provider: 'anthropic', model: 'claude-haiku', assistant: true });
  });
});
