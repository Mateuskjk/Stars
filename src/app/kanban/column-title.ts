import { Component, ElementRef, input, output, signal, viewChild } from '@angular/core';

export const isCustomColumn = (id: string) => id.startsWith('custom-');

// Título da coluna do kanban. Nas colunas criadas pelo usuário: renomear (✎) e excluir (🗑)
@Component({
  selector: 'app-column-title',
  host: { class: 'column-title' },
  template: `
    @if (editing()) {
      <input
        #name
        class="column-title__input"
        maxlength="40"
        aria-label="Novo nome da coluna"
        [value]="label()"
        (keydown.enter)="save()"
        (keydown.escape)="editing.set(false)"
        (blur)="save()"
      />
    } @else {
      <h3 class="column-title__text">{{ label() }}</h3>
      @if (custom()) {
        <button class="column-title__action" type="button" title="Renomear coluna" [attr.aria-label]="'Renomear coluna ' + label()" (click)="edit()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13 7 4 4" /></svg>
        </button>
        <button class="column-title__action" type="button" title="Excluir coluna" [attr.aria-label]="'Excluir coluna ' + label()" (click)="askRemove()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /></svg>
        </button>
      }
    }

    @if (custom()) {
      <dialog #confirm class="confirm-dialog" [attr.aria-label]="'Excluir a coluna ' + label()" (click)="$event.target === confirm && confirm.close()">
        <div class="confirm-dialog__box">
          <span class="confirm-dialog__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /></svg>
          </span>
          <h2 class="confirm-dialog__title">Excluir a coluna “{{ label() }}”?</h2>
          <p class="confirm-dialog__text">
            @if (count()) {
              {{ count() === 1 ? 'O item dela vai' : 'Os ' + count() + ' itens dela vão' }} para a coluna “{{ fallback() }}”.
            } @else {
              A coluna está vazia.
            }
          </p>
          <div class="confirm-dialog__actions">
            <button class="confirm-dialog__button" type="button" autofocus (click)="confirm.close()">Cancelar</button>
            <button class="confirm-dialog__button confirm-dialog__button--danger" type="button" (click)="confirm.close(); remove.emit()">Excluir</button>
          </div>
        </div>
      </dialog>
    }
  `,
})
export class ColumnTitle {
  readonly label = input.required<string>();
  readonly custom = input(false);
  readonly count = input(0); // itens na coluna (aviso ao excluir)
  readonly fallback = input(''); // coluna que recebe os itens ao excluir
  readonly rename = output<string>();
  readonly remove = output<void>();

  protected readonly editing = signal(false);
  private readonly input = viewChild<ElementRef<HTMLInputElement>>('name');
  private readonly confirm = viewChild<ElementRef<HTMLDialogElement>>('confirm');

  protected askRemove() {
    this.confirm()?.nativeElement.showModal();
  }

  protected edit() {
    this.editing.set(true);
    setTimeout(() => this.input()?.nativeElement.select());
  }

  protected save() {
    if (!this.editing()) return; // Enter já salvou; o blur que vem depois não repete
    const label = this.input()?.nativeElement.value.trim();
    this.editing.set(false);
    if (label && label !== this.label()) this.rename.emit(label);
  }
}
