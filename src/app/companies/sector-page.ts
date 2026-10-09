import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BacklogItem, BacklogStatus, BacklogStore, emptyItem, tagColor } from '../backlog/backlog-store';
import { USERS } from '../chat/users';
import { RecentsStore } from '../home/recents-store';
import { SprintStore } from '../planning/sprint-store';
import { ProjectStore } from '../projects/project-store';
import { initials } from '../projects/projects';
import { CompanyStore } from './company-store';
import { SectorStore } from './sector-store';

const today = () => new Date().toISOString().slice(0, 10);

// /empresas/:id/setores/:sectorId — cabeçalho do setor, projetos ligados e o kanban das atividades gerais
// (as mesmas do Backlog e da Planning: mover aqui move lá também)
@Component({
  imports: [RouterLink],
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
  private readonly sprints = inject(SprintStore);

  protected readonly initials = initials;
  protected readonly tagColor = tagColor;
  protected readonly people = USERS.map((user) => user.name);
  protected readonly columns = this.backlog.columns;

  protected readonly sector = computed(() => {
    const sector = this.sectorStore.byId(Number(this.sectorId()));
    return sector && sector.companyId === Number(this.id()) ? sector : null;
  });
  protected readonly company = computed(() => this.companyStore.companies().find((c) => c.id === this.sector()?.companyId) ?? null);

  // Projetos da empresa com este setor
  protected readonly projects = computed(() => {
    const sector = this.sector();
    const company = this.company();
    if (!sector || !company) return [];
    const statuses = this.projectStore.statuses();
    return this.projectStore
      .projects()
      .filter((p) => p.company === company.name && p.sector.toLowerCase() === sector.name.toLowerCase())
      .map((p) => ({ ...p, statusInfo: statuses.find((s) => s.id === p.status) }));
  });

  protected readonly items = computed(() => this.backlog.items().filter((item) => item.sectorId === this.sector()?.id));

  protected readonly board = computed(() =>
    this.columns().map((column) => ({ ...column, cards: this.items().filter((item) => item.status === column.id) })),
  );

  protected readonly summary = computed(() => {
    const items = this.items();
    const open = items.filter((i) => !['refinement-done', 'archived', 'canceled'].includes(i.status));
    return {
      open: open.length,
      inSprint: items.filter((i) => i.sprintId && !['archived', 'canceled'].includes(i.status)).length,
      ready: items.filter((i) => i.status === 'refinement-done' && !i.sprintId).length,
      overdue: items.filter((i) => this.isOverdue(i)).length,
    };
  });

  constructor() {
    const recents = inject(RecentsStore);
    effect(() => {
      const sector = this.sector();
      if (sector) untracked(() => recents.visit('sector', sector.id));
    });
  }

  // Situação na Planning: em qual sprint está, ou se está pronta/aguardando para entrar
  protected planning(item: BacklogItem) {
    if (item.sprintId) {
      const sprint = this.sprints.sprints().find((s) => s.id === item.sprintId);
      return sprint ? `${sprint.name}${sprint.status === 'active' ? ' (ativa)' : ''}` : `Sprint ${item.sprintId}`;
    }
    if (item.status === 'refinement-done') return item.planning === 'waiting' ? 'Planning: aguardando' : 'Planning: pronta';
    return null;
  }

  protected isOverdue(item: BacklogItem) {
    return !!item.due && item.due < today() && !['refinement-done', 'archived', 'canceled'].includes(item.status);
  }

  protected formatDue(due: string) {
    const [, month, day] = due.split('-');
    return `${day}/${month}`;
  }

  // ---------- Mover (arrastar ou seletor) — cartão bloqueado não se move ----------
  protected readonly dragging = signal<number | null>(null);
  protected readonly dropTarget = signal<BacklogStatus | null>(null);

  protected move(id: number, status: BacklogStatus) {
    this.backlog.move(id, status);
  }

  protected onDragOver(event: DragEvent, status: BacklogStatus) {
    if (this.dragging() === null) return;
    event.preventDefault();
    this.dropTarget.set(status);
  }

  protected onDrop(event: DragEvent, status: BacklogStatus) {
    event.preventDefault();
    const id = this.dragging();
    if (id !== null) this.move(id, status);
    this.endDrag();
  }

  protected endDrag() {
    this.dragging.set(null);
    this.dropTarget.set(null);
  }

  // ---------- Nova atividade geral já ligada ao setor ----------
  protected readonly creating = signal(false);

  protected create(event: Event) {
    event.preventDefault();
    const sector = this.sector();
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    const name = String(data.get('name') ?? '').trim();
    if (!sector || !name) return;
    this.backlog.save({
      ...emptyItem(String(data.get('status') ?? 'to-refine') as BacklogStatus),
      name,
      assignee: String(data.get('assignee') ?? ''),
      due: String(data.get('due') ?? ''),
      sectorId: sector.id,
    });
    form.reset();
    this.creating.set(false);
  }
}
