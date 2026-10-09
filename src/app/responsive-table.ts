import { DestroyRef, Directive, ElementRef, inject } from '@angular/core';

// No celular (até 768px) a tabela mostra só a primeira coluna; tocar numa linha abre um modal com
// todas as colunas. O conteúdo das células é emprestado para o modal (botões e seletores continuam
// funcionando) e volta para a tabela quando o modal fecha.
@Directive({
  selector: 'table[appResponsiveTable]',
  host: { class: 'responsive-table', '(click)': 'onClick($event)' },
})
export class ResponsiveTable {
  private readonly table = inject(ElementRef<HTMLTableElement>).nativeElement as HTMLTableElement;
  private dialog: HTMLDialogElement | null = null;
  private moved: { cell: Element; nodes: Node[] }[] = [];

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.restore();
      this.dialog?.remove();
    });
  }

  protected onClick(event: MouseEvent) {
    if (!matchMedia('(max-width: 768px)').matches) return;
    const target = event.target as Element;
    if (target.closest('input, select, textarea, button, a, label')) return;
    const row = target.closest('tbody tr') as HTMLTableRowElement | null;
    if (row && this.table.contains(row)) this.open(row);
  }

  private open(row: HTMLTableRowElement) {
    const headers = [...this.table.querySelectorAll('thead tr:first-child > *')].map((th) => th.textContent!.trim());
    const dialog = (this.dialog ??= this.createDialog());
    // Título: cópia visual da primeira célula (nome, avatar, e-mail…)
    dialog.querySelector('h2')!.replaceChildren(...[...(row.cells[0]?.childNodes ?? [])].map((node) => node.cloneNode(true)));
    const list = dialog.querySelector('dl')!;
    list.replaceChildren();
    [...row.cells].forEach((cell, i) => {
      if (i === 0) return; // a primeira coluna já é o título
      const nodes = [...cell.childNodes];
      const hasContent = cell.textContent!.trim() || cell.querySelector('input, select, button, textarea, img, svg');
      if (!hasContent) return;
      const item = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = headers[i] || '';
      dd.append(...nodes);
      item.append(dt, dd);
      list.append(item);
      this.moved.push({ cell, nodes });
    });
    dialog.showModal();
  }

  // Devolve o conteúdo para a tabela na hora (o evento "close" do <dialog> chega depois)
  private close() {
    this.restore();
    this.dialog?.close();
  }

  private restore() {
    for (const { cell, nodes } of this.moved) cell.append(...nodes);
    this.moved = [];
  }

  private createDialog() {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal table-view';
    const header = document.createElement('header');
    header.className = 'modal__header';
    const title = document.createElement('h2');
    title.className = 'modal__title';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'modal__icon-button';
    close.setAttribute('aria-label', 'Fechar');
    close.textContent = '✕';
    close.addEventListener('click', () => this.close());
    header.append(title, close);
    const list = document.createElement('dl');
    list.className = 'table-view__list';
    dialog.append(header, list);
    // Esc. Se o modal já foi reaberto (evento atrasado do fechamento anterior), não mexe
    dialog.addEventListener('close', () => {
      if (!dialog.open) this.restore();
    });
    // clique no fundo fecha; clique num botão de ação (enviar, arquivar…) faz a ação e fecha
    dialog.addEventListener('click', (event) => {
      const target = event.target as Element;
      if (target === dialog) this.close();
      else if (target.closest('.table-view__list button')) setTimeout(() => this.close());
    });
    document.body.append(dialog);
    return dialog;
  }
}
