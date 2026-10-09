import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { compressImage } from '../companies/company-store';
import { USERS } from '../chat/chat';
import { RecentsStore } from '../home/recents-store';
import { AddColumn } from '../kanban/add-column';
import { ColumnTitle, isCustomColumn } from '../kanban/column-title';
import { MembersStore } from '../members/members-store';
import { HEALTH, burnUp, health, shortDate } from './project-metrics';
import { ProjectStore } from './project-store';
import { ProjectTask, SPRINT_DAYS, ProjectTaskStore, TaskStatus, sprintOf, sprintWindow, today } from './project-tasks';
import { ProjectTaskEditor } from './project-task-editor';
import { initials } from './projects';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const POINTS = [1, 2, 3, 5, 8, 13];

// /projetos/:id — cabeçalho com os dados do projeto e o kanban só com as atividades dele
@Component({
  imports: [RouterLink, AddColumn, ColumnTitle, ProjectTaskEditor],
  selector: 'app-project-page',
  templateUrl: './project-page.html',
  host: { class: 'project-page' },
})
export class ProjectPage {
  readonly id = input.required<string>(); // vem da rota (withComponentInputBinding)

  private readonly projectStore = inject(ProjectStore);
  private readonly taskStore = inject(ProjectTaskStore);

  protected readonly now = today();
  protected readonly currentSprint = sprintOf(this.now);
  protected readonly todayInSprint = sprintWindow(this.currentSprint).days.filter((day) => day <= this.now).length;
  protected readonly sprintDays = SPRINT_DAYS;
  protected readonly people = USERS.map((user) => user.name);
  protected readonly points = POINTS;
  protected readonly initials = initials;
  protected readonly shortDate = shortDate;
  protected readonly columns = this.taskStore.columns;
  protected readonly isAdmin = inject(MembersStore).isAdmin;
  protected readonly isCustom = (id: string) => this.isAdmin() && isCustomColumn(id);

  protected readonly project = computed(() => this.projectStore.visible().find((p) => p.id === Number(this.id())) ?? null);

  // ---------- Foto, arquivar, excluir e projetos agregados (Admin e Supervisor) ----------
  private readonly members = inject(MembersStore);
  private readonly router = inject(Router);
  protected readonly canEdit = computed(() => ['admin', 'supervisor'].includes(this.members.current()?.role ?? ''));
  protected readonly photoError = signal('');
  protected readonly parent = computed(() => {
    const parentId = this.project()?.parentId;
    return parentId ? (this.projectStore.visible().find((p) => p.id === parentId) ?? null) : null;
  });
  protected readonly children = computed(() => this.projectStore.childrenOf(Number(this.id())));
  // Pode ser agregado aqui: projeto principal da mesma empresa que ainda não tem agregados
  protected readonly candidates = computed(() => {
    const project = this.project();
    if (!project || project.parentId) return [];
    return this.projectStore
      .topLevel()
      .filter((p) => p.id !== project.id && p.company === project.company && !this.projectStore.childrenOf(p.id).length);
  });
  protected readonly statusOf = (id: string) => this.projectStore.statuses().find((s) => s.id === id);

  protected async setPhoto(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.photoError.set('');
    try {
      this.projectStore.setImage(Number(this.id()), await compressImage(file));
    } catch {
      this.photoError.set('Não foi possível ler essa imagem. Use JPG ou PNG.');
    }
  }

  protected removePhoto() {
    this.projectStore.setImage(Number(this.id()), null);
  }

  protected toggleArchive() {
    const project = this.project();
    if (project) this.projectStore.setStatus(project.id, project.status === 'archived' ? 'not-started' : 'archived');
  }

  protected aggregate(childId: string, select: HTMLSelectElement) {
    if (childId) this.projectStore.setParent(Number(childId), Number(this.id()));
    select.value = '';
  }

  protected detach(childId: number) {
    this.projectStore.setParent(childId, null);
  }

  protected confirmDelete(dialog: HTMLDialogElement) {
    dialog.close();
    this.projectStore.remove(Number(this.id()));
    void this.router.navigate(['/projetos/visaoGeral']);
  }

  protected closeOnBackdrop(event: MouseEvent, dialog: HTMLDialogElement) {
    if (event.target === dialog) dialog.close();
  }
  protected readonly status = computed(() => {
    const project = this.project();
    return project ? this.projectStore.statuses().find((s) => s.id === project.status) : null;
  });
  // Atividades do projeto e dos projetos agregados a ele (o principal mostra tudo num kanban só)
  private readonly projectIds = computed(() => new Set([Number(this.id()), ...this.children().map((c) => c.id)]));
  protected readonly tasks = computed(() => this.taskStore.tasks().filter((task) => this.projectIds().has(task.projectId)));
  // Nome do agregado no cartão (as do próprio projeto não levam etiqueta)
  protected subprojectOf(task: ProjectTask) {
    return task.projectId === Number(this.id()) ? null : (this.children().find((c) => c.id === task.projectId)?.name ?? null);
  }

  constructor() {
    // Entra nos "Recentes" da lateral
    const recents = inject(RecentsStore);
    effect(() => {
      const project = this.project();
      if (project) untracked(() => recents.visit('project', project.id));
    });
  }

  // ---------- Resumo do andamento ----------
  protected readonly summary = computed(() => {
    const tasks = this.tasks();
    const total = tasks.reduce((n, t) => n + t.points, 0);
    const done = tasks.filter((t) => t.status === 'done').reduce((n, t) => n + t.points, 0);
    const bu = burnUp(tasks, this.now);
    const h = health(bu);
    return {
      total,
      done,
      progress: total ? Math.round((done / total) * 100) : 0,
      overdue: tasks.filter((t) => t.status !== 'done' && t.end < this.now).length,
      health: HEALTH[h],
      forecast: bu?.finished ? 'Entregue' : bu?.forecastDate ? shortDate(bu.forecastDate) : '—',
      planned: bu ? shortDate(bu.plannedDate) : '—',
      velocity: bu?.velocity ?? 0,
    };
  });

  // ---------- Kanban ----------
  protected readonly sprintFilter = signal(0); // 0 = todas as sprints
  protected readonly sprintOptions = computed(() => {
    const numbers = new Set(this.tasks().map((t) => t.sprint));
    numbers.add(this.currentSprint);
    return [...numbers].sort((a, b) => b - a);
  });

  protected readonly board = computed(() => {
    const sprint = this.sprintFilter();
    const tasks = this.tasks().filter((t) => !sprint || t.sprint === sprint);
    return this.columns().map((column) => {
      const cards = tasks.filter((t) => t.status === column.id).sort((a, b) => a.end.localeCompare(b.end));
      return { ...column, cards, points: cards.reduce((n, t) => n + t.points, 0) };
    });
  });

  protected readonly dragging = signal<number | null>(null);
  protected readonly dropTarget = signal<TaskStatus | null>(null);

  // Abre o modal do cartão; o seletor "Mover para" do próprio cartão não abre
  protected openCard(task: ProjectTask, event: Event, editor: ProjectTaskEditor) {
    if ((event.target as HTMLElement).closest('select')) return;
    editor.open(task);
  }

  protected move(id: number, status: TaskStatus) {
    this.taskStore.setStatus(id, status);
  }

  protected isLate(task: { status: TaskStatus; end: string }) {
    return task.status !== 'done' && task.end < this.now;
  }

  protected onDragOver(event: DragEvent, status: TaskStatus) {
    if (this.dragging() === null) return;
    event.preventDefault();
    this.dropTarget.set(status);
  }

  protected onDrop(event: DragEvent, status: TaskStatus) {
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
  protected addColumn(label: string) {
    this.taskStore.addColumn(label);
  }

  protected renameColumn(id: TaskStatus, label: string) {
    this.taskStore.renameColumn(id, label);
  }

  protected removeColumn(id: TaskStatus) {
    this.taskStore.removeColumn(id);
  }

  // ---------- Nova atividade ----------
  protected readonly creating = signal(false);

  protected create(event: Event) {
    event.preventDefault();
    const project = this.project();
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    const title = String(data.get('title') ?? '').trim();
    if (!project || !title) return;
    const sprint = Number(data.get('sprint')) || this.currentSprint;
    const points = Number(data.get('points')) || 1;
    const window = sprintWindow(sprint);
    this.taskStore.add(
      {
        projectId: project.id,
        title,
        assignee: String(data.get('assignee') ?? ''),
        points,
        status: String(data.get('status') ?? 'todo') as TaskStatus,
        sprint,
        start: window.start,
        end: points >= 8 ? sprintWindow(sprint + 1).end : window.end, // atividades grandes ocupam 2 sprints
      },
      project.name,
    );
    form.reset();
    this.creating.set(false);
  }

  protected money(value: number) {
    return value ? currency.format(value) : '—';
  }
}
