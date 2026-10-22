import { Injectable, computed, inject, signal } from '@angular/core';
import { sprintOf, sprintWindow, today } from '../projects/project-tasks';
import { CompanyStore } from '../companies/company-store';

export type SprintStatus = 'active' | 'closed' | 'archived' | 'canceled';

export const SPRINT_STATUS: Record<SprintStatus, { label: string; color: string }> = {
  active: { label: 'Ativa', color: '#0ca30c' },
  closed: { label: 'Fechada', color: '#2a78d6' },
  archived: { label: 'Arquivada', color: '#898781' },
  canceled: { label: 'Cancelada', color: '#d03b3b' },
};

export interface Sprint {
  id: number;
  name: string;
  start: string; // AAAA-MM-DD
  end: string;
  goal: string;
  status: SprintStatus;
  companyId?: number; // empresa da sprint (dados do banco): cada empresa tem a sua sprint ativa
}

// Sprints de 7 dias úteis (mesmo calendário do Dash de Projetos): a atual contém hoje
const businessSprint = (offset: number) => sprintWindow(sprintOf(today()) + offset);

// ponytail: sprints de exemplo, só em memória (somem ao recarregar); trocar por API quando o backend existir
// Sprints de 7 dias úteis: 4 sprints ≈ 1 mês e meio (é o período do relatório)
const SEED: Sprint[] = [
  { id: 8, name: 'Sprint 8', start: businessSprint(-4).start, end: businessSprint(-4).end, goal: 'Primeira versão do CRM interno', status: 'archived' },
  { id: 9, name: 'Sprint 9', start: businessSprint(-3).start, end: businessSprint(-3).end, goal: 'Relatórios do funil de vendas', status: 'closed' },
  { id: 10, name: 'Sprint 10', start: businessSprint(-2).start, end: businessSprint(-2).end, goal: 'Login com biometria no app', status: 'closed' },
  { id: 11, name: 'Sprint 11', start: businessSprint(-1).start, end: businessSprint(-1).end, goal: 'Estabilizar o portal do cliente', status: 'closed' },
  { id: 12, name: 'Sprint 12', start: businessSprint(0).start, end: businessSprint(0).end, goal: 'Organizar processos internos do time', status: 'active' },
];

// Uma sprint ativa por vez: para criar outra, a atual precisa ser fechada ou cancelada
@Injectable({ providedIn: 'root' })
export class SprintStore {
  readonly sprints = signal<Sprint[]>(SEED);
  private readonly companyId = inject(CompanyStore).currentId;
  // Sprints da empresa escolhida (sem empresa: exemplos e testes)
  readonly ofCompany = computed(() => this.sprints().filter((s) => s.companyId === undefined || this.companyId() === null || s.companyId === this.companyId()));
  readonly active = computed(() => this.ofCompany().find((sprint) => sprint.status === 'active') ?? null);
  readonly nextNumber = computed(() => Math.max(0, ...this.sprints().map((sprint) => sprint.id)) + 1);


  // Sprint ativa de uma empresa (página do setor)
  activeOf(companyId: number | undefined) {
    return this.sprints().find((s) => s.status === 'active' && (s.companyId === undefined || s.companyId === companyId)) ?? null;
  }

  byId(id: number | undefined) {
    return this.sprints().find((sprint) => sprint.id === id) ?? null;
  }

  create(sprint: Omit<Sprint, 'id' | 'status'>) {
    if (this.active()) return;
    this.sprints.update((list) => [...list, { ...sprint, id: this.nextNumber(), status: 'active', companyId: this.companyId() ?? undefined }]);
  }

  setStatus(id: number, status: SprintStatus) {
    const before = this.sprints().find((sprint) => sprint.id === id);
    if (!before || before.status === status) return;
    this.sprints.update((list) => list.map((sprint) => (sprint.id === id ? { ...sprint, status } : sprint)));
  }
}
