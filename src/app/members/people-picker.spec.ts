import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PeoplePicker } from './people-picker';

@Component({
  imports: [PeoplePicker],
  template: `<app-people-picker [selected]="selected()" exclude="Ana Souza" (selectedChange)="selected.set($event)" />`,
})
class Host {
  readonly selected = signal<string[]>([]);
}

describe('PeoplePicker', () => {
  it('searches by name or e-mail, selects several people and removes them', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const names = () => [...el.querySelectorAll('.people-picker__who')].map((w) => w.firstChild!.textContent!.trim());
    const search = (text: string) => {
      const input = el.querySelector<HTMLInputElement>('.people-picker__search')!;
      input.value = text;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };

    el.querySelector<HTMLButtonElement>('.people-picker__toggle')!.click();
    fixture.detectChanges();
    expect(names()).not.toContain('Ana Souza'); // o responsável fica de fora

    search('carlos.lima@'); // pelo e-mail
    expect(names()).toEqual(['Carlos Lima']);
    el.querySelector<HTMLInputElement>('.people-picker__option input')!.click();
    fixture.detectChanges();

    search('diego'); // pelo nome, sem diferenciar maiúsculas
    el.querySelector<HTMLInputElement>('.people-picker__option input')!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selected()).toEqual(['Carlos Lima', 'Diego Rocha']);

    search('ninguém');
    expect(el.querySelector('.people-picker__empty')).not.toBeNull();

    el.querySelector<HTMLElement>('.people-picker__remove')!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selected()).toEqual(['Diego Rocha']);
  });
});
