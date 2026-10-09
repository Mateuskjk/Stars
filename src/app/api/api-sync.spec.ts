import { TestBed } from '@angular/core/testing';
import { ApiSync, backlogStatus, dbStatusOf } from './api-sync';
import { BacklogStore } from '../backlog/backlog-store';
import { CompanyStore } from '../companies/company-store';
import { SectorStore } from '../companies/sector-store';
import { MembersStore } from '../members/members-store';
import { ProjectStore } from '../projects/project-store';
import { ProjectTaskStore } from '../projects/project-tasks';

const atividade = (over: Record<string, unknown>) => ({
  id: 'a1', titulo: 'Atividade', descricao: '', status: 'PRONTO', prazo: null, tags: [], compartilhadoCom: [],
  responsavelId: 'u1', sprintId: null, projetoId: null, setorGeral: null, bloqueioMotivo: null, estimativa: null,
  arquivadoTipo: null, criadoEm: '2026-10-01T10:00:00', atualizadoEm: '2026-10-02T10:00:00', tenantId: 'tA', ...over,
});

const DATA: Record<string, unknown> = {
  '/api/data/empresas': [{ id: 'tA', nome: 'Empresa A', sigla: 'EA', avatarUrl: null, ativo: true, fusoHorario: 'America/Sao_Paulo' }],
  '/api/data/setores': [{ id: 's1', nome: 'TI', cor: 'emerald', tenantId: 'tA', membros: [{ usuarioId: 'u2', gestor: true }] }],
  '/api/data/usuarios': [
    { id: 'u1', nome: 'Ana Dona', email: 'ana@x.test', papel: 'DONO', situacao: 'ATIVO', tenantId: 'tA' },
    { id: 'u1b', nome: 'Ana Dona', email: 'ANA@x.test', papel: 'ATENDENTE', situacao: 'ATIVO', tenantId: 'tB' },
    { id: 'u2', nome: 'Beto', email: 'beto@x.test', papel: 'OBSERVADOR', situacao: 'ATIVO', tenantId: 'tA' },
    { id: 'u3', nome: 'Saiu', email: 'saiu@x.test', papel: 'ATENDENTE', situacao: 'DESATIVADO', tenantId: 'tA' },
  ],
  '/api/data/equipes': [{ id: 'e1', nome: 'Plataforma', tenantId: 'tA', membros: ['u1', 'u2'] }],
  '/api/data/projetos': [
    { id: 'p1', nome: 'Projeto 1', descricao: '', situacao: 'EM_ANDAMENTO', arquivado: false, responsavelId: 'u1', equipeId: 'e1', setorId: 's1', tenantId: 'tA', orcamento: 10, custoPrevisto: 5, custoRealizado: 0 },
  ],
  '/api/data/sprints': [{ id: 'sp1', nome: 'Sprint 14 [06/10 à 15/10]', situacao: 'ATIVA', tenantId: 'tA', inicio: null, fim: null }],
  '/api/data/atividades': [
    atividade({ id: 'a1', sprintId: 'sp1', setorGeral: 's1', status: 'EM_EXECUCAO', compartilhadoCom: ['u2'] }),
    atividade({ id: 'a2', projetoId: 'p1', status: 'CONCLUIDO', estimativa: 3 }),
    atividade({ id: 'a3', status: 'RASCUNHO' }),
    atividade({ id: 'a4', status: 'PRONTO', responsavelId: 'u2' }), // sem marcação: setor do responsável
    atividade({ id: 'a5', projetoId: 'p1', setorGeral: 's1', titulo: 'Geral com projeto' }), // aparece no setor e no projeto
  ],
  '/api/data/extras': [{ tipo: 'setor', registroId: 's1', dados: { descricao: 'Infraestrutura' } }],
};

describe('ApiSync', () => {
  let calls: { url: string; method: string; body: unknown }[];
  beforeEach(() => {
    calls = [];
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
      if (init.method && init.method !== 'GET' && url.startsWith('/api/data')) calls.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
      return Promise.resolve(new Response(JSON.stringify(DATA[url] ?? { id: 'novo' }), { status: 200 }));
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('troca os exemplos pelos dados do banco', async () => {
    const sync = TestBed.inject(ApiSync);
    await sync.load({ nome: 'Ana Dona', email: 'ana@x.test', memberships: [] });

    expect(TestBed.inject(CompanyStore).companies().map((c) => c.name)).toEqual(['Empresa A']);

    // Uma pessoa por e-mail (sem diferenciar maiúsculas); o maior cargo vale; desativados ficam de fora
    const members = TestBed.inject(MembersStore);
    expect(members.members().map((m) => `${m.name}:${m.role}`)).toEqual(['Ana Dona:admin', 'Beto:member']);
    expect(members.current()?.name).toBe('Ana Dona');
    expect(members.isAdmin()).toBe(true);

    const sector = TestBed.inject(SectorStore).sectors()[0];
    expect(sector).toMatchObject({ name: 'TI', manager: 'Beto', companyId: 1 });

    const project = TestBed.inject(ProjectStore).projects()[0];
    expect(project).toMatchObject({ name: 'Projeto 1', status: 'in-progress', sector: 'TI', team: 'Plataforma', company: 'Empresa A', owner: 'Ana Dona' });

    // Atividade com projeto vai para o kanban do projeto
    const tasks = TestBed.inject(ProjectTaskStore).tasks();
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({ title: 'Atividade', projectId: 1, status: 'done', points: 3, doneAt: '2026-10-02' });

    // Sem projeto: Backlog; na sprint e geral do setor aparece no kanban do setor
    const items = TestBed.inject(BacklogStore).items();
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({ status: 'refinement-done', sprintStatus: 'doing', sectorId: 1, sharedWith: ['Beto'] });
    expect(items[0].sprintId).toBeDefined();
    expect(items[1]).toMatchObject({ status: 'to-refine', sprintId: undefined, sectorId: undefined });
    expect(items[2]).toMatchObject({ assignee: 'Beto', sectorId: 1 });
    expect(items[3]).toMatchObject({ name: 'Geral com projeto', sectorId: 1 });
  });

  it('grava no banco só o que mudou', async () => {
    const sync = TestBed.inject(ApiSync);
    await sync.load({ nome: 'Ana Dona', email: 'ana@x.test', memberships: [] });
    const backlog = TestBed.inject(BacklogStore);
    const first = backlog.items()[0];
    backlog.patch(first.id, { locked: true, sprintStatus: 'review' });
    TestBed.tick();
    await new Promise((r) => setTimeout(r));
    expect(calls).toEqual([{ url: '/api/data/atividades/a1', method: 'PATCH', body: { status: 'EM_REVISAO', bloqueado: true, colunaSprint: 'review' } }]);
  });

  it('grava as configurações: setor, cargo do membro e projeto', async () => {
    const sync = TestBed.inject(ApiSync);
    await sync.load({ nome: 'Ana Dona', email: 'ana@x.test', memberships: [] });
    expect(TestBed.inject(SectorStore).sectors()[0].description).toBe('Infraestrutura'); // veio dos extras

    TestBed.inject(SectorStore).sectors.update((list) => list.map((s) => ({ ...s, name: 'Tecnologia' })));
    TestBed.inject(MembersStore).members.update((list) => list.map((m) => (m.name === 'Beto' ? { ...m, role: 'supervisor' as const } : m)));
    TestBed.inject(ProjectStore).setStatus(1, 'paused');
    TestBed.tick();
    await new Promise((r) => setTimeout(r));

    expect(calls).toEqual([
      { url: '/api/data/setores/s1', method: 'PATCH', body: { nome: 'Tecnologia' } },
      { url: '/api/data/pessoas', method: 'PATCH', body: { email: 'beto@x.test', papel: 'GESTOR' } },
      { url: '/api/data/projetos/p1', method: 'PATCH', body: { situacao: 'PARADO', extra: { status: 'paused', requester: '', docs: [] } } },
    ]);
  });
});

describe('dbStatusOf', () => {
  it('coluna da sprint ou do backlog → status do banco', () => {
    expect(dbStatusOf({ status: 'refinement-done', sprintId: 1, sprintStatus: 'done' })).toBe('CONCLUIDO');
    expect(dbStatusOf({ status: 'refinement-done', sprintId: 1, sprintStatus: undefined })).toBe('PRONTO');
    expect(dbStatusOf({ status: 'to-refine', sprintId: undefined, sprintStatus: undefined })).toBe('RASCUNHO');
    expect(dbStatusOf({ status: 'waiting', sprintId: undefined, sprintStatus: undefined })).toBe('PRONTO');
  });
});

describe('backlogStatus', () => {
  it('arquivadas, canceladas e rascunhos', () => {
    expect(backlogStatus({ status: 'CONCLUIDO', arquivadoTipo: 'ARQUIVADO', sprintId: null })).toBe('archived');
    expect(backlogStatus({ status: 'PRONTO', arquivadoTipo: 'CANCELADO', sprintId: null })).toBe('canceled');
    expect(backlogStatus({ status: 'RASCUNHO', arquivadoTipo: null, sprintId: null })).toBe('to-refine');
    expect(backlogStatus({ status: 'PRONTO', arquivadoTipo: null, sprintId: null })).toBe('refinement-done');
  });
});
