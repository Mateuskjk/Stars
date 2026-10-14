import { Injectable, inject, signal } from '@angular/core';
import { AuditStore, diff } from '../audit/audit-store';
import { CustomColumnId, KanbanColumn, customColumn } from '../kanban/add-column';
import { MembersStore } from '../members/members-store';

// ---------- Calendário: sprints de 7 dias úteis ----------
// ponytail: só pula sábado e domingo; feriados entram quando houver um calendário da empresa

export const SPRINT_DAYS = 7;
const ANCHOR = '2026-01-05'; // segunda-feira em que a Sprint 1 começou

export const parseDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const toDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const today = () => toDay(new Date());

// Posição do dia contando só dias úteis desde a âncora (sábado e domingo valem como a sexta anterior)
export function businessIndex(day: string) {
  const days = Math.round((parseDay(day).getTime() - parseDay(ANCHOR).getTime()) / 86_400_000);
  const weeks = Math.floor(days / 7);
  return weeks * 5 + Math.min(days - weeks * 7, 4);
}

// Dia útil número `index` a partir da âncora
export function businessDay(index: number) {
  const weeks = Math.floor(index / 5);
  const date = parseDay(ANCHOR);
  date.setDate(date.getDate() + weeks * 7 + (index - weeks * 5));
  return toDay(date);
}

export interface SprintWindow {
  number: number;
  start: string;
  end: string;
  days: string[]; // os 7 dias úteis
}

export function sprintWindow(number: number): SprintWindow {
  const first = (number - 1) * SPRINT_DAYS;
  const days = Array.from({ length: SPRINT_DAYS }, (_, i) => businessDay(first + i));
  return { number, start: days[0], end: days[SPRINT_DAYS - 1], days };
}

export const sprintOf = (day: string) => Math.floor(businessIndex(day) / SPRINT_DAYS) + 1;

// ---------- Atividades dos projetos ----------

export type DefaultTaskStatus = 'todo' | 'doing' | 'review' | 'done';
export type TaskStatus = DefaultTaskStatus | CustomColumnId; // + colunas criadas no kanban do projeto

// Só "Concluída" conta como entregue nos gráficos; as outras colunas são trabalho em aberto
export const TASK_STATUSES: Record<DefaultTaskStatus, { label: string; color: string }> = {
  todo: { label: 'A fazer', color: '#898781' },
  doing: { label: 'Em andamento', color: '#2a78d6' },
  review: { label: 'Revisão', color: '#eda100' },
  done: { label: 'Concluída', color: '#0ca30c' },
};

export interface ProjectTask {
  id: number;
  projectId: number;
  title: string;
  description?: string;
  assignee: string;
  points: number; // story points
  status: TaskStatus;
  sprint: number; // sprint em que foi comprometida
  start: string; // planejado (AAAA-MM-DD)
  end: string;
  createdAt: string; // quando entrou no escopo
  doneAt: string | null;
}

// ---------- Dados de exemplo ----------
// ponytail: geradas a partir de hoje, só em memória; trocar pela API quando o backend existir.
// Cada projeto tem um ritmo diferente para os gráficos mostrarem casos reais (no prazo, atrasado, parado).

interface Plan {
  projectId: number;
  firstSprint: number; // relativo à sprint atual
  pace: number; // chance de uma atividade fechar dentro da sprint
  mode?: 'finished' | 'stalled'; // finished: tudo entregue; stalled: parou há 2 sprints
  people: string[];
  titles: string[];
}

const PLANS: Plan[] = [
  {
    projectId: 1,
    firstSprint: -4,
    pace: 0.9,
    people: ['Bruna Alves', 'Diego Rocha', 'Ana Souza'],
    titles: ['Pesquisa com usuários', 'Wireframes da home', 'Guia de estilo', 'Nova home com carrossel', 'Página de produtos', 'Menu responsivo', 'Formulário de contato', 'SEO técnico', 'Testes de acessibilidade', 'Ajustes de performance', 'Migração de conteúdo', 'Revisão de textos', 'Analytics', 'Publicação', 'Landing de campanha', 'Ajustes pós-lançamento', 'Relatório de resultados'],
  },
  {
    projectId: 2,
    firstSprint: -5,
    pace: 0.62,
    people: ['Carlos Lima', 'Eva Martins', 'Felipe Costa'],
    titles: ['Arquitetura do app', 'Login com e-mail', 'Login com biometria', 'Tela inicial', 'Catálogo', 'Carrinho', 'Pagamento in-app', 'Notificações push', 'Modo offline', 'Perfil do usuário', 'Testes em iOS', 'Testes em Android', 'Publicação nas lojas', 'Versão para tablet', 'Analytics do app', 'Acessibilidade', 'Correções da beta', 'Onboarding do app', 'Avaliações na loja', 'Deep links', 'Monitoramento de erros', 'Otimização de bateria', 'Atualização automática', 'Termos de uso'],
  },
  {
    projectId: 3,
    firstSprint: -5,
    pace: 0.95,
    people: ['Diego Rocha', 'Eva Martins'],
    titles: ['Área logada', 'Segunda via de fatura', 'Histórico de pagamentos', 'Abertura de chamados', 'Chat de suporte', 'Integração de pagamento', 'Notificações por e-mail', 'Testes end-to-end', 'Ajustes de segurança', 'Manual do cliente', 'Treinamento do suporte', 'Homologação', 'Painel de indicadores', 'Exportar relatórios', 'Ajustes finais', 'Go-live'],
  },
  {
    projectId: 4,
    firstSprint: -8,
    pace: 1,
    mode: 'finished',
    people: ['Gabriela Nunes', 'Felipe Costa'],
    titles: ['Modelo de dados do funil', 'Cadastro de oportunidades', 'Importar clientes', 'Relatório de funil', 'Metas por vendedor', 'Integração com e-mail', 'Painel do gestor', 'Chat com IA no CRM', 'Treinamento comercial', 'Ajustes finais', 'Documentação', 'Go-live'],
  },
  {
    projectId: 5,
    firstSprint: -4,
    pace: 0.85,
    mode: 'stalled',
    people: ['Bruna Alves', 'Ana Souza'],
    titles: ['Conceito da campanha', 'Roteiro do vídeo', 'Peças para redes sociais', 'Landing page', 'Mídia paga', 'E-mail marketing', 'Influenciadores', 'Relatório parcial', 'Ajustes de criativos', 'Peças de Natal', 'Relatório final', 'Pós-campanha'],
  },
  {
    projectId: 6,
    firstSprint: -1,
    pace: 0.85,
    people: ['Felipe Costa', 'Gabriela Nunes', 'Carlos Lima'],
    titles: ['Levantamento das fontes', 'Arquitetura do Data Lake', 'Migração do banco', 'Pipeline de vendas', 'Pipeline financeiro', 'Catálogo de dados', 'Governança e acessos', 'Qualidade dos dados', 'Painel executivo', 'Pipeline de RH', 'Monitoramento', 'Documentação', 'Treinamento das áreas', 'Desligar planilhas antigas', 'Pipeline de marketing', 'Ajustes de custo', 'Backup e recuperação', 'Go-live'],
  },
  {
    projectId: 7,
    firstSprint: -11,
    pace: 1,
    mode: 'finished',
    people: ['Ana Souza'],
    titles: ['Mapa da jornada', 'Trilha de boas-vindas', 'E-mails automáticos', 'Vídeos tutoriais', 'Central de ajuda', 'Pesquisa de satisfação', 'Ajustes da trilha', 'Relatório final', 'Landing page antiga', 'Encerramento'],
  },
];

// Gerador pseudoaleatório com semente: os mesmos dados a cada carregamento
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POINTS = [1, 2, 3, 3, 5, 5, 8];

export function seedTasks(now = today()): ProjectTask[] {
  const current = sprintOf(now);
  const dayInSprint = businessIndex(now) - (current - 1) * SPRINT_DAYS; // 0..6
  const tasks: ProjectTask[] = [];

  for (const plan of PLANS) {
    const rand = random(plan.projectId * 97);
    const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)];
    const projectStart = sprintWindow(current + plan.firstSprint).start;

    plan.titles.forEach((title, i) => {
      const sprint = current + plan.firstSprint + Math.floor(i / 3);
      const window = sprintWindow(sprint);
      const r = sprint - current;
      const points = pick(POINTS);
      const lastDay = r < 0 ? SPRINT_DAYS - 1 : r === 0 ? dayInSprint : -1; // último dia já vivido da sprint

      // Escopo: a maior parte entra no início; parte entra 2 sprints antes; ~15% entra com a sprint em andamento
      let createdIndex = -1;
      let createdAt = rand() < 0.7 ? projectStart : [projectStart, sprintWindow(sprint - 2).start].sort().at(-1)!;
      if (lastDay >= 1 && rand() < 0.15) {
        createdIndex = 1 + Math.floor(rand() * Math.min(lastDay, 4));
        createdAt = window.days[createdIndex];
      }
      if (createdAt > now) createdAt = now;

      let status: TaskStatus = 'todo';
      let doneAt: string | null = null;
      const stalled = plan.mode === 'stalled' && sprint >= current - 1;
      const closes = plan.mode === 'finished' || (!stalled && lastDay >= 0 && rand() < plan.pace * (r < 0 ? 1 : (lastDay + 2) / SPRINT_DAYS));
      if (closes) {
        status = 'done';
        // dia da entrega: entre a criação e o último dia já vivido da sprint
        const from = Math.max(createdIndex, r === 0 ? 0 : 1);
        const to = lastDay < 0 ? SPRINT_DAYS - 1 : lastDay;
        doneAt = window.days[from + Math.floor(rand() * (to - from + 1))];
      } else if (r <= 0) {
        status = stalled ? 'doing' : pick<TaskStatus>(['doing', 'doing', 'review', 'todo']);
      }

      tasks.push({
        id: tasks.length + 1,
        projectId: plan.projectId,
        title,
        assignee: pick(plan.people),
        points,
        status,
        sprint,
        start: window.start,
        end: points === 8 ? sprintWindow(sprint + 1).end : window.end, // atividades grandes ocupam 2 sprints
        createdAt,
        doneAt,
      });
    });
  }
  return tasks;
}

// Atividades de todos os projetos: o Dash de Projetos (burn-up, burn-down, Gantt) lê daqui
@Injectable({ providedIn: 'root' })
export class ProjectTaskStore {
  readonly tasks = signal<ProjectTask[]>(seedTasks());
  // Colunas do kanban de atividades (as mesmas em todos os projetos). ponytail: só em memória
  readonly columns = signal<KanbanColumn<TaskStatus>[]>(Object.entries(TASK_STATUSES).map(([id, s]) => ({ id: id as TaskStatus, ...s })));
  private readonly audit = inject(AuditStore);
  private readonly members = inject(MembersStore);

  column(status: TaskStatus) {
    return this.columns().find((column) => column.id === status) ?? { id: status, label: status, color: '#898781' };
  }

  add(task: Omit<ProjectTask, 'id' | 'createdAt' | 'doneAt'>, projectName: string) {
    const now = today();
    const id = Math.max(0, ...this.tasks().map((t) => t.id)) + 1;
    this.tasks.update((list) => [...list, { ...task, id, createdAt: now, doneAt: task.status === 'done' ? now : null }]);
    this.audit.log({ action: 'create', entity: 'Atividade de projeto', name: task.title, to: this.column(task.status).label, details: `Projeto: ${projectName} · ${task.points} pts · Sprint ${task.sprint}` });
  }

  // Editar pelo modal do cartão. Mudar a sprint move o período planejado junto; chegar em Concluída marca a entrega.
  update(id: number, changes: Partial<Pick<ProjectTask, 'title' | 'description' | 'assignee' | 'points' | 'sprint' | 'status' | 'end'>>) {
    const before = this.tasks().find((task) => task.id === id);
    if (!before) return;
    const after: ProjectTask = { ...before, ...changes };
    if (changes.sprint !== undefined && changes.sprint !== before.sprint) {
      const window = sprintWindow(changes.sprint);
      after.start = window.start;
      if (changes.end === undefined || changes.end === before.end) after.end = after.points >= 8 ? sprintWindow(changes.sprint + 1).end : window.end;
    }
    if (after.status !== before.status) after.doneAt = after.status === 'done' ? today() : null;
    this.tasks.update((list) => list.map((task) => (task.id === id ? after : task)));
    if (after.status !== before.status) {
      this.audit.log({ action: 'move', entity: 'Atividade de projeto', name: after.title, from: this.column(before.status).label, to: this.column(after.status).label });
    }
    const details = diff(before, after, { title: 'Nome', description: 'Descrição', assignee: 'Responsável', points: 'Pontos', sprint: 'Sprint', end: 'Prazo' });
    if (details) this.audit.log({ action: 'update', entity: 'Atividade de projeto', name: after.title, details });
  }

  remove(id: number) {
    const task = this.tasks().find((t) => t.id === id);
    if (!task) return;
    this.tasks.update((list) => list.filter((t) => t.id !== id));
    this.audit.log({ action: 'delete', entity: 'Atividade de projeto', name: task.title, from: this.column(task.status).label });
  }

  // Sai das telas; no banco fica arquivada (a gravação está em api-sync), e aparece em /arquivo
  archive(id: number) {
    const task = this.tasks().find((t) => t.id === id);
    if (!task) return;
    this.tasks.update((list) => list.filter((t) => t.id !== id));
    this.audit.log({ action: 'archive', entity: 'Atividade de projeto', name: task.title, from: this.column(task.status).label, to: 'Arquivado' });
  }

  setStatus(id: number, status: TaskStatus) {
    const before = this.tasks().find((task) => task.id === id);
    if (!before || before.status === status) return;
    const doneAt = status === 'done' ? today() : null;
    this.tasks.update((list) => list.map((task) => (task.id === id ? { ...task, status, doneAt } : task)));
    this.audit.log({ action: 'move', entity: 'Atividade de projeto', name: before.title, from: this.column(before.status).label, to: this.column(status).label });
  }

  addColumn(label: string) {
    if (!this.members.isAdmin()) return; // só admin mexe nas colunas
    this.columns.update((list) => [...list, customColumn(label, list.length)]);
    this.audit.log({ action: 'create', entity: 'Coluna de atividades de projeto', name: label });
  }

  renameColumn(id: TaskStatus, label: string) {
    if (!this.members.isAdmin()) return;
    const before = this.column(id).label;
    this.columns.update((list) => list.map((column) => (column.id === id ? { ...column, label } : column)));
    this.audit.log({ action: 'update', entity: 'Coluna de atividades de projeto', name: label, from: before, to: label });
  }

  // As atividades da coluna excluída voltam para "A fazer"
  removeColumn(id: TaskStatus) {
    if (!this.members.isAdmin()) return;
    const name = this.column(id).label;
    const moved = this.tasks().filter((task) => task.status === id).length;
    this.tasks.update((list) => list.map((task) => (task.status === id ? { ...task, status: 'todo' } : task)));
    this.columns.update((list) => list.filter((column) => column.id !== id));
    this.audit.log({ action: 'delete', entity: 'Coluna de atividades de projeto', name, details: moved ? `${moved} atividade(s) movida(s) para ${TASK_STATUSES.todo.label}` : undefined });
  }
}
