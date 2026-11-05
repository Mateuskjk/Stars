import { Component, ElementRef, signal, viewChild } from '@angular/core';

// Confirmação de exclusão dos botões dos cartões (kanbans): ask('nome', () => apagar())
@Component({
  selector: 'app-confirm-delete',
  template: `
    <dialog #dialog class="confirm-dialog" aria-labelledby="confirm-delete-title" (click)="$event.target === dialog && dialog.close()">
      @if (pending(); as p) {
        <div class="confirm-dialog__box">
          <h2 id="confirm-delete-title" class="confirm-dialog__title">Excluir {{ p.what }}?</h2>
          <p class="confirm-dialog__text">“{{ p.name }}” será removido. Essa ação não pode ser desfeita.</p>
          <div class="confirm-dialog__actions">
            <button class="confirm-dialog__button" type="button" (click)="dialog.close()">Cancelar</button>
            <button class="confirm-dialog__button confirm-dialog__button--danger" type="button" (click)="confirm()">Excluir</button>
          </div>
        </div>
      }
    </dialog>
  `,
})
export class ConfirmDelete {
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  protected readonly pending = signal<{ name: string; what: string; run: () => void } | null>(null);

  ask(name: string, run: () => void, what = 'esta atividade') {
    this.pending.set({ name, what, run });
    this.dialog().nativeElement.showModal();
  }

  protected confirm() {
    this.pending()?.run();
    this.dialog().nativeElement.close();
  }
}
