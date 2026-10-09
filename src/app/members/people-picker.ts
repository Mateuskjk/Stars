import { Component, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { initials } from '../chat/chat';
import { MembersStore } from './members-store';

const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// Seletor de pessoas com busca por nome ou e-mail (várias de uma vez). Guarda os nomes.
@Component({
  selector: 'app-people-picker',
  host: {
    class: 'people-picker',
    '(document:click)': 'closeOnOutside($event)',
    '(keydown.escape)': 'open.set(false)',
  },
  template: `
    <button class="modal__input people-picker__toggle" type="button" [attr.aria-expanded]="open()" (click)="toggle()">
      @if (selected().length) {
        <span class="people-picker__chips">
          @for (name of selected(); track name) {
            <span class="people-picker__chip">
              <span class="kanban__avatar">{{ initials(name) }}</span>
              {{ name }}
              <span class="people-picker__remove" role="button" tabindex="0" [attr.aria-label]="'Remover ' + name" (click)="remove(name, $event)" (keydown.enter)="remove(name, $event)">✕</span>
            </span>
          }
        </span>
      } @else {
        <span class="people-picker__placeholder">{{ placeholder() }}</span>
      }
      <span class="people-picker__caret" aria-hidden="true">▾</span>
    </button>

    @if (open()) {
      <div class="people-picker__menu" role="listbox" aria-multiselectable="true" [attr.aria-label]="placeholder()">
        <input
          #search
          class="modal__input people-picker__search"
          type="search"
          placeholder="Buscar por nome ou e-mail"
          aria-label="Buscar por nome ou e-mail"
          [value]="term()"
          (input)="term.set($any($event.target).value)"
          (keydown.enter)="$event.preventDefault()"
        />
        <ul class="people-picker__list">
          @for (person of results(); track person.name) {
            <li>
              <label class="people-picker__option" role="option" [attr.aria-selected]="selected().includes(person.name)">
                <input type="checkbox" [checked]="selected().includes(person.name)" (change)="toggleName(person.name)" />
                <span class="kanban__avatar">{{ initials(person.name) }}</span>
                <span class="people-picker__who">
                  {{ person.name }}
                  <small>{{ person.email }}</small>
                </span>
              </label>
            </li>
          } @empty {
            <li class="people-picker__empty">Ninguém encontrado para “{{ term() }}”.</li>
          }
        </ul>
      </div>
    }
  `,
})
export class PeoplePicker {
  readonly selected = input<string[]>([]);
  readonly exclude = input<string>(''); // ex.: o responsável (já participa)
  readonly placeholder = input('Selecionar pessoas');
  readonly selectedChange = output<string[]>();

  private readonly members = inject(MembersStore);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('search');

  protected readonly initials = initials;
  protected readonly open = signal(false);
  protected readonly term = signal('');

  // Membros ativos, filtrados pela busca (nome ou e-mail, sem diferenciar acentos)
  protected readonly results = computed(() => {
    const term = normalize(this.term().trim());
    return this.members
      .members()
      .filter((m) => m.status === 'active' && m.name !== this.exclude())
      .filter((m) => !term || normalize(`${m.name} ${m.email}`).includes(term));
  });

  protected toggle() {
    this.open.update((open) => !open);
    if (this.open()) {
      this.term.set('');
      setTimeout(() => this.searchInput()?.nativeElement.focus());
    }
  }

  protected toggleName(name: string) {
    const list = this.selected();
    this.selectedChange.emit(list.includes(name) ? list.filter((n) => n !== name) : [...list, name]);
  }

  protected remove(name: string, event: Event) {
    event.stopPropagation();
    this.selectedChange.emit(this.selected().filter((n) => n !== name));
  }

  protected closeOnOutside(event: MouseEvent) {
    if (this.open() && !(this.host.nativeElement as HTMLElement).contains(event.target as Node)) this.open.set(false);
  }
}
