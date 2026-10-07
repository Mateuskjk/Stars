import { TestBed } from '@angular/core/testing';
import { Chat, formatTime } from './chat';

describe('Chat', () => {
  it('formats today as hour and other days as date', () => {
    const now = new Date(2026, 9, 7, 15, 0);
    expect(formatTime(new Date(2026, 9, 7, 9, 5), now)).toBe('09:05');
    expect(formatTime(new Date(2026, 9, 5, 9, 5), now)).toBe('05/10');
  });

  it('searches ignoring accents, opens a conversation and sends a message', async () => {
    await TestBed.configureTestingModule({ imports: [Chat] }).compileComponents();
    const fixture = TestBed.createComponent(Chat);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const names = () => [...el.querySelectorAll('.chat__contact-name')].map((n) => n.textContent);

    const search = el.querySelector<HTMLInputElement>('.chat__search input')!;
    search.value = 'CARLOS';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(names()).toEqual(['Carlos Lima']);

    el.querySelector<HTMLButtonElement>('.chat__contact')!.click();
    fixture.detectChanges();
    expect(el.querySelector('.chat__header .chat__contact-name')?.textContent).toBe('Carlos Lima');

    const input = el.querySelector<HTMLInputElement>('.chat__composer-input')!;
    input.value = 'Olá!';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    el.querySelector<HTMLFormElement>('.chat__composer')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    // column-reverse: a mensagem mais nova é o primeiro item da lista
    expect(el.querySelector('.chat__message .chat__bubble')?.textContent).toBe('Olá!');
    expect(input.value).toBe('');
  });
});
