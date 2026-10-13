import { TestBed } from '@angular/core/testing';
import { Daily } from './daily';
import { DailyHistory } from './daily-history';

describe('Daily', () => {
  beforeEach(() => localStorage.clear());

  it('starts, keeps notes per person, and the summary keeps what was typed, even without saving', async () => {
    await TestBed.configureTestingModule({ imports: [Daily] }).compileComponents();
    const fixture = TestBed.createComponent(Daily);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const click = (selector: string, index = 0) => {
      el.querySelectorAll<HTMLElement>(selector)[index].click();
      fixture.detectChanges();
    };
    const type = (value: string) => {
      const textarea = el.querySelector<HTMLTextAreaElement>('.daily__textarea')!;
      textarea.value = value;
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };

    click('.daily__start');
    expect(el.querySelectorAll('.daily__person')).toHaveLength(7);

    // Pessoa 1 escreve e salva; pessoa 2 escreve e não salva
    type('Terminei o login');
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    click('.daily__person', 1);
    type('Rascunho não salvo');

    // Voltar para a pessoa 1 mostra o texto dela, não o rascunho da pessoa 2
    click('.daily__person', 0);
    expect(el.querySelector<HTMLTextAreaElement>('.daily__textarea')!.value).toBe('Terminei o login');

    click('.daily__finish');
    expect(el.querySelector('.daily__summary-header')?.textContent).toContain('2 de 7');
    const notes = [...el.querySelectorAll('.daily__summary-notes dd')].map((dd) => dd.textContent);
    expect(notes).toContain('Terminei o login');
    expect(notes).toContain('Rascunho não salvo');
  });

  it('keeps finished dailies in the history after the page is opened again', async () => {
    await TestBed.configureTestingModule({ imports: [Daily] }).compileComponents();
    const first = TestBed.createComponent(Daily);
    first.detectChanges();
    const el = first.nativeElement as HTMLElement;
    el.querySelector<HTMLElement>('.daily__start')!.click();
    first.detectChanges();
    el.querySelector<HTMLElement>('.daily__finish')!.click();
    first.detectChanges();
    first.destroy();

    // Nova abertura da página: o histórico vem do localStorage
    TestBed.inject(DailyHistory).records.set([]);
    const again = TestBed.createComponent(Daily);
    again.detectChanges();
    await again.whenStable();
    again.detectChanges();
    const items = (again.nativeElement as HTMLElement).querySelectorAll('.daily__history-item');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain('0 de 7 com anotações');
  });

  it('deletes a daily from the history only after confirming in the dialog', async () => {
    // jsdom não implementa showModal/close do <dialog>
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };

    localStorage.setItem('stars.daily-history', JSON.stringify([{ id: 1, date: new Date().toISOString(), participants: [] }]));
    await TestBed.configureTestingModule({ imports: [Daily] }).compileComponents();
    const history = TestBed.inject(DailyHistory);
    const fixture = TestBed.createComponent(Daily);
    fixture.detectChanges();
    await fixture.whenStable(); // carrega o histórico do localStorage
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const click = (selector: string) => {
      el.querySelector<HTMLElement>(selector)!.click();
      fixture.detectChanges();
    };
    const dialog = el.querySelector('dialog')!;

    click('.daily__history-delete');
    expect(dialog.open).toBe(true);
    click('.confirm-dialog__button'); // Cancelar
    expect(dialog.open).toBe(false);
    expect(history.records()).toHaveLength(1);

    click('.daily__history-delete');
    click('.confirm-dialog__button--danger'); // Excluir
    expect(dialog.open).toBe(false);
    expect(history.records()).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem('stars.daily-history')!)).toEqual([]);
  });
});
