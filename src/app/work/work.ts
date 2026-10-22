import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { BacklogItem, BacklogStore } from '../backlog/backlog-store';
import { BacklogEditor } from '../backlog/backlog-editor';
import { ProjectTaskEditor } from '../projects/project-task-editor';
import { initials } from '../format';
import { MembersStore } from '../members/members-store';
import { SPRINT_COLUMNS, SectorStore, sprintColumnOf } from '../companies/sector-store';
import { SprintStore } from '../planning/sprint-store';
import { ProjectStore } from '../projects/project-store';
import { ProjectTaskStore, TASK_STATUSES, TaskStatus, sprintOf, today } from '../projects/project-tasks';

// Colunas do Work. Cada kanban de origem tem as suas; aqui o cartão aparece na equivalente.
type WorkColumn = 'todo' | 'doing' | 'review' | 'done';
const WORK_COLUMNS = (Object.keys(TASK_STATUSES) as WorkColumn[]).map((id) => ({ id, ...TASK_STATUSES[id] }));

// Mesmos ids nos kanbans de origem (sprint do setor e projeto); Bloqueado e colunas criadas pelo admin caem em "A fazer"
const toWork = (status: string): WorkColumn => (status in TASK_STATUSES ? (status as WorkColumn) : 'todo');

interface WorkCard {
  key: string; // b-1 (atividade geral) ou t-1 (atividade de projeto)
  id: number;
  kind: 'backlog' | 'task';
  title: string;
  origin: string; // "Atividade geral" ou nome do projeto
  originColumn: string; // id da coluna no kanban de origem
  column: WorkColumn;
  due: string;
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
  imports: [BacklogEditor, ProjectTaskEditor],
  templateUrl: './work.html',
  host: { class: 'work' },
})
export class Work {
  private readonly backlog = inject(BacklogStore);
  private readonly tasks = inject(ProjectTaskStore);
  private readonly projects = inject(ProjectStore);
  private readonly members = inject(MembersStore);
  private readonly sprints = inject(SprintStore);
  private readonly sectors = inject(SectorStore);
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
      .map<WorkCard>((i) => {
        // Na sprint, a atividade geral anda no kanban do setor (não mais nas colunas do Backlog)
        const originColumn = sprintColumnOf(this.sprintColumns(i), i).id;
        return { key: `b-${i.id}`, id: i.id, kind: 'backlog', title: i.name, origin: 'Atividade geral', originColumn, column: toWork(originColumn), due: originColumn === 'done' ? '' : i.due };
      });
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
        column: toWork(t.status),
        due: t.status === 'done' ? '' : t.end,
      }));
    return [...general, ...fromProjects];
  });

  protected readonly board = computed(() => this.columns.map((c) => ({ ...c, cards: this.cards().filter((card) => card.column === c.id) })));

  // ---------- Abrir o cartão: o mesmo modal do Backlog (geral) ou do projeto (ver, editar, comentar, mudar coluna) ----------
  private readonly backlogEditor = viewChild.required(BacklogEditor);
  private readonly taskEditor = viewChild.required(ProjectTaskEditor);

  protected openCard(card: WorkCard, event: Event) {
    if ((event.target as HTMLElement).closest('select')) return; // o seletor "Mover" do cartão não abre o modal
    if (card.kind === 'backlog') {
      const item = this.backlog.items().find((i) => i.id === card.id);
      if (item) this.backlogEditor().openEdit(item);
    } else {
      const task = this.tasks.tasks().find((t) => t.id === card.id);
      if (task) this.taskEditor().open(task);
    }
  }

  protected isLate(card: WorkCard) {
    return !!card.due && card.column !== 'done' && card.due < today();
  }

  // ---------- Colunas do kanban de origem ----------
  private sprintColumns(item: BacklogItem) {
    return (item.sectorId && this.sectors.byId(item.sectorId)?.columns) || SPRINT_COLUMNS;
  }

  protected originColumns(card: WorkCard) {
    if (card.kind === 'task') return this.tasks.columns();
    const item = this.backlog.items().find((i) => i.id === card.id);
    return item ? this.sprintColumns(item) : SPRINT_COLUMNS;
  }

  protected originLabel(card: WorkCard, id = card.originColumn) {
    return this.originColumns(card).find((c) => c.id === id)?.label ?? id;
  }

  protected workColumnOf(card: WorkCard, originId: string): WorkColumn {
    return toWork(originId);
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
    if (p && p.choice !== p.card.originColumn) {
      // Mesmo caminho do kanban do setor: ir para Bloqueado bloqueia, sair de lá desbloqueia
      if (p.card.kind === 'backlog') this.backlog.setSprintStatus(p.card.id, p.choice, { from: this.originLabel(p.card), to: this.originLabel(p.card, p.choice) });
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
