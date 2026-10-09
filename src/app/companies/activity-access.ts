import { Injectable, computed, inject } from '@angular/core';
import { BacklogItem } from '../backlog/backlog-store';
import { MembersStore } from '../members/members-store';
import { TeamsStore } from '../teams/teams-store';
import { SectorStore } from './sector-store';

// Quem vê quais atividades gerais (kanban do setor e Dashboards):
// admin e supervisor veem tudo; o gestor vê tudo do setor dele; os demais veem só as próprias,
// as compartilhadas com eles e as delegadas a uma equipe da qual fazem parte.
// SEGURANÇA: isto só filtra a tela. Com backend, o servidor tem de aplicar a mesma regra.
@Injectable({ providedIn: 'root' })
export class ActivityAccess {
  private readonly members = inject(MembersStore);
  private readonly teams = inject(TeamsStore);
  private readonly sectors = inject(SectorStore);

  readonly viewer = this.members.current;
  readonly seesAll = computed(() => {
    const viewer = this.viewer();
    return !viewer || viewer.role !== 'member';
  });
  private readonly managedSectors = computed(() => {
    const name = this.viewer()?.name;
    return new Set(this.sectors.sectors().filter((s) => name && s.manager === name).map((s) => s.id));
  });
  private readonly teamActivities = computed(() => {
    const viewer = this.viewer();
    const mine = this.teams.teams().filter((team) => viewer && team.memberIds.includes(viewer.id));
    return new Set(mine.flatMap((team) => team.activityIds));
  });

  // A pessoa vê tudo deste setor? (sem setor: vale a regra geral)
  seesAllOf(sectorId?: number) {
    return this.seesAll() || (sectorId !== undefined && this.managedSectors().has(sectorId));
  }

  canSee(item: BacklogItem) {
    if (this.seesAllOf(item.sectorId)) return true;
    const name = this.viewer()!.name;
    return item.assignee === name || item.sharedWith.includes(name) || this.teamActivities().has(item.id);
  }

  teamOf(item: BacklogItem) {
    return this.teams.teams().find((team) => team.activityIds.includes(item.id))?.name ?? null;
  }
}
