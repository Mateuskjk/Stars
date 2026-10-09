import { Injectable, inject, signal } from '@angular/core';
import { MembersStore } from '../members/members-store';
import { AuditStore, diff } from '../audit/audit-store';

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
  { id: 2, name: 'Plataforma', focus: 'Dados, infraestrutura e segurança', memberIds: [4, 6], projectIds: [6], activityIds: [6, 14] },
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

  private readonly audit = inject(AuditStore);

  create(data: TeamData) {
    const id = Math.max(0, ...this.teams().map((team) => team.id)) + 1;
    const team = { ...data, name: data.name.trim(), id, memberIds: this.onlyEligible(data.memberIds) };
    this.teams.update((list) => [...list, team]);
    this.audit.log({
      action: 'create',
      entity: 'Equipe',
      name: team.name,
      details: `${team.memberIds.length} membros · ${team.projectIds.length} projetos · ${team.activityIds.length} atividades`,
    });
    return id;
  }

  update(id: number, data: TeamData) {
    const before = this.teams().find((team) => team.id === id);
    const after = { ...data, name: data.name.trim(), id, memberIds: this.onlyEligible(data.memberIds) };
    this.teams.update((list) => list.map((team) => (team.id === id ? after : team)));
    if (!before) return;
    const count = (t: Team) => ({ ...t, memberIds: t.memberIds.length, projectIds: t.projectIds.length, activityIds: t.activityIds.length });
    const details = diff(count(before), count(after), { name: 'Nome', focus: 'Foco', memberIds: 'Membros', projectIds: 'Projetos', activityIds: 'Atividades' });
    if (details) this.audit.log({ action: 'update', entity: 'Equipe', name: after.name, details });
  }

  remove(id: number) {
    const team = this.teams().find((current) => current.id === id);
    this.teams.update((list) => list.filter((current) => current.id !== id));
    if (team) this.audit.log({ action: 'delete', entity: 'Equipe', name: team.name });
  }
}
