import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { PeopleStore } from '../members/people-store';
import { ApiSync } from '../api/api-sync';
import { Attachments } from '../attachments/attachments';
import { shortDate } from './project-metrics';
import { ProjectTask, ProjectTaskStore, TaskStatus, sprintOf, sprintWindow, today } from './project-tasks';

const POINTS = [1, 2, 3, 5, 8, 13];

// Modal do cartão de atividade de projeto (página do projeto): ver, editar e excluir
@Component({
  selector: 'app-project-task-editor',
  imports: [Attachments],
  templateUrl: './project-task-editor.html',
})
export class ProjectTaskEditor {
  private readonly store = inject(ProjectTaskStore);

  protected readonly columns = this.store.columns;
  protected readonly people = inject(PeopleStore).names; // membros reais da empresa escolhida
  protected readonly points = POINTS;
  protected readonly shortDate = shortDate;
  protected readonly currentSprint = sprintOf(today());

  // Rascunho: as mudanças só valem ao salvar
  protected readonly draft = signal<ProjectTask | null>(null);
  private original: ProjectTask | null = null;
  // Id da atividade no banco: os anexos gravam direto lá
  private readonly ids = inject(ApiSync).ids;
  protected readonly dbId = computed(() => {
    const task = this.draft();
    return task ? this.ids.tarefa.db(task.id) : null;
  });

  // Sprints possíveis: da sprint da atividade até 4 sprints depois da atual
  protected readonly sprints = computed(() => {
    const task = this.draft();
    const from = Math.min(task?.sprint ?? this.currentSprint, this.currentSprint);
    return Array.from({ length: this.currentSprint + 4 - from + 1 }, (_, i) => from + i).map((n) => ({
      number: n,
      label: `Sprint ${n} · ${shortDate(sprintWindow(n).start)} – ${shortDate(sprintWindow(n).end)}${n === this.currentSprint ? ' (atual)' : ''}`,
    }));
  });
  protected readonly statusIndex = computed(() => this.columns().findIndex((c) => c.id === this.draft()?.status));

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly confirm = viewChild.required<ElementRef<HTMLDialogElement>>('confirm');

  open(task: ProjectTask) {
    this.original = task;
    this.draft.set({ ...task });
    this.dialog().nativeElement.showModal();
  }

  protected patch(changes: Partial<ProjectTask>) {
    this.draft.update((task) => (task ? { ...task, ...changes } : task));
  }

  protected step(direction: 1 | -1) {
    const next = this.columns()[this.statusIndex() + direction];
    if (next) this.patch({ status: next.id as TaskStatus });
  }

  protected save(event: Event) {
    event.preventDefault();
    const task = this.draft();
    if (!task || !task.title.trim()) return;
    const { title, description, assignee, points, sprint, status, end } = task;
    this.store.update(task.id, { title: title.trim(), description: description?.trim() ?? '', assignee, points, sprint, status, end });
    this.dialog().nativeElement.close();
  }

  protected close() {
    this.dialog().nativeElement.close();
  }

  protected askDelete() {
    this.confirm().nativeElement.showModal();
  }

  protected confirmDelete() {
    const task = this.draft();
    if (task) this.store.remove(task.id);
    this.confirm().nativeElement.close();
    this.dialog().nativeElement.close();
  }

  protected closeOnBackdrop(event: MouseEvent, dialog: HTMLDialogElement) {
    if (event.target === dialog) dialog.close();
  }

  protected isLate(task: ProjectTask) {
    return task.status !== 'done' && task.end < today();
  }

  protected changed() {
    const task = this.draft();
    return !!task && !!this.original && JSON.stringify(task) !== JSON.stringify(this.original);
  }
}
