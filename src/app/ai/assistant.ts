import { Component, ElementRef, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AiStore, ChatTurn, PROVIDERS } from './ai-store';

// Nome amigável da tela atual, enviado junto com a pergunta para a IA dar dicas no contexto certo
const PAGES: [RegExp, string][] = [
  [/^\/$/, 'Home'],
  [/^\/dashboards/, 'Dashboards'],
  [/^\/conversas/, 'Conversas'],
  [/^\/projetos\/novo/, 'Criar novo projeto (tabela de projetos)'],
  [/^\/projetos\/visaoGeral/, 'Projetos > Geral (carrossel e kanban)'],
  [/^\/workspace\/daily/, 'Daily'],
  [/^\/workspace\/backlog/, 'Backlog'],
  [/^\/workspace\/planning/, 'Planning'],
  [/^\/workspace\/notes/, 'Notas'],
  [/^\/workspace\/brain/, 'Brain (grafo das notas)'],
  [/^\/workspace\/favorites/, 'Favoritos'],
  [/^\/configuracoes\/([\w-]+)/, 'Configurações'],
];

const SUGGESTIONS = ['Como funciona esta tela?', 'Me dá uma dica para usar melhor esta tela', 'Estou fazendo algo errado aqui?'];

@Component({
  imports: [RouterLink],
  selector: 'app-assistant',
  templateUrl: './assistant.html',
  host: { class: 'assistant' },
})
export class Assistant {
  protected readonly store = inject(AiStore);
  private readonly router = inject(Router);
  protected readonly suggestions = SUGGESTIONS;

  protected readonly open = signal(false);
  protected readonly messages = signal<ChatTurn[]>([]);
  protected readonly thinking = signal(false);
  protected readonly error = signal('');
  private readonly input = viewChild<ElementRef<HTMLTextAreaElement>>('input');

  constructor() {
    afterNextRender(() => this.store.load());
  }

  protected vendorLabel() {
    const assistant = this.store.assistant();
    return assistant ? PROVIDERS.find((p) => p.id === assistant.provider)!.label : '';
  }

  protected toggle() {
    this.open.update((open) => !open);
    if (this.open()) requestAnimationFrame(() => this.input()?.nativeElement.focus());
  }

  private currentPage() {
    const url = this.router.url.split('?')[0];
    const match = PAGES.find(([pattern]) => pattern.test(url));
    return match ? `${match[1]} (${url})` : url;
  }

  protected async send(text: string) {
    const content = text.trim();
    if (!content || this.thinking()) return;
    const history = [...this.messages(), { role: 'user' as const, content }];
    this.messages.set(history);
    this.error.set('');
    this.thinking.set(true);
    const textarea = this.input()?.nativeElement;
    if (textarea) textarea.value = '';
    try {
      const reply = await this.store.chat(history, this.currentPage());
      this.messages.update((list) => [...list, { role: 'assistant', content: reply || '(a IA não respondeu nada)' }]);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Não foi possível falar com a IA.');
    } finally {
      this.thinking.set(false);
    }
  }

  // Enter envia; Shift+Enter quebra a linha
  protected onKeydown(event: KeyboardEvent, textarea: HTMLTextAreaElement) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send(textarea.value);
    }
  }

  protected clear() {
    this.messages.set([]);
    this.error.set('');
  }
}
