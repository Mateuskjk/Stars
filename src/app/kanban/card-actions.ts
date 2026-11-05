import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

// Botões de ícone dos cartões (kanbans e lista do Work): Abrir · Editar · Arquivar · Excluir · Ir até.
// "Ir até" só aparece com `link`. O clique não chega ao cartão (que abriria o modal ou a página por conta própria).
@Component({
  selector: 'app-card-actions',
  imports: [RouterLink],
  host: { class: 'card-actions', '(click)': '$event.stopPropagation()' },
  template: `
    <button class="card-action card-action--open" type="button" title="Abrir" [attr.aria-label]="'Abrir ' + name()" (click)="open.emit()">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
    </button>
    <button class="card-action" type="button" title="Editar" [attr.aria-label]="'Editar ' + name()" (click)="edit.emit()">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></svg>
    </button>
    <button class="card-action card-action--archive" type="button" title="Arquivar" [attr.aria-label]="'Arquivar ' + name()" (click)="archive.emit()">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18v4H3z" /><path d="M5 8v12h14V8" /><path d="M10 12h4" /></svg>
    </button>
    <button class="card-action card-action--danger" type="button" title="Excluir" [attr.aria-label]="'Excluir ' + name()" (click)="remove.emit()">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
    </button>
    @if (link(); as to) {
      <a class="card-action card-action--go" [routerLink]="to" [title]="goLabel()" [attr.aria-label]="goLabel() + ': ' + name()">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
      </a>
    }
  `,
})
export class CardActions {
  readonly name = input.required<string>();
  readonly link = input<(string | number)[] | null>(null);
  readonly goLabel = input('Ir até');
  readonly open = output();
  readonly edit = output();
  readonly archive = output();
  readonly remove = output();
}
