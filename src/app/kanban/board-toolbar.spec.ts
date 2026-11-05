import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BoardToolbar, FilterRule } from './board-toolbar';

@Component({
  imports: [BoardToolbar],
  template: `<app-board-toolbar storageKey="teste" filterKey="1" [count]="0" [fields]="fields" [(filters)]="filters" />`,
})
class Host {
  fields = [{ key: 'pessoa', label: 'Pessoa', options: [{ value: 'Ana', label: 'Ana' }] }];
  filters = signal<FilterRule[]>([]);
}

describe('BoardToolbar (filtros salvos)', () => {
  beforeEach(() => localStorage.clear());

  it('lembra os filtros na próxima abertura e descarta os que não existem mais', () => {
    const first = TestBed.createComponent(Host);
    first.detectChanges();
    first.componentInstance.filters.set([{ key: 'pessoa', value: 'Ana' }]);
    first.detectChanges();
    first.destroy();

    const again = TestBed.createComponent(Host);
    again.detectChanges();
    expect(again.componentInstance.filters()).toEqual([{ key: 'pessoa', value: 'Ana' }]);
    again.destroy();

    // a pessoa saiu da empresa: o filtro salvo não volta
    localStorage.setItem('stars.filters.teste.1', JSON.stringify([{ key: 'pessoa', value: 'Bruno' }]));
    const later = TestBed.createComponent(Host);
    later.detectChanges();
    expect(later.componentInstance.filters()).toEqual([]);
  });
});
