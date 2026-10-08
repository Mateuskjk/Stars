import { Component, ElementRef, output, signal, viewChild } from '@angular/core';

export type CustomColumnId = `custom-${number}`;

export interface KanbanColumn<Id extends string = string> {
  id: Id;
  label: string;
  color: string;
}

// Cores das colunas criadas pelo usuário (a cor sempre vem junto do nome, nunca sozinha)
const COLORS = ['#1baf7a', '#e87ba4', '#4a3aa7', '#008300', '#eb6834', '#5598e7'];

export function customColumn(label: string, existing: number): KanbanColumn<CustomColumnId> {
  return { id: `custom-${Date.now()}`, label, color: COLORS[existing % COLORS.length] };
}

// Botão "+ Nova coluna" no fim do quadro: vira um campo; Enter cria, Esc cancela
@Component({
  selector: 'app-add-column',
  host: { class: 'add-column' },
  template: `
    @if (editing()) {
      <form class="add-column__form" (submit)="submit($event)">
        <input
          #name
          class="add-column__input"
          maxlength="40"
          placeholder="Nome da coluna"
          aria-label="Nome da nova coluna"
          (keydown.escape)="editing.set(false)"
          (blur)="!name.value.trim() && editing.set(false)"
        />
        <div class="add-column__actions">
          <button class="add-column__save" type="submit">Criar</button>
          <button class="add-column__cancel" type="button" (click)="editing.set(false)">Cancelar</button>
        </div>
      </form>
    } @else {
      <button class="add-column__open" type="button" (click)="open()">+ Nova coluna</button>
    }
  `,
})
export class AddColumn {
  readonly add = output<string>();
  protected readonly editing = signal(false);
  private readonly input = viewChild<ElementRef<HTMLInputElement>>('name');

  protected open() {
    this.editing.set(true);
    setTimeout(() => this.input()?.nativeElement.focus());
  }

  protected submit(event: Event) {
    event.preventDefault();
    const label = this.input()?.nativeElement.value.trim();
    if (!label) return;
    this.add.emit(label);
    this.editing.set(false);
  }
}
