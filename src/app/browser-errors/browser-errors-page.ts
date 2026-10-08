import { Component, ElementRef, computed, signal, viewChild } from '@angular/core';
import { BrowserError, ERROR_KINDS, ErrorKind, browserErrors, clearBrowserErrors } from './browser-errors';

const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

@Component({
  selector: 'app-browser-errors',
  templateUrl: './browser-errors-page.html',
  host: { class: 'browser-errors' },
})
export class BrowserErrorsPage {
  protected readonly kinds = Object.entries(ERROR_KINDS) as [ErrorKind, { label: string; color: string }][];
  protected readonly kindInfo = ERROR_KINDS;
  protected readonly errors = browserErrors;

  protected readonly search = signal('');
  protected readonly kindFilter = signal<Set<ErrorKind>>(new Set());
  protected readonly expanded = signal<Set<string>>(new Set());
  protected readonly copied = signal<string | null>(null);

  protected readonly counts = computed(() => {
    const all = this.errors();
    const sum = (kinds: ErrorKind[]) => all.filter((e) => kinds.includes(e.kind)).reduce((n, e) => n + e.count, 0);
    return {
      total: all.reduce((n, e) => n + e.count, 0),
      js: sum(['js', 'promise']),
      network: sum(['network', 'resource']),
      console: sum(['console-error', 'console-warn']),
      byKind: Object.fromEntries(this.kinds.map(([kind]) => [kind, sum([kind])])) as Record<ErrorKind, number>,
    };
  });

  protected readonly filtered = computed(() => {
    const term = normalize(this.search());
    const kinds = this.kindFilter();
    return this.errors()
      .filter((e) => !kinds.size || kinds.has(e.kind))
      .filter((e) => !term || normalize(`${e.message} ${e.source} ${e.page}`).includes(term))
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  });

  protected toggleKind(kind: ErrorKind) {
    this.kindFilter.update((set) => {
      const next = new Set(set);
      next.has(kind) ? next.delete(kind) : next.add(kind);
      return next;
    });
  }

  protected toggle(id: string) {
    this.expanded.update((set) => {
      const next = new Set(set);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  protected when(iso: string) {
    const date = new Date(iso);
    return `${date.toLocaleDateString('pt-BR')} ${date.toLocaleTimeString('pt-BR')}`;
  }

  // Texto pronto para colar num chamado ou mandar para quem desenvolve
  protected async copy(error: BrowserError) {
    const text = [
      `[${ERROR_KINDS[error.kind].label}] ${error.message}`,
      error.source && `Origem: ${error.source}`,
      `Tela: ${error.page} · ${error.count}x · primeira ${this.when(error.firstAt)} · última ${this.when(error.lastAt)}`,
      `Navegador: ${navigator.userAgent}`,
      error.stack && `\n${error.stack}`,
    ]
      .filter(Boolean)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(error.id);
      setTimeout(() => this.copied.set(null), 1500);
    } catch {
      // sem permissão de área de transferência
    }
  }

  protected exportJson() {
    const data = { exportedAt: new Date().toISOString(), userAgent: navigator.userAgent, errors: this.filtered() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: `erros-navegador-${new Date().toISOString().slice(0, 10)}.json` }).click();
    URL.revokeObjectURL(url);
  }

  // Gera um erro de cada tipo, para conferir que a captura está funcionando
  protected simulate() {
    setTimeout(() => {
      throw new Error('Erro de teste (simulado na tela Erros do navegador)');
    });
    Promise.reject(new Error('Promise de teste rejeitada sem tratamento'));
    console.warn('Aviso de teste no console');
    fetch('/endereco-que-nao-existe-' + Date.now()).catch(() => undefined);
  }

  // ---------- Limpar ----------
  private readonly confirmDialog = viewChild.required<ElementRef<HTMLDialogElement>>('confirmDialog');

  protected askClear() {
    this.confirmDialog().nativeElement.showModal();
  }

  protected confirmClear() {
    clearBrowserErrors();
    this.expanded.set(new Set());
    this.confirmDialog().nativeElement.close();
  }

  protected cancelClear() {
    this.confirmDialog().nativeElement.close();
  }

  protected closeOnBackdrop(event: MouseEvent, dialog: HTMLDialogElement) {
    if (event.target === dialog) dialog.close();
  }
}
