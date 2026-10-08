import { Injectable, inject, signal } from '@angular/core';
import { MembersStore } from '../members/members-store';

export interface Team {
  id: number;
  name: string;
  focus: string; // no que a equipe está focada
  memberIds: number[];
  projectIds: number[]; // projetos associados (ProjectStore)
  activityIds: number[]; // atividades gerais delegadas (BacklogStore)
}

export type TeamData = Omit<Team, 'id'>;

// ponytail: equipes de exemplo, só em memória (somem ao recarregar); trocar por API quando o backend existir
const SEED: Team[] = [
  { id: 1, name: 'Produto', focus: 'Experiência do cliente no site e no app', memberIds: [1, 2, 3], projectIds: [1, 2], activityIds: [1, 4] },
  { id: 2, name: 'Plataforma', focus: 'Dados, infraestrutura e segurança', memberIds: [4, 6], projectIds: [6], activityIds: [6] },
];

@Injectable({ providedIn: 'root' })
export class TeamsStore {
  private readonly members = inject(MembersStore);
  readonly teams = signal<Team[]>(SEED);

  // Regra: só entra na equipe quem está ativo no sistema e ligado a um perfil de empresa
  private onlyEligible(memberIds: number[]) {
    const eligible = new Set(this.members.eligibleForTeams().map((member) => member.id));
    return [...new Set(memberIds)].filter((id) => eligible.has(id));
  }

  create(data: TeamData) {
    const id = Math.max(0, ...this.teams().map((team) => team.id)) + 1;
    this.teams.update((list) => [...list, { ...data, name: data.name.trim(), id, memberIds: this.onlyEligible(data.memberIds) }]);
    return id;
  }

  update(id: number, data: TeamData) {
    this.teams.update((list) =>
      list.map((team) => (team.id === id ? { ...data, name: data.name.trim(), id, memberIds: this.onlyEligible(data.memberIds) } : team)),
    );
  }

  remove(id: number) {
    this.teams.update((list) => list.filter((team) => team.id !== id));
  }
}
