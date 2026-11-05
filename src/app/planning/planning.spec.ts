import { TestBed } from '@angular/core/testing';
import { BacklogStore } from '../backlog/backlog-store';
import { Planning } from './planning';
import { SprintStore } from './sprint-store';

// jsdom não implementa showModal/close do <dialog>
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};

describe('Planning', () => {
  it('lists refined activities in one list, sends to the sprint and handles the sprint lifecycle', async () => {
    await TestBed.configureTestingModule({ imports: [Planning] }).compileComponents();
    const backlog = TestBed.inject(BacklogStore);
    const sprints = TestBed.inject(SprintStore);
    const fixture = TestBed.createComponent(Planning);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const names = () => [...el.querySelectorAll('.planning__row .planning__name')].map((n) => n.textContent!.trim()).sort();
    const rowButton = (name: string, label: string) => {
      const row = [...el.querySelectorAll('.planning__row')].find((r) => r.textContent!.includes(name))!;
      [...row.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.includes(label))!.click();
      fixture.detectChanges();
    };
    const confirm = () => {
      el.querySelector<HTMLElement>('dialog.confirm-dialog .confirm-dialog__button:last-child')!.click();
      fixture.detectChanges();
    };

    // Só "Finalizado refinamento", numa lista só (as que estavam "aguardando" também entram)
    expect(names()).toEqual(['Rotina de backup dos arquivos', 'Template de relatório mensal', 'Treinamento de segurança']);
    expect(el.querySelector('.planning__sprint-name')?.textContent).toContain('Sprint 12');

    // Enviar para a sprint ativa: sai da lista e entra na sprint
    rowButton('Template de relatório mensal', 'Enviar para sprint');
    expect(names()).not.toContain('Template de relatório mensal');
    expect(backlog.items().find((i) => i.name === 'Template de relatório mensal')?.sprintId).toBe(sprints.active()!.id);

    // Cancelar a sprint devolve as atividades para a lista
    el.querySelector<HTMLElement>('.planning__sprint-actions .modal__ghost')!.click();
    fixture.detectChanges();
    confirm();
    expect(sprints.active()).toBeNull();
    expect(names()).toEqual(expect.arrayContaining(['Template de relatório mensal', 'Automatizar convites da daily']));
    expect(el.querySelector<HTMLButtonElement>('.planning__row button.modal__primary')!.disabled).toBe(true); // sem sprint, não envia

    // Criar a próxima sprint
    el.querySelector<HTMLElement>('.board-toolbar .backlog__new')!.click(); // "+ Criar sprint", ao lado do Filtro
    fixture.detectChanges();
    el.querySelector('dialog.planning__dialog form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    expect(sprints.active()?.name).toBe('Sprint 13');

    // Arquivar uma atividade tira ela da planning
    rowButton('Template de relatório mensal', 'Arquivar');
    expect(backlog.items().find((i) => i.name === 'Template de relatório mensal')?.status).toBe('archived');
  });

  it('ao fechar a sprint, os não concluídos esperam em "aguardando para voltar à sprint" e voltam pela Planning', async () => {
    await TestBed.configureTestingModule({ imports: [Planning] }).compileComponents();
    const backlog = TestBed.inject(BacklogStore);
    const sprints = TestBed.inject(SprintStore);
    const fixture = TestBed.createComponent(Planning);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const sprint = sprints.active()!;
    const inSprint = backlog.ofCompany().filter((i) => i.sprintId === sprint.id);
    const open = inSprint.filter((i) => i.sprintStatus !== 'done' && !i.doneAt);
    expect(open.length).toBeGreaterThan(0);

    // Fechar a sprint (confirmação)
    el.querySelector<HTMLElement>('.planning__sprint-actions .modal__primary')!.click();
    fixture.detectChanges();
    el.querySelector<HTMLElement>('dialog.confirm-dialog .confirm-dialog__button:last-child')!.click();
    fixture.detectChanges();
    expect(sprints.active()).toBeNull();
    // as atividades continuam registradas na sprint fechada (o histórico não muda)
    expect(backlog.ofCompany().filter((i) => i.sprintId === sprint.id)).toHaveLength(inSprint.length);

    // A seção abre e fecha; lista só os não concluídos
    const section = el.querySelector('.planning__returning')!;
    section.querySelector<HTMLButtonElement>('.planning__toggle')!.click();
    fixture.detectChanges();
    const names = () => [...section.querySelectorAll('.planning__name')].map((n) => n.textContent!.trim()).sort();
    expect(names()).toEqual(open.map((i) => i.name).sort());

    // Com a próxima sprint criada, "Voltar para a sprint" leva o cartão para ela
    sprints.create({ name: 'Sprint 13', start: '2026-11-09', end: '2026-11-17', goal: '' });
    fixture.detectChanges();
    const first = open.find((i) => i.assignee)!;
    const row = [...section.querySelectorAll('.planning__row')].find((r) => r.textContent!.includes(first.name))!;
    [...row.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.includes('Voltar para a sprint'))!.click();
    fixture.detectChanges();
    expect(backlog.items().find((i) => i.id === first.id)!.sprintId).toBe(sprints.active()!.id);
    expect(names()).not.toContain(first.name);
  });

  it('busca pelo nome', async () => {
    await TestBed.configureTestingModule({ imports: [Planning] }).compileComponents();
    const fixture = TestBed.createComponent(Planning);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector<HTMLInputElement>('.board-toolbar__search input')!;
    input.value = 'backup';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect([...el.querySelectorAll('.planning__row .planning__name')].map((n) => n.textContent!.trim())).toEqual(['Rotina de backup dos arquivos']);
  });

  it('abre a atividade no modal de edição (o do Backlog) antes de mandar para a sprint', async () => {
    await TestBed.configureTestingModule({ imports: [Planning] }).compileComponents();
    const fixture = TestBed.createComponent(Planning);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const modal = el.querySelector<HTMLDialogElement>('dialog[aria-labelledby="editor-title"]')!;
    const first = el.querySelector<HTMLButtonElement>('.planning__open')!;
    const name = first.querySelector('.planning__name')!.textContent!.trim();
    first.click();
    fixture.detectChanges();
    expect(modal.open).toBe(true);
    expect(modal.querySelector<HTMLInputElement>('input')!.value).toBe(name);
  });
});
