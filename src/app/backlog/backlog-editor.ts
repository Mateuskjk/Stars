import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { PeopleStore } from '../members/people-store';
import { formatTime, initials } from '../format';
import { CompanyStore } from '../companies/company-store';
import { SPRINT_COLUMNS, SectorStore, sprintColumnOf } from '../companies/sector-store';
import { RecentsStore } from '../home/recents-store';
import { PeoplePicker } from '../members/people-picker';
import { ApiSync } from '../api/api-sync';
import { Attachments } from '../attachments/attachments';
import { SprintStore } from '../planning/sprint-store';
import { BacklogItem, BacklogStatus, BacklogStore, emptyItem, newId, tagColor } from './backlog-store';

// Modal do cartão de atividade (criar, editar, anexos, excluir).
// Usado no Backlog e na página do setor: abre por cima da tela atual, sem trocar de página.
@Component({
  imports: [PeoplePicker, Attachments],
  selector: 'app-backlog-editor',
  templateUrl: './backlog-editor.html',
})
export class BacklogEditor {
  private readonly store = inject(BacklogStore);
  private readonly recents = inject(RecentsStore);

  protected readonly columns = this.store.columns;
  protected readonly people = inject(PeopleStore).names; // membros reais da empresa escolhida
  protected readonly initials = initials;
  protected readonly formatTime = formatTime;

  // Setores agrupados por empresa, para o campo Setor do cartão
  private readonly sectorStore = inject(SectorStore);
  private readonly companyStore = inject(CompanyStore);
  protected readonly sectorGroups = computed(() =>
    this.companyStore
      .companies()
      .map((company) => ({ company: company.name, sectors: this.sectorStore.ofCompany(company.id) }))
      .filter((group) => group.sectors.length),
  );

  private readonly editor = viewChild.required<ElementRef<HTMLDialogElement>>('editor');
  // Rascunho: as mudanças só valem ao clicar em "Salvar atividade"
  protected readonly draft = signal<BacklogItem>(emptyItem());
  protected readonly isNew = computed(() => !this.draft().id);
  // Id da atividade no banco (os anexos gravam direto lá); nova ou ainda não salva = null
  private readonly ids = inject(ApiSync).ids;
  protected readonly dbId = computed(() => (this.isNew() ? null : this.ids.atividade.db(this.draft().id)));

  // Na sprint: o Status passa a ser o do kanban de atividades gerais (Não iniciado, Andamento, Revisão, Bloqueado, Finalizado)
  protected readonly sprintColumns = computed(() => {
    const item = this.draft();
    if (!item.sprintId) return null;
    return (item.sectorId && this.sectorStore.byId(item.sectorId)?.columns) || SPRINT_COLUMNS;
  });
  protected readonly sprintStatus = computed(() => {
    const columns = this.sprintColumns();
    return columns ? sprintColumnOf(columns, this.draft()) : null;
  });

  private readonly sprints = inject(SprintStore);
  protected readonly sprint = computed(() => this.sprints.byId(this.draft().sprintId));

  protected formatDay(day: string) {
    const [, month, date] = day.split('-');
    return `${date}/${month}`;
  }

  protected setSprintStatus(status: string) {
    this.patch(status === 'blocked' ? { locked: true } : { locked: false, sprintStatus: status });
  }


  openNew(status: BacklogStatus = 'to-refine') {
    this.draft.set(emptyItem(status));
    this.editor().nativeElement.showModal();
  }

  openEdit(item: BacklogItem) {
    this.recents.visit('card', item.id);
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
    // o responsável não fica entre as pessoas com quem a atividade foi compartilhada
    const sharedWith = item.sharedWith.filter((name) => name !== item.assignee);
    this.store.save({ ...item, name: item.name.trim(), sharedWith });
    this.closeEditor();
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


  protected doneSubtasks(item: BacklogItem) {
    return item.subtasks.filter((s) => s.done).length;
  }
}
