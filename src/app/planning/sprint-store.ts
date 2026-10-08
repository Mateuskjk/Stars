import { Injectable, computed, inject, signal } from '@angular/core';
import { AuditStore } from '../audit/audit-store';

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
}

const isoDay = (offset: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
};

// ponytail: sprints de exemplo, só em memória (somem ao recarregar); trocar por API quando o backend existir
// Sprints semanais: 4 sprints ≈ 1 mês (é o período do relatório)
const SEED: Sprint[] = [
  { id: 8, name: 'Sprint 8', start: isoDay(-31), end: isoDay(-25), goal: 'Primeira versão do CRM interno', status: 'archived' },
  { id: 9, name: 'Sprint 9', start: isoDay(-24), end: isoDay(-18), goal: 'Relatórios do funil de vendas', status: 'closed' },
  { id: 10, name: 'Sprint 10', start: isoDay(-17), end: isoDay(-11), goal: 'Login com biometria no app', status: 'closed' },
  { id: 11, name: 'Sprint 11', start: isoDay(-10), end: isoDay(-4), goal: 'Estabilizar o portal do cliente', status: 'closed' },
  { id: 12, name: 'Sprint 12', start: isoDay(-3), end: isoDay(3), goal: 'Organizar processos internos do time', status: 'active' },
];

// Uma sprint ativa por vez: para criar outra, a atual precisa ser fechada ou cancelada
@Injectable({ providedIn: 'root' })
export class SprintStore {
  readonly sprints = signal<Sprint[]>(SEED);
  readonly active = computed(() => this.sprints().find((sprint) => sprint.status === 'active') ?? null);
  readonly nextNumber = computed(() => Math.max(0, ...this.sprints().map((sprint) => sprint.id)) + 1);

  private readonly audit = inject(AuditStore);

  create(sprint: Omit<Sprint, 'id' | 'status'>) {
    if (this.active()) return;
    this.sprints.update((list) => [...list, { ...sprint, id: this.nextNumber(), status: 'active' }]);
    this.audit.log({ action: 'create', entity: 'Sprint', name: sprint.name, to: SPRINT_STATUS.active.label, details: `Período: ${sprint.start} a ${sprint.end}` });
  }

  setStatus(id: number, status: SprintStatus) {
    const before = this.sprints().find((sprint) => sprint.id === id);
    if (!before || before.status === status) return;
    this.sprints.update((list) => list.map((sprint) => (sprint.id === id ? { ...sprint, status } : sprint)));
    const action = status === 'closed' ? 'close' : status === 'archived' ? 'archive' : status === 'canceled' ? 'cancel' : 'update';
    this.audit.log({ action, entity: 'Sprint', name: before.name, from: SPRINT_STATUS[before.status].label, to: SPRINT_STATUS[status].label });
  }
}
