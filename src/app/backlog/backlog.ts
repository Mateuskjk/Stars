import { Component, DestroyRef, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { BoardToolbar, BoardView, FilterField, FilterRule, matchesQuery, optionsOf, passesFilters } from '../kanban/board-toolbar';
import { AddColumn } from '../kanban/add-column';
import { CardActions } from '../kanban/card-actions';
import { ConfirmDelete } from '../kanban/confirm-delete';
import { ColumnTitle, isCustomColumn } from '../kanban/column-title';
import { MembersStore } from '../members/members-store';
import { SprintStore, sprintFilterField, sprintOptionOf } from '../planning/sprint-store';
import { BacklogEditor } from './backlog-editor';
import { BacklogItem, BacklogStatus, BacklogStore, inBacklog } from './backlog-store';

const today = () => new Date().toISOString().slice(0, 10);

@Component({
  imports: [AddColumn, ColumnTitle, BacklogEditor, BoardToolbar, CardActions, ConfirmDelete],
  selector: 'app-backlog',
  templateUrl: './backlog.html',
  host: { class: 'backlog' },
})
export class Backlog {
  private readonly store = inject(BacklogStore);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Vindo dos Recentes: /workspace/backlog?cartao=ID abre o cartão direto
    afterNextRender(() => {
      this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
        const item = this.store.items().find((current) => current.id === Number(params.get('cartao')));
        if (item) this.openEdit(item);
      });
    });
  }

  protected readonly columns = this.store.columns;


  // Barra acima do quadro: busca pelo nome e kanban/lista
  protected readonly query = signal('');
  protected readonly view = signal<BoardView>('board');
  protected readonly filters = signal<FilterRule[]>([]);
  protected readonly filterFields = computed<FilterField[]>(() => {
    const all = this.store.ofCompany().filter(inBacklog);
    return [
      {
        key: 'responsavel',
        label: 'Responsável',
        options: optionsOf(all.flatMap((i) => [i.assignee, ...i.sharedWith])),
      },
      { key: 'etiqueta', label: 'Etiqueta', options: optionsOf(all.flatMap((i) => i.tags)) },
      this.sprintField(),
    ];
  });
  private readonly sprintField = computed(() => sprintFilterField(this.sprints.ofCompany(), true));
  protected readonly total = computed(() => this.store.ofCompany().filter(inBacklog).length);
  protected readonly board = computed(() =>
    this.columns().map((column) => ({
      ...column,
      cards: this.store
        .ofCompany()
        .filter(
          (item) =>
            item.status === column.id &&
            inBacklog(item) &&
            matchesQuery(item.name, this.query()) &&
            passesFilters(this.filters(), (key) =>
              key === 'etiqueta' ? item.tags : key === 'sprint' ? (item.sprintId === undefined ? 'none' : sprintOptionOf(this.sprintField(), item.sprintId)) : [item.assignee, ...item.sharedWith],
            ),
        ),
    })),
  );

  // Criar, renomear e excluir colunas: só admin
  protected readonly isAdmin = inject(MembersStore).isAdmin;
  protected readonly isCustom = (id: string) => this.isAdmin() && isCustomColumn(id);

  protected addColumn(label: string) {
    this.store.addColumn(label);
  }

  protected renameColumn(id: BacklogStatus, label: string) {
    this.store.renameColumn(id, label);
  }

  protected removeColumn(id: BacklogStatus) {
    this.store.removeColumn(id);
  }

  // ---------- Arrastar e soltar (cartão bloqueado não se move) ----------
  protected readonly dragging = signal<number | null>(null);
  protected readonly dropTarget = signal<BacklogStatus | null>(null);

  protected onDragOver(event: DragEvent, status: BacklogStatus) {
    if (this.dragging() === null) return;
    event.preventDefault();
    this.dropTarget.set(status);
  }

  protected onDrop(event: DragEvent, status: BacklogStatus) {
    event.preventDefault();
    const id = this.dragging();
    if (id !== null) this.store.move(id, status);
    this.endDrag();
  }

  protected endDrag() {
    this.dragging.set(null);
    this.dropTarget.set(null);
  }

  // ---------- Modal do cartão ----------
  private readonly editor = viewChild.required(BacklogEditor);

  protected openNew(status: BacklogStatus = 'to-refine') {
    this.editor().openNew(status);
  }

  protected openEdit(item: BacklogItem) {
    this.editor().openEdit(item);
  }

  // ---------- Exibição nos cartões ----------
  protected formatDue(due: string) {
    const [, month, day] = due.split('-');
    return `${day}/${month}`;
  }

  protected isOverdue(item: BacklogItem) {
    return !!item.due && item.due < today() && !['refinement-done', 'archived', 'canceled'].includes(item.status);
  }

  private readonly sprints = inject(SprintStore);

  protected sprintOf(item: BacklogItem) {
    return item.sprintId ? this.sprints.byId(item.sprintId) : null;
  }

  protected readonly hasCards = computed(() => this.board().some((c) => c.cards.length));

  // Botões do cartão
  protected archive(item: BacklogItem) {
    this.store.patch(item.id, { status: 'archived' });
  }

  protected removeItem(item: BacklogItem) {
    return () => this.store.remove(item.id);
  }

  // Linha de dados do cartão: etiquetas · sprint · responsável
  protected meta(item: BacklogItem) {
    return [item.tags.join(', '), this.sprintOf(item)?.name, item.assignee].filter(Boolean).join(' · ');
  }

  protected doneSubtasks(item: BacklogItem) {
    return item.subtasks.filter((s) => s.done).length;
  }
}
