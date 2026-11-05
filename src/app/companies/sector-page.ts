import { Component, computed, inject, input, signal } from '@angular/core';
import { BoardToolbar, BoardView, FilterField, FilterRule, matchesQuery, optionsOf, passesFilters } from '../kanban/board-toolbar';
import { PeopleStore } from '../members/people-store';
import { Router, RouterLink } from '@angular/router';
import { BacklogEditor } from '../backlog/backlog-editor';
import { BacklogItem, BacklogStore } from '../backlog/backlog-store';
import { CardActions } from '../kanban/card-actions';
import { ConfirmDelete } from '../kanban/confirm-delete';
import { AddColumn } from '../kanban/add-column';
import { ColumnTitle, isCustomColumn } from '../kanban/column-title';
import { MembersStore } from '../members/members-store';
import { SprintStore, chosenSprints, sprintFilterField } from '../planning/sprint-store';
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
  imports: [RouterLink, AddColumn, ColumnTitle, SectorEditor, BacklogEditor, BoardToolbar, CardActions, ConfirmDelete],
  selector: 'app-sector-page',
  templateUrl: './sector-page.html',
  host: {
    class: 'sector-page',
    '(document:click)': 'closeMenuOnOutsideClick($event)',
    '(document:keydown.escape)': 'menuOpen.set(false)',
  },
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

  // Projetos da empresa com este setor (o cabeçalho mostra quantos)
  protected readonly projects = computed(() => {
    const sector = this.sector();
    const company = this.company();
    if (!sector || !company) return [];
    return this.projectStore.visible().filter((p) => p.company === company.name && p.sector.toLowerCase() === sector.name.toLowerCase());
  });

  // ---------- Sprint ativa (7 dias úteis) ----------
  protected readonly sprintDays = SPRINT_DAYS;
  protected readonly sprintDay = computed(() => {
    const sprint = this.sprint();
    if (!sprint) return 0;
    return Math.min(SPRINT_DAYS, Math.max(1, businessIndex(today()) - businessIndex(sprint.start) + 1));
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

  // Barra acima do quadro: busca pelo nome e kanban/lista
  protected readonly query = signal('');
  protected readonly view = signal<BoardView>('board');
  protected readonly filters = signal<FilterRule[]>([]);
  protected readonly filterFields = computed<FilterField[]>(() => {
    const all = this.items();
    return [
      sprintFilterField(this.sprints.sprints().filter((s) => s.companyId === undefined || s.companyId === this.sector()?.companyId)),
      {
        key: 'responsavel',
        label: 'Responsável',
        options: optionsOf(all.flatMap((i) => [i.assignee, ...i.sharedWith])),
      },
      { key: 'etiqueta', label: 'Etiqueta', options: optionsOf(all.flatMap((i) => i.tags)) },
    ];
  });
  // Atividades do quadro: as da(s) sprint(s) escolhida(s) no filtro ou, sem filtro, as da sprint ativa
  protected readonly boardItems = computed(() => {
    const chosen = chosenSprints(this.filters());
    const sector = this.sector();
    if (!chosen.size || !sector) return this.items();
    return this.backlog
      .items()
      .filter((item) => item.sectorId === sector.id && item.sprintId !== undefined && chosen.has(item.sprintId) && !['archived', 'canceled'].includes(item.status))
      .filter((item) => this.access.canSee(item));
  });
  protected readonly board = computed(() => {
    const sector = this.sector();
    if (!sector) return [];
    return this.columns().map((column) => ({
      ...column,
      cards: this.boardItems().filter(
        (item) =>
          sprintColumnOf(sector.columns, item).id === column.id &&
          matchesQuery(item.name, this.query()) &&
          passesFilters(
            this.filters().filter((r) => r.key !== 'sprint'),
            (key) => (key === 'etiqueta' ? item.tags : [item.assignee, ...item.sharedWith]),
          ),
      ),
    }));
  });

  protected readonly doneCount = computed(() => this.board().find((c) => c.id === 'done')?.cards.length ?? 0);
  protected readonly doneLabel = computed(() => this.columns().find((c) => c.id === 'done')?.label ?? 'Finalizado');

  // Menu "…" do cabeçalho (editar e excluir o setor): fecha ao clicar fora ou com Esc
  protected readonly menuOpen = signal(false);
  protected closeMenuOnOutsideClick(event: Event) {
    const target = event.target as Element;
    if (target.isConnected && !target.closest('.row-menu')) this.menuOpen.set(false);
  }

  // Botões do cartão
  protected archive(item: BacklogItem) {
    this.backlog.patch(item.id, { status: 'archived' });
  }

  protected removeItem(item: BacklogItem) {
    return () => this.backlog.remove(item.id);
  }

  // Linha de dados do cartão: equipe · etiquetas · sprint · responsável (e com quem compartilhou)
  protected meta(item: BacklogItem) {
    const team = this.teamOf(item);
    const people = item.sharedWith.length ? `${item.assignee} ⇄ ${item.sharedWith.join(', ')}` : item.assignee;
    return [team && '👥 ' + team, item.tags.join(', '), this.sprintOf(item)?.name, people].filter(Boolean).join(' · ');
  }

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

  // ---------- Nova atividade: abre o painel lateral do Backlog já no setor, na sprint ativa e na 1ª coluna ----------
  protected newActivity(editor: BacklogEditor) {
    const sector = this.sector();
    const sprint = this.sprint();
    if (!sector || !sprint) return;
    editor.openNew('refinement-done', { sectorId: sector.id, sprintId: sprint.id, sprintStatus: sector.columns[0].id });
  }
}
