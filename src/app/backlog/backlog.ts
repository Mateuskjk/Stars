import { Component, ElementRef, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { USERS, formatTime, initials } from '../chat/chat';
import { AddColumn } from '../kanban/add-column';
import { ColumnTitle, isCustomColumn } from '../kanban/column-title';
import { MembersStore } from '../members/members-store';
import {
  Attachment,
  BacklogItem,
  BacklogStatus,
  BacklogStore,
  emptyItem,
  newId,
  tagColor,
} from './backlog-store';

const today = () => new Date().toISOString().slice(0, 10);

@Component({
  imports: [AddColumn, ColumnTitle],
  selector: 'app-backlog',
  templateUrl: './backlog.html',
  host: { class: 'backlog' },
})
export class Backlog {
  private readonly store = inject(BacklogStore);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly route = inject(ActivatedRoute);

  constructor() {
    // Vindo dos Favoritos: /workspace/backlog?cartao=ID abre o cartão direto
    afterNextRender(() => {
      const id = Number(this.route.snapshot.queryParamMap.get('cartao'));
      const item = this.store.items().find((current) => current.id === id);
      if (item) this.openEdit(item);
    });
  }

  protected readonly columns = this.store.columns;
  protected readonly people = USERS.map((user) => user.name);
  protected readonly initials = initials;
  protected readonly formatTime = formatTime;

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

  // ---------- Modal de criação e edição ----------
  private readonly editor = viewChild.required<ElementRef<HTMLDialogElement>>('editor');
  // Rascunho: as mudanças só valem ao clicar em "Salvar atividade"
  protected readonly draft = signal<BacklogItem>(emptyItem());
  protected readonly isNew = computed(() => !this.draft().id);
  protected readonly statusIndex = computed(() => this.columns().findIndex((c) => c.id === this.draft().status));

  protected openNew(status: BacklogStatus = 'to-refine') {
    this.draft.set(emptyItem(status));
    this.editor().nativeElement.showModal();
  }

  protected openEdit(item: BacklogItem) {
    this.draft.set({
      ...item,
      tags: [...item.tags],
      comments: [...item.comments],
      subtasks: item.subtasks.map((subtask) => ({ ...subtask })),
      attachments: [...item.attachments],
    });
    this.editor().nativeElement.showModal();
  }

  protected closeEditor() {
    this.editor().nativeElement.close();
  }

  protected patch(changes: Partial<BacklogItem>) {
    this.draft.update((item) => ({ ...item, ...changes }));
  }

  protected save(event: Event) {
    event.preventDefault();
    const item = this.draft();
    if (!item.name.trim()) return;
    this.store.save({ ...item, name: item.name.trim() });
    this.closeEditor();
  }

  protected step(direction: 1 | -1) {
    const next = this.columns()[this.statusIndex() + direction];
    if (next && !this.draft().locked) this.patch({ status: next.id });
  }

  protected archive() {
    this.patch({ status: 'archived' });
    this.save(new Event('submit'));
  }

  // Tags personalizadas: digita e aperta Enter
  protected addTag(input: HTMLInputElement, event?: Event) {
    event?.preventDefault();
    const tag = input.value.trim().toLowerCase();
    if (tag && !this.draft().tags.includes(tag)) this.patch({ tags: [...this.draft().tags, tag] });
    input.value = '';
  }

  protected removeTag(tag: string) {
    this.patch({ tags: this.draft().tags.filter((t) => t !== tag) });
  }

  protected readonly tagColor = tagColor;

  // Sub atividades
  protected addSubtask(input: HTMLInputElement, event?: Event) {
    event?.preventDefault();
    const title = input.value.trim();
    if (title) this.patch({ subtasks: [...this.draft().subtasks, { id: newId(), title, done: false }] });
    input.value = '';
  }

  protected toggleSubtask(id: number) {
    this.patch({ subtasks: this.draft().subtasks.map((s) => (s.id === id ? { ...s, done: !s.done } : s)) });
  }

  protected removeSubtask(id: number) {
    this.patch({ subtasks: this.draft().subtasks.filter((s) => s.id !== id) });
  }

  // Comentários
  protected addComment(input: HTMLTextAreaElement) {
    const text = input.value.trim();
    if (!text) return;
    // ponytail: autor fixo até existir login
    this.patch({ comments: [...this.draft().comments, { id: newId(), author: 'Você', text, time: new Date() }] });
    input.value = '';
  }

  // Anexos: só imagens e PDF
  protected addFiles(input: HTMLInputElement) {
    const files = [...(input.files ?? [])].filter((file) => file.type.startsWith('image/') || file.type === 'application/pdf');
    const attachments = files.map((file) => ({
      id: newId(),
      name: file.name,
      type: file.type,
      size: file.size,
      url: URL.createObjectURL(file),
    }));
    this.patch({ attachments: [...this.draft().attachments, ...attachments] });
    input.value = '';
  }

  protected removeAttachment(file: Attachment) {
    this.patch({ attachments: this.draft().attachments.filter((a) => a.id !== file.id) });
  }

  protected fileSize(bytes: number) {
    return bytes < 1_048_576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`;
  }

  // ---------- Visualizador de anexos ----------
  private readonly viewer = viewChild.required<ElementRef<HTMLDialogElement>>('viewer');
  protected readonly viewing = signal<Attachment | null>(null);
  // O PDF abre no visualizador do próprio navegador; o object URL foi criado aqui, então é confiável
  protected readonly viewingUrl = computed(() => {
    const file = this.viewing();
    return file ? this.sanitizer.bypassSecurityTrustResourceUrl(file.url) : null;
  });

  protected view(file: Attachment) {
    this.viewing.set(file);
    this.viewer().nativeElement.showModal();
  }

  protected closeViewer() {
    this.viewer().nativeElement.close();
  }

  // ---------- Exclusão (com confirmação) ----------
  private readonly confirm = viewChild.required<ElementRef<HTMLDialogElement>>('confirmDelete');

  protected askDelete() {
    this.confirm().nativeElement.showModal();
  }

  protected cancelDelete() {
    this.confirm().nativeElement.close();
  }

  protected confirmDeletion() {
    this.store.remove(this.draft().id);
    this.confirm().nativeElement.close();
    this.closeEditor();
  }

  // Clique no fundo escurecido fecha a janela
  protected closeOnBackdrop(event: MouseEvent, dialog: HTMLDialogElement) {
    if (event.target === dialog) dialog.close();
  }

  // ---------- Exibição nos cartões ----------
  protected formatDue(due: string) {
    const [, month, day] = due.split('-');
    return `${day}/${month}`;
  }

  protected isOverdue(item: BacklogItem) {
    return !!item.due && item.due < today() && !['refinement-done', 'archived', 'canceled'].includes(item.status);
  }

  protected doneSubtasks(item: BacklogItem) {
    return item.subtasks.filter((s) => s.done).length;
  }
}
