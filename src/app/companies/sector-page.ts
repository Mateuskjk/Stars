import { Component, computed, inject, input, signal } from '@angular/core';
import { PeopleStore } from '../members/people-store';
import { Router, RouterLink } from '@angular/router';
import { BacklogEditor } from '../backlog/backlog-editor';
import { BacklogItem, BacklogStore, emptyItem, tagColor } from '../backlog/backlog-store';
import { AddColumn } from '../kanban/add-column';
import { ColumnTitle, isCustomColumn } from '../kanban/column-title';
import { MembersStore } from '../members/members-store';
import { PeoplePicker } from '../members/people-picker';
import { SprintStore } from '../planning/sprint-store';
import { SPRINT_DAYS, businessIndex, today } from '../projects/project-tasks';
import { ProjectStore } from '../projects/project-store';
import { initials } from '../projects/projects';
import { ActivityAccess } from './activity-access';
import { CompanyStore } from './company-store';
import { SectorEditor } from './sector-editor';
import { SectorStore, SprintColumnId, sprintColumnOf } from './sector-store';

// /empresas/:id/setores/:sectorId — cabeçalho do setor (com a sprint ativa) e o kanban da sprint:
// só as atividades gerais do setor que estão na sprint ativa da Planning
@Component({
  imports: [RouterLink, AddColumn, ColumnTitle, SectorEditor, BacklogEditor, PeoplePicker],
  selector: 'app-sector-page',
  templateUrl: './sector-page.html',
  host: { class: 'sector-page' },
})
export class SectorPage {
  readonly id = input.required<string>(); // empresa
  readonly sectorId = input.required<string>();

  private readonly sectorStore = inject(SectorStore);
  private readonly companyStore = inject(CompanyStore);
  private readonly projectStore = inject(ProjectStore);
  private readonly backlog = inject(BacklogStore);
  private readonly membersStore = inject(MembersStore);
  private readonly router = inject(Router);

  protected readonly initials = initials;
  protected readonly tagColor = tagColor;
  protected readonly people = inject(PeopleStore).names; // membros reais da empresa escolhida
  protected readonly isAdmin = this.membersStore.isAdmin;
  private readonly sprints = inject(SprintStore);
  // Sprint ativa da empresa do setor (cada empresa tem a sua)
  protected readonly sprint = computed(() => this.sprints.activeOf(this.sector()?.companyId));

  protected readonly sector = computed(() => {
    const sector = this.sectorStore.byId(Number(this.sectorId()));
    return sector && sector.companyId === Number(this.id()) ? sector : null;
  });
  protected readonly company = computed(() => this.companyStore.companies().find((c) => c.id === this.sector()?.companyId) ?? null);
  protected readonly columns = computed(() => this.sector()?.columns ?? []);
  protected readonly sectorMembers = computed(() => {
    const ids = new Set(this.sector()?.memberIds ?? []);
    return this.membersStore.members().filter((m) => ids.has(m.id));
  });

  // Projetos da empresa com este setor
  protected readonly projects = computed(() => {
    const sector = this.sector();
    const company = this.company();
    if (!sector || !company) return [];
    const statuses = this.projectStore.statuses();
    return this.projectStore
      .visible()
      .filter((p) => p.company === company.name && p.sector.toLowerCase() === sector.name.toLowerCase())
      .map((p) => ({ ...p, statusInfo: statuses.find((s) => s.id === p.status) }));
  });

  // ---------- Sprint ativa (7 dias úteis) ----------
  protected readonly sprintDays = SPRINT_DAYS;
  protected readonly sprintDay = computed(() => {
    const sprint = this.sprint();
    if (!sprint) return 0;
    return Math.min(SPRINT_DAYS, Math.max(1, businessIndex(today()) - businessIndex(sprint.start) + 1));
  });
  protected readonly daysLeft = computed(() => {
    const sprint = this.sprint();
    return sprint ? Math.max(0, businessIndex(sprint.end) - businessIndex(today())) : 0;
  });

  // ---------- Quem vê o quê (mesma regra dos Dashboards: ActivityAccess) ----------
  private readonly access = inject(ActivityAccess);
  protected readonly viewer = this.access.viewer;
  protected readonly seesAll = computed(() => this.access.seesAllOf(this.sector()?.id));

  protected teamOf(item: BacklogItem) {
    return this.access.teamOf(item);
  }

  // Atividades gerais do setor na sprint ativa, já filtradas pelo que a pessoa pode ver
  protected readonly items = computed(() => {
    const sector = this.sector();
    const sprint = this.sprint();
    if (!sector || !sprint) return [];
    return this.backlog
      .items()
      .filter((item) => item.sectorId === sector.id && item.sprintId === sprint.id && !['archived', 'canceled'].includes(item.status))
      .filter((item) => this.access.canSee(item));
  });

  protected readonly board = computed(() => {
    const sector = this.sector();
    if (!sector) return [];
    return this.columns().map((column) => ({
      ...column,
      cards: this.items().filter((item) => sprintColumnOf(sector.columns, item).id === column.id),
    }));
  });

  // Atividade conjunta conta para cada pessoa envolvida (responsável + compartilhadas)
  protected readonly perPerson = computed(() => {
    const counts = new Map<string, { total: number; shared: number }>();
    for (const item of this.items()) {
      const people = new Set([item.assignee, ...item.sharedWith].filter(Boolean));
      for (const person of people) {
        const entry = counts.get(person) ?? { total: 0, shared: 0 };
        entry.total++;
        if (item.sharedWith.length) entry.shared++;
        counts.set(person, entry);
      }
    }
    return [...counts].map(([name, c]) => ({ name, ...c })).sort((a, b) => b.total - a.total);
  });

  protected readonly doneCount = computed(() => this.board().find((c) => c.id === 'done')?.cards.length ?? 0);
  protected readonly doneLabel = computed(() => this.columns().find((c) => c.id === 'done')?.label ?? 'Finalizado');

  protected sprintOf(item: BacklogItem) {
    return this.sprints.byId(item.sprintId);
  }

  protected isOverdue(item: BacklogItem) {
    const sector = this.sector();
    return !!item.due && item.due < today() && !!sector && sprintColumnOf(sector.columns, item).id !== 'done';
  }

  protected formatDay(day: string) {
    const [, month, date] = day.split('-');
    return `${date}/${month}`;
  }

  // ---------- Mover (arrastar ou seletor). Para Bloqueado = bloquear; sair de Bloqueado = desbloquear ----------
  protected readonly dragging = signal<number | null>(null);
  protected readonly dropTarget = signal<string | null>(null);

  protected move(id: number, status: string) {
    const sector = this.sector();
    const item = this.backlog.items().find((i) => i.id === id);
    if (!sector || !item) return;
    const from = sprintColumnOf(sector.columns, item).label;
    const to = sector.columns.find((c) => c.id === status)?.label ?? from;
    this.backlog.setSprintStatus(id, status, { from, to });
  }

  protected onDragOver(event: DragEvent, status: string) {
    if (this.dragging() === null) return;
    event.preventDefault();
    this.dropTarget.set(status);
  }

  protected onDrop(event: DragEvent, status: string) {
    event.preventDefault();
    const id = this.dragging();
    if (id !== null) this.move(id, status);
    this.endDrag();
  }

  protected endDrag() {
    this.dragging.set(null);
    this.dropTarget.set(null);
  }

  // ---------- Colunas (só admin) ----------
  protected readonly isCustom = (id: string) => this.isAdmin() && isCustomColumn(id);

  protected addColumn(label: string) {
    this.sectorStore.addColumn(this.sector()!.id, label);
  }

  protected renameColumn(id: SprintColumnId, label: string) {
    this.sectorStore.renameColumn(this.sector()!.id, id, label);
  }

  protected removeColumn(id: SprintColumnId) {
    this.sectorStore.removeColumn(this.sector()!.id, id);
  }

  protected onDeleted() {
    this.router.navigate(['/empresas', this.id()]);
  }

  // ---------- Nova atividade: entra na sprint ativa, já ligada ao setor ----------
  protected readonly creating = signal(false);
  protected readonly newShared = signal<string[]>([]);

  protected create(event: Event) {
    event.preventDefault();
    const sector = this.sector();
    const sprint = this.sprint();
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    const name = String(data.get('name') ?? '').trim();
    if (!sector || !sprint || !name) return;
    const assignee = String(data.get('assignee') ?? '');
    this.backlog.save({
      ...emptyItem('refinement-done'),
      name,
      assignee,
      sharedWith: this.newShared().filter((p) => p !== assignee),
      due: String(data.get('due') ?? ''),
      sectorId: sector.id,
      sprintId: sprint.id,
      // criada direto em Bloqueado já nasce com o cadeado
      ...(data.get('column') === 'blocked' ? { locked: true } : { sprintStatus: String(data.get('column') ?? sector.columns[0].id) }),
    });
    form.reset();
    this.newShared.set([]);
    this.creating.set(false);
  }
}
