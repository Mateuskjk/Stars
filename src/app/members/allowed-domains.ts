import { Component, afterNextRender, inject, signal } from '@angular/core';
import { api } from '../api/http';
import { MembersStore } from './members-store';

// Configurações › Membros: domínios de e-mail com acesso ao LexÁgile (o servidor confere no login e nos convites).
// Fica num menu que abre e fecha (como os grupos de membros); começa fechado.
@Component({
  selector: 'app-allowed-domains',
  template: `
    <section class="domains" [class.is-open]="open()" aria-labelledby="domains-title">
      <h3 id="domains-title">
        <button class="domains__head" type="button" [attr.aria-expanded]="open()" (click)="open.set(!open())">
          <svg class="domains__chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
          <span class="domains__title">Domínios permitidos</span>
          <span class="domains__count">{{ loading() ? '…' : domains().length }}</span>
        </button>
      </h3>
      @if (open()) {
        <p class="backlog__subtitle">Só entra quem já está cadastrado e tem e-mail de um destes domínios.</p>
        <ul class="domains__list">
          @for (d of domains(); track d) {
            <li class="domains__chip">
              &#64;{{ d }}
              @if (isAdmin()) {
                <button type="button" class="domains__remove" [attr.aria-label]="'Remover ' + d" [disabled]="busy()" (click)="remove(d)">✕</button>
              }
            </li>
          } @empty {
            <li class="backlog__subtitle">{{ loading() ? 'Carregando…' : 'Nenhum domínio.' }}</li>
          }
        </ul>
        @if (isAdmin()) {
          <form class="domains__form" (submit)="add($event)">
            <input class="modal__input" name="dominio" placeholder="empresa.com.br" aria-label="Novo domínio" required maxlength="120" />
            <button class="backlog__new" type="submit" [disabled]="busy()">+ Adicionar domínio</button>
          </form>
        }
      }
      @if (error()) {
        <p class="planning__error" role="alert">{{ error() }}</p>
      }
    </section>
  `,
})
export class AllowedDomains {
  protected readonly isAdmin = inject(MembersStore).isAdmin;
  protected readonly domains = signal<string[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly open = signal(false);

  constructor() {
    afterNextRender(() =>
      api<string[]>('/data/dominios')
        .then((list) => this.domains.set(list))
        .catch((e) => this.error.set((e as Error).message))
        .finally(() => this.loading.set(false)),
    );
  }

  private async run(request: () => Promise<string[]>) {
    this.busy.set(true);
    this.error.set('');
    try {
      this.domains.set(await request());
      return true;
    } catch (e) {
      this.error.set((e as Error).message);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected async add(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const dominio = String(new FormData(form).get('dominio') ?? '');
    if (await this.run(() => api<string[]>('/data/dominios', { method: 'POST', body: JSON.stringify({ dominio }) }))) form.reset();
  }

  protected remove(dominio: string) {
    void this.run(() => api<string[]>(`/data/dominios/${encodeURIComponent(dominio)}`, { method: 'DELETE' }));
  }
}
