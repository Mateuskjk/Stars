import { TestBed } from '@angular/core/testing';
import { Backlog } from './backlog';
import { BacklogStore } from './backlog-store';

// jsdom não implementa showModal/close do <dialog>
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};

describe('Backlog', () => {
  it('creates, edits, advances, locks and deletes an activity through the modal', async () => {
    await TestBed.configureTestingModule({ imports: [Backlog] }).compileComponents();
    const store = TestBed.inject(BacklogStore);
    const fixture = TestBed.createComponent(Backlog);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const $ = <T extends HTMLElement>(selector: string) => el.querySelector<T>(selector)!;
    const click = (selector: string) => {
      $(selector).click();
      fixture.detectChanges();
    };
    const type = (selector: string, value: string, event = 'input') => {
      const input = $<HTMLInputElement>(selector);
      input.value = value;
      input.dispatchEvent(new Event(event));
      fixture.detectChanges();
    };
    const enter = (selector: string, value: string) => {
      $<HTMLInputElement>(selector).value = value;
      $(selector).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      fixture.detectChanges();
    };
    const submit = () => {
      $('.modal__form').dispatchEvent(new Event('submit', { cancelable: true }));
      fixture.detectChanges();
    };
    const find = () => store.items().find((item) => item.name === 'Revisar contratos')!;

    // Criar
    click('.backlog__new');
    expect($<HTMLDialogElement>('dialog.modal').open).toBe(true);
    type('.modal__main input', 'Revisar contratos');
    enter('[aria-label="Nova tag"]', 'Jurídico');
    enter('[aria-label="Nova sub atividade"]', 'Separar contratos vencidos');
    submit();
    expect(find()).toMatchObject({ status: 'to-refine', tags: ['jurídico'], subtasks: [{ title: 'Separar contratos vencidos', done: false }] });

    // Editar: avançar uma coluna e salvar
    const card = [...el.querySelectorAll<HTMLElement>('.backlog-card__open')].find((c) => c.textContent!.includes('Revisar contratos'))!;
    card.click();
    fixture.detectChanges();
    click('.modal__steps button:last-child'); // Avançar
    submit();
    expect(find().status).toBe('refined');

    // Bloqueado não muda de coluna (nem arrastando)
    store.save({ ...find(), locked: true });
    store.move(find().id, 'waiting');
    expect(find().status).toBe('refined');

    // Excluir com confirmação
    store.save({ ...find(), locked: false });
    [...el.querySelectorAll<HTMLElement>('.backlog-card__open')].find((c) => c.textContent!.includes('Revisar contratos'))!.click();
    fixture.detectChanges();
    click('.modal__ghost--danger');
    click('.confirm-dialog__button--danger');
    expect(store.items().some((item) => item.name === 'Revisar contratos')).toBe(false);
  });
});
