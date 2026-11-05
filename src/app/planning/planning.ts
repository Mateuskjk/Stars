import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { BacklogItem, BacklogStore } from '../backlog/backlog-store';
import { BoardToolbar, FilterField, FilterRule, matchesQuery, optionsOf, passesFilters } from '../kanban/board-toolbar';
import { SPRINT_DAYS, businessDay, businessIndex } from '../projects/project-tasks';
import { SPRINT_STATUS, Sprint, SprintStore } from './sprint-store';
import { BacklogEditor } from '../backlog/backlog-editor';

const today = () => new Date().toISOString().slice(0, 10);

interface PendingConfirm {
  title: string;
  text: string;
  label: string;
  danger: boolean;
  run: () => void;
}

@Component({
  imports: [BoardToolbar, BacklogEditor],
  selector: 'app-planning',
  templateUrl: './planning.html',
  host: { class: 'planning' },
})
export class Planning {
  private readonly backlog = inject(BacklogStore);
  protected readonly sprints = inject(SprintStore);

  protected readonly sprintStatus = SPRINT_STATUS;

  protected readonly active = this.sprints.active;

  // Atividades que terminaram o refinamento e ainda não entraram numa sprint (uma lista só, sem "aguardando")
  protected readonly candidates = computed(() =>
    this.backlog.ofCompany().filter((item) => item.status === 'refinement-done' && !item.sprintId),
  );

  // Busca pelo nome e filtros (Responsável, Etiqueta)
  protected readonly query = signal('');
  protected readonly filters = signal<FilterRule[]>([]);
  protected readonly filterFields = computed<FilterField[]>(() => [
    { key: 'responsavel', label: 'Responsável', options: optionsOf(this.candidates().map((i) => i.assignee)) },
    { key: 'etiqueta', label: 'Etiqueta', options: optionsOf(this.candidates().flatMap((i) => i.tags)) },
  ]);
  private readonly matches = (item: BacklogItem) =>
    matchesQuery(item.name, this.query()) && passesFilters(this.filters(), (key) => (key === 'etiqueta' ? item.tags : item.assignee));
  protected readonly ready = computed(() => this.candidates().filter(this.matches));

  // Aguardando para voltar à sprint: o que não foi concluído numa sprint que já fechou. A atividade continua registrada
  // na sprint antiga (o histórico e os dashboards não mudam) até alguém mandá-la de novo para a sprint ativa.
  protected readonly returning = computed(() =>
    this.backlog.ofCompany().filter((item) => {
      const sprint = this.sprints.byId(item.sprintId);
      const closed = sprint?.status === 'closed' || sprint?.status === 'archived';
      const finished = item.sprintStatus === 'done' || !!item.doneAt || ['archived', 'canceled'].includes(item.status);
      return closed && !finished && this.matches(item);
    }),
  );
  protected readonly returningOpen = signal(false);

  protected sprintName(item: BacklogItem) {
    return this.sprints.byId(item.sprintId)?.name ?? '';
  }
  protected readonly inSprint = computed(() => {
    const sprint = this.active();
    return sprint ? this.backlog.ofCompany().filter((item) => item.sprintId === sprint.id) : [];
  });

  protected readonly daysLeft = computed(() => {
    const sprint = this.active();
    if (!sprint) return 0;
    // dias úteis que faltam (a sprint tem 7 dias úteis)
    return Math.max(0, businessIndex(sprint.end) - businessIndex(today()));
  });

  protected formatDay(iso: string) {
    if (!iso) return '—';
    const [, month, day] = iso.split('-');
    return `${day}/${month}`;
  }

  protected period(sprint: Sprint) {
    return `${this.formatDay(sprint.start)} a ${this.formatDay(sprint.end)}`;
  }

  // Linha de dados: etiquetas · responsável · prazo · sub atividades
  protected meta(item: BacklogItem) {
    const done = item.subtasks.filter((s) => s.done).length;
    return [
      item.tags.join(', '),
      item.assignee || 'Sem responsável',
      item.due && 'até ' + this.formatDay(item.due),
      item.subtasks.length && `☑ ${done}/${item.subtasks.length}`,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  // ---------- Decisões sobre as atividades ----------
  // Editar a atividade (o mesmo modal do Backlog) antes de mandar para a sprint
  private readonly editor = viewChild.required(BacklogEditor);

  protected edit(item: BacklogItem) {
    this.editor().openEdit(item);
  }

  // Só com responsável: na sprint, toda atividade tem dono
  protected sendToSprint(item: BacklogItem) {
    const sprint = this.active();
    if (sprint && item.assignee) this.backlog.patch(item.id, { sprintId: sprint.id });
  }

  protected removeFromSprint(item: BacklogItem) {
    this.backlog.patch(item.id, { sprintId: undefined, planning: 'ready' });
  }

  protected archive(item: BacklogItem) {
    this.backlog.patch(item.id, { status: 'archived', sprintId: undefined });
  }

  protected askDelete(item: BacklogItem) {
    this.ask({
      title: 'Excluir esta atividade?',
      text: `“${item.name}” será removida do backlog. Essa ação não pode ser desfeita.`,
      label: 'Excluir',
      danger: true,
      run: () => this.backlog.remove(item.id),
    });
  }

  // ---------- Sprint ----------
  protected askClose(sprint: Sprint) {
    this.ask({
      title: `Fechar a ${sprint.name}?`,
      text: 'A sprint vai para o histórico. Os cartões que não foram concluídos ficam aqui, em “Cartões aguardando para voltar à sprint”. Depois você pode criar a próxima.',
      label: 'Fechar sprint',
      danger: false,
      run: () => this.sprints.setStatus(sprint.id, 'closed'),
    });
  }

  protected askCancel(sprint: Sprint) {
    this.ask({
      title: `Cancelar a ${sprint.name}?`,
      text: 'As atividades da sprint voltam para “Prontas para sprint”. Essa ação não pode ser desfeita.',
      label: 'Cancelar sprint',
      danger: true,
      run: () => {
        for (const item of this.inSprint()) this.removeFromSprint(item);
        this.sprints.setStatus(sprint.id, 'canceled');
      },
    });
  }

  // Modal de criação de sprint
  private readonly sprintDialog = viewChild.required<ElementRef<HTMLDialogElement>>('sprintDialog');
  protected readonly sprintError = signal('');

  protected openCreate() {
    this.sprintError.set('');
    this.sprintDialog().nativeElement.showModal();
  }

  protected closeCreate() {
    this.sprintDialog().nativeElement.close();
  }

  protected createSprint(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    const value = (field: string) => String(data.get(field) ?? '').trim();
    const [start, end] = [value('start'), value('end')];
    if (end < start) {
      this.sprintError.set('A data de fim precisa ser depois da data de início.');
      return;
    }
    this.sprints.create({ name: value('name') || `Sprint ${this.sprints.nextNumber()}`, start, end, goal: value('goal') });
    form.reset();
    this.closeCreate();
  }

  protected readonly defaultStart = today();
  protected readonly defaultEnd = businessDay(businessIndex(today()) + SPRINT_DAYS - 1); // 7 dias úteis

  // ---------- Confirmação (uma janela para todas as ações destrutivas) ----------
  private readonly confirmDialog = viewChild.required<ElementRef<HTMLDialogElement>>('confirmDialog');
  protected readonly pending = signal<PendingConfirm | null>(null);

  private ask(confirm: PendingConfirm) {
    this.pending.set(confirm);
    this.confirmDialog().nativeElement.showModal();
  }

  protected confirm() {
    this.pending()?.run();
    this.confirmDialog().nativeElement.close();
  }

  protected cancelConfirm() {
    this.confirmDialog().nativeElement.close();
  }

  protected closeOnBackdrop(event: MouseEvent, dialog: HTMLDialogElement) {
    if (event.target === dialog) dialog.close();
  }
}
