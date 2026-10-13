import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { BacklogStatus, BacklogStore } from '../backlog/backlog-store';
import { initials } from '../chat/chat';
import { MembersStore } from '../members/members-store';
import { SprintStore } from '../planning/sprint-store';
import { ProjectStore } from '../projects/project-store';
import { ProjectTaskStore, TASK_STATUSES, TaskStatus, sprintOf, today } from '../projects/project-tasks';

// Colunas do Work. Cada kanban de origem tem as suas; aqui o cartão aparece na equivalente.
type WorkColumn = 'todo' | 'doing' | 'review' | 'done';
const WORK_COLUMNS = (Object.keys(TASK_STATUSES) as WorkColumn[]).map((id) => ({ id, ...TASK_STATUSES[id] }));

// Backlog → Work pela posição das colunas padrão; colunas criadas no Backlog ou no projeto caem em "A fazer"
const FROM_BACKLOG: Partial<Record<BacklogStatus, WorkColumn>> = { 'to-refine': 'todo', refined: 'doing', waiting: 'review', 'refinement-done': 'done' };
const fromTask = (status: TaskStatus): WorkColumn => (status in TASK_STATUSES ? (status as WorkColumn) : 'todo');

interface WorkCard {
  key: string; // b-1 (atividade geral) ou t-1 (atividade de projeto)
  id: number;
  kind: 'backlog' | 'task';
  title: string;
  origin: string; // "Atividade geral" ou nome do projeto
  originColumn: string; // id da coluna no kanban de origem
  column: WorkColumn;
  due: string;
  locked: boolean;
}

interface PendingMove {
  card: WorkCard;
  to: WorkColumn;
  choice: string;
}

// Work: as atividades da pessoa na sprint atual (gerais + de projetos) num kanban só.
// Não cria atividades nem leva para outros kanbans; mover aqui move no Backlog ou no kanban do projeto.
@Component({
  selector: 'app-work',
  templateUrl: './work.html',
  host: { class: 'work' },
})
export class Work {
  private readonly backlog = inject(BacklogStore);
  private readonly tasks = inject(ProjectTaskStore);
  private readonly projects = inject(ProjectStore);
  private readonly members = inject(MembersStore);
  private readonly sprints = inject(SprintStore);
  protected readonly initials = initials;
  protected readonly columns = WORK_COLUMNS;
  protected readonly me = computed(() => this.members.current()?.name ?? '');

  protected readonly cards = computed<WorkCard[]>(() => {
    const me = this.me();
    if (!me) return [];
    // Sprint atual: a ativa da empresa (gerais pela sprint; de projetos pelo número da sprint em que começa)
    const active = this.sprints.active();
    const sprintNumber = sprintOf(active?.start ?? today());
    const general = this.backlog
      .ofCompany()
      .filter((i) => !!active && i.sprintId === active.id)
      .filter((i) => (i.assignee === me || i.sharedWith.includes(me)) && i.status !== 'archived' && i.status !== 'canceled')
      .map<WorkCard>((i) => ({
        key: `b-${i.id}`,
        id: i.id,
        kind: 'backlog',
        title: i.name,
        origin: 'Atividade geral',
        originColumn: i.status,
        column: FROM_BACKLOG[i.status] ?? 'todo',
        due: i.due,
        locked: i.locked,
      }));
    const projects = new Map(this.projects.visible().map((p) => [p.id, p.name]));
    const fromProjects = this.tasks
      .tasks()
      .filter((t) => t.assignee === me && t.sprint === sprintNumber && projects.has(t.projectId))
      .map<WorkCard>((t) => ({
        key: `t-${t.id}`,
        id: t.id,
        kind: 'task',
        title: t.title,
        origin: projects.get(t.projectId)!,
        originColumn: t.status,
        column: fromTask(t.status),
        due: t.status === 'done' ? '' : t.end,
        locked: false,
      }));
    return [...general, ...fromProjects];
  });

  protected readonly board = computed(() => this.columns.map((c) => ({ ...c, cards: this.cards().filter((card) => card.column === c.id) })));

  protected isLate(card: WorkCard) {
    return !!card.due && card.column !== 'done' && card.due < today();
  }

  // ---------- Colunas do kanban de origem ----------
  protected originColumns(card: WorkCard) {
    return card.kind === 'backlog'
      ? this.backlog.columns().filter((c) => c.id !== 'archived' && c.id !== 'canceled')
      : this.tasks.columns();
  }

  protected originLabel(card: WorkCard, id = card.originColumn) {
    return this.originColumns(card).find((c) => c.id === id)?.label ?? id;
  }

  protected workColumnOf(card: WorkCard, originId: string): WorkColumn {
    return card.kind === 'backlog' ? (FROM_BACKLOG[originId as BacklogStatus] ?? 'todo') : fromTask(originId as TaskStatus);
  }

  protected workLabel(id: WorkColumn) {
    return TASK_STATUSES[id].label;
  }

  // ---------- Mover: sempre confirma no pop-up qual coluna usar no kanban de origem ----------
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('moveDialog');
  protected readonly pending = signal<PendingMove | null>(null);

  protected ask(key: string, to: WorkColumn) {
    const card = this.cards().find((c) => c.key === key);
    if (!card || card.column === to) return;
    // Sugestão: a primeira coluna de origem que aparece em "to" no Work
    const choice = this.originColumns(card).find((c) => this.workColumnOf(card, c.id) === to)?.id ?? card.originColumn;
    this.pending.set({ card, to, choice });
    this.dialog().nativeElement.showModal();
  }

  protected choose(value: string) {
    this.pending.update((p) => p && { ...p, choice: value });
  }

  protected confirm() {
    const p = this.pending();
    if (p && !p.card.locked && p.choice !== p.card.originColumn) {
      if (p.card.kind === 'backlog') this.backlog.move(p.card.id, p.choice as BacklogStatus);
      else this.tasks.setStatus(p.card.id, p.choice as TaskStatus);
    }
    this.dialog().nativeElement.close();
  }

  protected cancel() {
    this.dialog().nativeElement.close();
  }

  protected onDialogClick(event: MouseEvent) {
    if (event.target === this.dialog().nativeElement) this.cancel();
  }

  // Arrastar e soltar (mouse). No toque e no teclado, o seletor "Mover para" do cartão faz o mesmo.
  protected readonly dragging = signal<string | null>(null);
  protected readonly dropTarget = signal<WorkColumn | null>(null);

  protected onDragOver(event: DragEvent, column: WorkColumn) {
    if (this.dragging() === null) return;
    event.preventDefault();
    this.dropTarget.set(column);
  }

  protected onDrop(event: DragEvent, column: WorkColumn) {
    event.preventDefault();
    const key = this.dragging();
    this.endDrag();
    if (key) this.ask(key, column);
  }

  protected endDrag() {
    this.dragging.set(null);
    this.dropTarget.set(null);
  }

  protected shortDate(day: string) {
    return day ? `${day.slice(8, 10)}/${day.slice(5, 7)}` : '';
  }
}
