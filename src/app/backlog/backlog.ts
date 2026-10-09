import { Component, DestroyRef, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { initials } from '../chat/chat';
import { AddColumn } from '../kanban/add-column';
import { ColumnTitle, isCustomColumn } from '../kanban/column-title';
import { MembersStore } from '../members/members-store';
import { SprintStore } from '../planning/sprint-store';
import { BacklogEditor } from './backlog-editor';
import { BacklogItem, BacklogStatus, BacklogStore, tagColor } from './backlog-store';

const today = () => new Date().toISOString().slice(0, 10);

@Component({
  imports: [AddColumn, ColumnTitle, BacklogEditor],
  selector: 'app-backlog',
  templateUrl: './backlog.html',
  host: { class: 'backlog' },
})
export class Backlog {
  private readonly store = inject(BacklogStore);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Vindo dos Favoritos ou dos Recentes: /workspace/backlog?cartao=ID abre o cartão direto
    afterNextRender(() => {
      this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
        const item = this.store.items().find((current) => current.id === Number(params.get('cartao')));
        if (item) this.openEdit(item);
      });
    });
  }

  protected readonly columns = this.store.columns;

  protected readonly initials = initials;
  protected readonly tagColor = tagColor;

  protected readonly board = computed(() =>
    this.columns().map((column) => ({
      ...column,
      cards: this.store.items().filter((item) => item.status === column.id),
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

  protected doneSubtasks(item: BacklogItem) {
    return item.subtasks.filter((s) => s.done).length;
  }
}
