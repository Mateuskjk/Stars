import { NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { initials } from '../chat/chat';
import { BacklogItem, BacklogStore, tagColor } from '../backlog/backlog-store';
import { formatWeekDate } from '../home/home';
import { SPRINT_DAYS, businessDay, businessIndex } from '../projects/project-tasks';
import { SPRINT_STATUS, Sprint, SprintStore } from './sprint-store';
import { ResponsiveTable } from '../responsive-table';

const today = () => new Date().toISOString().slice(0, 10);

interface PendingConfirm {
  title: string;
  text: string;
  label: string;
  danger: boolean;
  run: () => void;
}

@Component({
  imports: [ResponsiveTable, NgTemplateOutlet],
  selector: 'app-planning',
  templateUrl: './planning.html',
  host: { class: 'planning' },
})
export class Planning {
  private readonly backlog = inject(BacklogStore);
  protected readonly sprints = inject(SprintStore);

  protected readonly weekDate = formatWeekDate(new Date());
  protected readonly initials = initials;
  protected readonly tagColor = tagColor;
  protected readonly sprintStatus = SPRINT_STATUS;

  protected readonly active = this.sprints.active;

  // Atividades que terminaram o refinamento e ainda não entraram numa sprint
  private readonly candidates = computed(() =>
    this.backlog.ofCompany().filter((item) => item.status === 'refinement-done' && !item.sprintId),
  );
  protected readonly ready = computed(() => this.candidates().filter((item) => (item.planning ?? 'ready') === 'ready'));
  protected readonly waiting = computed(() => this.candidates().filter((item) => item.planning === 'waiting'));
  protected readonly inSprint = computed(() => {
    const sprint = this.active();
    return sprint ? this.backlog.ofCompany().filter((item) => item.sprintId === sprint.id) : [];
  });

  protected readonly history = computed(() => [...this.sprints.ofCompany()].filter((s) => s.status !== 'active').reverse());

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

  protected doneSubtasks(item: BacklogItem) {
    return item.subtasks.filter((s) => s.done).length;
  }

  // ---------- Decisões sobre as atividades ----------
  protected setCategory(item: BacklogItem, planning: 'ready' | 'waiting') {
    this.backlog.patch(item.id, { planning });
  }

  protected sendToSprint(item: BacklogItem) {
    const sprint = this.active();
    if (sprint) this.backlog.patch(item.id, { sprintId: sprint.id });
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
      text: 'A sprint vai para o histórico com as atividades que estão nela. Depois você pode criar a próxima.',
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

  protected archiveSprint(sprint: Sprint) {
    this.sprints.setStatus(sprint.id, 'archived');
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
