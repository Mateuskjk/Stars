import { Injectable, computed, signal } from '@angular/core';

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
const SEED: Sprint[] = [
  { id: 11, name: 'Sprint 11', start: isoDay(-17), end: isoDay(-4), goal: 'Estabilizar o portal do cliente', status: 'closed' },
  { id: 12, name: 'Sprint 12', start: isoDay(-3), end: isoDay(10), goal: 'Organizar processos internos do time', status: 'active' },
];

// Uma sprint ativa por vez: para criar outra, a atual precisa ser fechada ou cancelada
@Injectable({ providedIn: 'root' })
export class SprintStore {
  readonly sprints = signal<Sprint[]>(SEED);
  readonly active = computed(() => this.sprints().find((sprint) => sprint.status === 'active') ?? null);
  readonly nextNumber = computed(() => Math.max(0, ...this.sprints().map((sprint) => sprint.id)) + 1);

  create(sprint: Omit<Sprint, 'id' | 'status'>) {
    if (this.active()) return;
    this.sprints.update((list) => [...list, { ...sprint, id: this.nextNumber(), status: 'active' }]);
  }

  setStatus(id: number, status: SprintStatus) {
    this.sprints.update((list) => list.map((sprint) => (sprint.id === id ? { ...sprint, status } : sprint)));
  }
}
