import { Injectable, computed, inject, signal } from '@angular/core';
import { AuditAction, AuditStore, diff } from '../audit/audit-store';
import { MembersStore } from '../members/members-store';
import { CompanyStore } from '../companies/company-store';
import { sprintOf, sprintWindow, today } from '../projects/project-tasks';
import { CustomColumnId, KanbanColumn, customColumn } from '../kanban/add-column';

export type BacklogStatus = 'to-refine' | 'refined' | 'waiting' | 'refinement-done' | 'archived' | 'canceled' | CustomColumnId;

// Ordem das colunas = ordem de "Avançar" e "Recuar"
export const BACKLOG_COLUMNS: KanbanColumn<BacklogStatus>[] = [
  { id: 'to-refine', label: 'Para refinar', color: '#9b7be0' },
  { id: 'refined', label: 'Refinado', color: '#2a78d6' },
  { id: 'waiting', label: 'Aguardando', color: '#eda100' },
  { id: 'refinement-done', label: 'Finalizado refinamento', color: '#0ca30c' },
  { id: 'archived', label: 'Arquivado', color: '#898781' },
  { id: 'canceled', label: 'Cancelados', color: '#d03b3b' },
];

export interface Subtask {
  id: number;
  title: string;
  done: boolean;
}

export interface BacklogComment {
  id: number;
  author: string;
  text: string;
  time: Date;
}

export interface Attachment {
  id: number;
  name: string;
  type: string;
  size: number;
  url: string; // object URL do arquivo, criado no navegador
}

export interface BacklogItem {
  id: number;
  name: string;
  description: string;
  status: BacklogStatus;
  due: string; // AAAA-MM-DD ou ''
  tags: string[];
  assignee: string;
  comments: BacklogComment[];
  subtasks: Subtask[];
  attachments: Attachment[];
  locked: boolean;
  favorite: boolean;
  // Planning: só vale para atividades em "Finalizado refinamento"
  planning?: 'ready' | 'waiting'; // padrão: 'ready' (pronta para a sprint)
  sprintId?: number; // definida quando a atividade entra numa sprint
  sectorId?: number; // setor de uma empresa (aparece no kanban da página do setor)
  companyId?: number; // empresa da atividade (dados do banco); sem empresa = vale para todas
  sharedWith: string[]; // atividade conjunta: conta para o responsável e para cada pessoa daqui
  sprintStatus?: string; // coluna no kanban da sprint do setor (A fazer, Em andamento…); padrão: a primeira
  addedAt?: string; // dia em que entrou na sprint (AAAA-MM-DD)
  doneAt?: string; // dia em que chegou em Finalizado (burn-up e burn-down dos Dashboards)
}

// Cores das tags: cada tag pega sempre a mesma cor (pelo texto), sem precisar configurar
const TAG_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#9b7be0', '#e87ba4', '#008300', '#4a3aa7', '#d03b3b'];

export function tagColor(tag: string) {
  let hash = 0;
  for (const char of tag) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}

// Quando entrou na sprint (addedAt) e quando chegou em Finalizado (doneAt): alimentam os Dashboards
function stamp(before: BacklogItem | undefined, after: BacklogItem): BacklogItem {
  const now = today();
  const addedAt = !after.sprintId ? undefined : before ? (before.sprintId === after.sprintId ? before.addedAt ?? now : now) : after.addedAt ?? now;
  const done = !!after.sprintId && !after.locked && after.sprintStatus === 'done';
  const doneAt = done ? (before?.doneAt ?? (before ? now : after.doneAt ?? now)) : undefined;
  return { ...after, addedAt, doneAt };
}

let nextId = 1;
export const newId = () => nextId++;

export function emptyItem(status: BacklogStatus = 'to-refine'): BacklogItem {
  return {
    id: 0,
    name: '',
    description: '',
    status,
    due: '',
    tags: [],
    assignee: '',
    sharedWith: [],
    comments: [],
    subtasks: [],
    attachments: [],
    locked: false,
    favorite: false,
  };
}

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);

// ponytail: atividades de exemplo, só em memória (somem ao recarregar; anexos usam object URL da sessão)
// Dia útil `day` (0 a 6) da sprint da Planning `id` (a 12 é a ativa; sprints de 7 dias úteis)
function sprintDay(id: number, day: number) {
  return sprintWindow(sprintOf(today()) + id - 12).days[day];
}

const SEED: Omit<BacklogItem, 'id'>[] = [
  { ...emptyItem('to-refine'), name: 'Padronizar e-mails de boas-vindas', sectorId: 1, description: 'Revisar textos e layout dos e-mails automáticos.', due: inDays(5), tags: ['comunicação'], assignee: 'Ana Souza', favorite: true },
  { ...emptyItem('to-refine'), name: 'Levantar ferramentas de BI', sectorId: 6, description: 'Comparar opções para os relatórios internos.', tags: ['pesquisa', 'dados'], assignee: 'Gabriela Nunes' },
  { ...emptyItem('refined'), name: 'Política de férias 2027', sectorId: 3, description: 'Definir janelas e regras de aprovação.', due: inDays(-2), tags: ['RH'], assignee: 'Felipe Costa', comments: [{ id: 1, author: 'Ana Souza', text: 'Falta validar com o jurídico.', time: hoursAgo(20) }] },
  {
    ...emptyItem('refined'),
    name: 'Organizar o onboarding de novos devs',
    sectorId: 6,
    tags: ['time', 'documentação'],
    assignee: 'Carlos Lima',
    subtasks: [
      { id: 1, title: 'Checklist do primeiro dia', done: true },
      { id: 2, title: 'Acessos e contas', done: true },
      { id: 3, title: 'Guia do repositório', done: false },
    ],
  },
  { ...emptyItem('waiting'), name: 'Renovar licenças de software', sectorId: 4, description: 'Aguardando orçamento do fornecedor.', due: inDays(10), tags: ['financeiro'], assignee: 'Diego Rocha', locked: true },
  { ...emptyItem('refinement-done'), name: 'Rotina de backup dos arquivos', sectorId: 4, tags: ['infra'], assignee: 'Felipe Costa', due: inDays(12) },
  { ...emptyItem('refinement-done'), name: 'Template de relatório mensal', sectorId: 3, tags: ['documentação'], assignee: 'Gabriela Nunes', due: inDays(8) },
  { ...emptyItem('refinement-done'), name: 'Treinamento de segurança', sectorId: 4, tags: ['time', 'infra'], assignee: 'Eva Martins', planning: 'waiting' },
  { ...emptyItem('refinement-done'), name: 'Automatizar convites da daily', sectorId: 4, tags: ['time'], assignee: 'Ana Souza', sharedWith: ['Carlos Lima'], sprintId: 12, sprintStatus: 'review', addedAt: sprintDay(12, 0) },
  { ...emptyItem('archived'), name: 'Pesquisa de clima Q2', tags: ['RH'], assignee: 'Ana Souza' },
  { ...emptyItem('canceled'), name: 'Migrar wiki para nova plataforma', tags: ['documentação'], assignee: 'Eva Martins' },
  { ...emptyItem('refinement-done'), name: 'Atualizar antivírus das máquinas', sectorId: 4, tags: ['infra'], assignee: 'Diego Rocha', sharedWith: ['Felipe Costa'], sprintId: 12, sprintStatus: 'done', addedAt: sprintDay(12, 0), doneAt: sprintDay(12, 1) },
  { ...emptyItem('refinement-done'), name: 'Revisar acessos do Drive', sectorId: 4, tags: ['segurança'], assignee: 'Carlos Lima', due: inDays(4), sprintId: 12, sprintStatus: 'todo', addedAt: sprintDay(12, 1) }, // entrou com a sprint em andamento
  // id 14: delegada à equipe Plataforma (aparece para todos os membros dela)
  { ...emptyItem('refinement-done'), name: 'Monitoramento dos servidores', sectorId: 4, tags: ['infra'], assignee: 'Felipe Costa', sprintId: 12, sprintStatus: 'doing', addedAt: sprintDay(12, 0) },
  ...history(),
];

// [sprint, setor, atividade, responsável, dia da entrega (0 a 6), compartilhada com]
function history(): Omit<BacklogItem, 'id'>[] {
  const rows: [number, number, string, string, number, string[]?][] = [
    [8, 4, 'Atualizar política de senhas', 'Felipe Costa', 3],
    [8, 4, 'Inventário de notebooks', 'Diego Rocha', 5],
    [8, 3, 'Conciliação bancária de agosto', 'Diego Rocha', 4],
    [8, 1, 'Calendário de posts de setembro', 'Ana Souza', 6],
    [9, 4, 'Trocar roteador do escritório', 'Carlos Lima', 2, ['Diego Rocha']],
    [9, 4, 'Backup do servidor de arquivos', 'Felipe Costa', 4],
    [9, 4, 'Padronizar imagens das máquinas', 'Diego Rocha', 6],
    [9, 3, 'Fechamento contábil de agosto', 'Diego Rocha', 5],
    [9, 1, 'Briefing da campanha de outubro', 'Ana Souza', 3],
    [9, 6, 'Pesquisa com clientes do app', 'Bruna Alves', 6],
    [10, 4, 'Revisar permissões do ERP', 'Carlos Lima', 4],
    [10, 4, 'Documentar rede interna', 'Felipe Costa', 6, ['Carlos Lima']],
    [10, 3, 'Orçamento de TI 2027', 'Diego Rocha', 5],
    [10, 5, 'Base de conhecimento do suporte', 'Eva Martins', 6],
    [11, 4, 'Configurar VPN para viagens', 'Diego Rocha', 2],
    [11, 4, 'Auditoria de licenças', 'Felipe Costa', 3],
    [11, 4, 'Treinar equipe no novo Wi-Fi', 'Carlos Lima', 5],
    [11, 4, 'Atualizar firmware das impressoras', 'Diego Rocha', 6],
    [11, 3, 'Fechamento contábil de setembro', 'Diego Rocha', 4],
    [11, 1, 'Relatório de redes sociais', 'Ana Souza', 5],
    [11, 6, 'Roadmap do 4º trimestre', 'Bruna Alves', 6, ['Eva Martins']],
  ];
  return rows.map(([sprint, sectorId, name, assignee, done, sharedWith = []]) => ({
    ...emptyItem('archived'),
    name,
    sectorId,
    assignee,
    sharedWith,
    sprintId: sprint,
    sprintStatus: 'done',
    addedAt: sprintDay(sprint, done >= 5 && name.length % 3 === 0 ? 2 : 0), // algumas entraram no meio da sprint
    doneAt: sprintDay(sprint, done),
  }));
}

// Atividades gerais do backlog (não são atividades de projeto)
@Injectable({ providedIn: 'root' })
export class BacklogStore {
  private readonly audit = inject(AuditStore);
  private readonly members = inject(MembersStore);
  // ids fixos (1, 2, 3…) nos exemplos: equipes e favoritos apontam para eles
  readonly items = signal<BacklogItem[]>(SEED.map((item, i) => ({ ...item, id: i + 1 })));
  // Colunas fixas + criadas pelo usuário (ponytail: só em memória, como as atividades)
  readonly columns = signal(BACKLOG_COLUMNS);

  // Atividades da empresa escolhida (Backlog e Planning); sem empresa: exemplos e testes
  private readonly companyId = inject(CompanyStore).currentId;
  readonly ofCompany = computed(() => this.items().filter((i) => i.companyId === undefined || this.companyId() === null || i.companyId === this.companyId()));

  label(status: BacklogStatus) {
    return this.columns().find((column) => column.id === status)?.label ?? status;
  }

  renameColumn(id: BacklogStatus, label: string) {
    if (!this.members.isAdmin()) return; // só admin mexe nas colunas
    const before = this.label(id);
    this.columns.update((list) => list.map((column) => (column.id === id ? { ...column, label } : column)));
    this.audit.log({ action: 'update', entity: 'Coluna do backlog', name: label, from: before, to: label });
  }

  // As atividades da coluna excluída vão para a primeira coluna
  removeColumn(id: BacklogStatus) {
    if (!this.members.isAdmin()) return; // só admin mexe nas colunas
    const fallback = this.columns()[0];
    const moved = this.items().filter((item) => item.status === id).length;
    const name = this.label(id);
    this.items.update((list) => list.map((item) => (item.status === id ? { ...item, status: fallback.id } : item)));
    this.columns.update((list) => list.filter((column) => column.id !== id));
    this.audit.log({ action: 'delete', entity: 'Coluna do backlog', name, details: moved ? `${moved} atividade(s) movida(s) para ${fallback.label}` : undefined });
  }

  addColumn(label: string) {
    if (!this.members.isAdmin()) return; // só admin mexe nas colunas
    this.columns.update((list) => [...list, customColumn(label, list.length)]);
    this.audit.log({ action: 'create', entity: 'Coluna do backlog', name: label });
  }

  save(item: BacklogItem, sprintLabel: (status: BacklogItem) => string = (i) => i.sprintStatus ?? '—') {
    if (item.id) {
      const before = this.items().find((current) => current.id === item.id);
      this.items.update((list) => list.map((current) => (current.id === item.id ? stamp(current, item) : current)));
      if (before) this.logChanges(before, item);
      if (before?.sprintId && sprintLabel(before) !== sprintLabel(item)) {
        this.audit.log({ action: 'move', entity: 'Atividade da sprint', name: item.name, from: sprintLabel(before), to: sprintLabel(item) });
      }
    } else {
      const companyId = item.companyId ?? this.companyId() ?? undefined; // nasce na empresa escolhida
      this.items.update((list) => [...list, stamp(undefined, { ...item, companyId, id: Math.max(0, ...list.map((current) => current.id)) + 1 })]);
      this.audit.log({ action: 'create', entity: 'Atividade', name: item.name, to: this.label(item.status) });
    }
  }

  patch(id: number, changes: Partial<BacklogItem>) {
    const before = this.items().find((item) => item.id === id);
    this.items.update((list) => list.map((item) => (item.id === id ? stamp(item, { ...item, ...changes }) : item)));
    if (before) this.logChanges(before, { ...before, ...changes });
  }

  move(id: number, status: BacklogStatus) {
    const before = this.items().find((item) => item.id === id);
    if (!before || before.locked || before.status === status) return;
    this.items.update((list) => list.map((item) => (item.id === id ? { ...item, status } : item)));
    this.logChanges(before, { ...before, status });
  }

  // Status na sprint (kanban do setor). "blocked" = cadeado; sair de Bloqueado desbloqueia o cartão.
  setSprintStatus(id: number, status: string, labels: { from: string; to: string }) {
    const before = this.items().find((item) => item.id === id);
    if (!before || labels.from === labels.to) return;
    const changes = status === 'blocked' ? { locked: true } : { locked: false, sprintStatus: status };
    this.items.update((list) => list.map((item) => (item.id === id ? stamp(item, { ...item, ...changes }) : item)));
    this.audit.log({ action: 'move', entity: 'Atividade da sprint', name: before.name, ...labels });
  }

  remove(id: number) {
    const item = this.items().find((current) => current.id === id);
    item?.attachments.forEach((file) => URL.revokeObjectURL(file.url));
    this.items.update((list) => list.filter((current) => current.id !== id));
    if (item) this.audit.log({ action: 'delete', entity: 'Atividade', name: item.name, from: this.label(item.status) });
  }

  // Auditoria: mudança de coluna vira movimentação/arquivamento/cancelamento; o resto vira alteração
  private logChanges(before: BacklogItem, after: BacklogItem) {
    const name = after.name;
    if (before.status !== after.status) {
      const action: AuditAction = after.status === 'archived' ? 'archive' : after.status === 'canceled' ? 'cancel' : 'move';
      this.audit.log({ action, entity: 'Atividade', name, from: this.label(before.status), to: this.label(after.status) });
    }
    if (before.sprintId !== after.sprintId) {
      const sprint = (id?: number) => (id ? `Sprint ${id}` : 'Planning');
      this.audit.log({ action: 'move', entity: 'Atividade', name, from: sprint(before.sprintId), to: sprint(after.sprintId) });
    }
    const details = diff(
      { ...before, attachments: before.attachments.map((a) => a.name), subtasks: before.subtasks.length, comments: before.comments.length },
      { ...after, attachments: after.attachments.map((a) => a.name), subtasks: after.subtasks.length, comments: after.comments.length },
      FIELD_LABELS,
    );
    if (details) this.audit.log({ action: 'update', entity: 'Atividade', name, details });
  }
}

// Campos acompanhados na auditoria (status e sprint têm registro próprio)
const FIELD_LABELS: Record<string, string> = {
  name: 'Nome',
  description: 'Descrição',
  due: 'Prazo',
  tags: 'Tags',
  assignee: 'Responsável',
  sharedWith: 'Compartilhada com',
  locked: 'Bloqueado',
  favorite: 'Favorito',
  planning: 'Categoria na planning',
  subtasks: 'Sub atividades',
  comments: 'Comentários',
  attachments: 'Anexos',
};
