import { TestBed } from '@angular/core/testing';
import { ApiSync, backlogStatus } from './api-sync';
import { BacklogStore } from '../backlog/backlog-store';
import { CompanyStore } from '../companies/company-store';
import { SectorStore } from '../companies/sector-store';
import { MembersStore } from '../members/members-store';
import { ProjectStore } from '../projects/project-store';
import { ProjectTaskStore } from '../projects/project-tasks';

const atividade = (over: Record<string, unknown>) => ({
  id: 'a1', titulo: 'Atividade', descricao: '', status: 'PRONTO', prazo: null, tags: [], compartilhadoCom: [],
  responsavelId: 'u1', sprintId: null, projetoId: null, setorGeral: null, bloqueioMotivo: null, estimativa: null,
  arquivadoTipo: null, criadoEm: '2026-10-01T10:00:00', atualizadoEm: '2026-10-02T10:00:00', ...over,
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
  ],
};

describe('ApiSync', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', (url: string) => Promise.resolve(new Response(JSON.stringify(DATA[url]), { status: 200 })));
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
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: 'Atividade', projectId: 1, status: 'done', points: 3, doneAt: '2026-10-02' });

    // Sem projeto: Backlog; na sprint e geral do setor aparece no kanban do setor
    const items = TestBed.inject(BacklogStore).items();
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ status: 'refinement-done', sprintStatus: 'doing', sectorId: 1, sharedWith: ['Beto'] });
    expect(items[0].sprintId).toBeDefined();
    expect(items[1]).toMatchObject({ status: 'to-refine', sprintId: undefined });
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
