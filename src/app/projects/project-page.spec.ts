import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ProjectPage } from './project-page';
import { ProjectTaskStore } from './project-tasks';

// jsdom não implementa showModal/close do <dialog>
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};

describe('ProjectPage', () => {
  it('shows the project header and a kanban with only its activities', async () => {
    await TestBed.configureTestingModule({ imports: [ProjectPage], providers: [provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(ProjectPage);
    fixture.componentRef.setInput('id', '2'); // App mobile
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const store = TestBed.inject(ProjectTaskStore);
    const mine = () => store.tasks().filter((t) => t.projectId === 2);
    const cards = () => el.querySelectorAll('.kanban__card').length;

    expect(el.querySelector('.project-page__title')!.textContent).toBe('App mobile');
    expect(el.textContent).toContain('Setor');
    expect(cards()).toBe(mine().length);

    // mover para Concluída marca a data de entrega
    const task = mine().find((t) => t.status !== 'done')!;
    store.setStatus(task.id, 'done');
    expect(store.tasks().find((t) => t.id === task.id)!.doneAt).not.toBeNull();

    // nova atividade entra só neste projeto
    el.querySelector<HTMLButtonElement>('.project-page__kanban-head .backlog__new')!.click();
    fixture.detectChanges();
    const form = el.querySelector<HTMLFormElement>('.project-page__new')!;
    form.querySelector<HTMLInputElement>('[name="title"]')!.value = 'Tela de pedidos';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    expect(mine().at(-1)).toMatchObject({ title: 'Tela de pedidos', projectId: 2, status: 'todo', points: 3 });
    expect(cards()).toBe(mine().length);
  });

  it('clicking a card opens the activity modal; saving and archiving update the kanban', async () => {
    await TestBed.configureTestingModule({ imports: [ProjectPage], providers: [provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(ProjectPage);
    fixture.componentRef.setInput('id', '3'); // Portal do cliente
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const store = TestBed.inject(ProjectTaskStore);
    const card = el.querySelector<HTMLElement>('.kanban__card')!;
    const title = card.querySelector('.kanban__card-title')!.textContent!.trim();
    const task = store.tasks().find((t) => t.projectId === 3 && t.title === title)!;

    // o seletor "Mover para" não abre o modal
    card.querySelector('select')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    const dialog = el.querySelector<HTMLDialogElement>('app-project-task-editor dialog.modal')!;
    expect(dialog.open).toBe(false);

    card.click();
    fixture.detectChanges();
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector<HTMLInputElement>('input.modal__input')!.value).toBe(title);

    // editar: novo nome e status Revisão
    const name = dialog.querySelector<HTMLInputElement>('input.modal__input')!;
    name.value = 'Área logada (v2)';
    name.dispatchEvent(new Event('input'));
    const status = dialog.querySelector<HTMLSelectElement>('.modal__side select')!;
    status.value = 'review';
    status.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    expect(store.tasks().find((t) => t.id === task.id)).toMatchObject({ title: 'Área logada (v2)', status: 'review', doneAt: null });
    expect(dialog.open).toBe(false);

    // arquivar (sai do kanban; no banco fica arquivada)
    el.querySelector<HTMLElement>('.kanban__card')!.click();
    fixture.detectChanges();
    dialog.querySelector<HTMLButtonElement>('.modal__danger-zone .modal__ghost')!.click();
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('app-project-task-editor .confirm-dialog__button--primary')!.click();
    fixture.detectChanges();
    expect(store.tasks().some((t) => t.title === 'Área logada (v2)')).toBe(false);
  });

  it('shows a message for an unknown project', async () => {
    await TestBed.configureTestingModule({ imports: [ProjectPage], providers: [provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(ProjectPage);
    fixture.componentRef.setInput('id', '999');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Projeto não encontrado');
  });
});
