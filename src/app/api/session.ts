import { Injectable, Injector, inject, signal } from '@angular/core';
import { ApiError, api } from './http';
import type { ApiSync, Me } from './api-sync';

// Sessão do app: sem login, nenhuma tela de dados aparece (o servidor também recusa as rotas com 401)
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly injector = inject(Injector);
  readonly status = signal<'checking' | 'out' | 'in'>('checking');
  readonly me = signal<Me | null>(null);
  readonly error = signal('');
  // Erro da última gravação no banco (aparece numa faixa no app)
  readonly saveError = signal('');

  // O tradutor do banco (e os stores que ele preenche) só carrega depois do login
  private async sync(): Promise<ApiSync> {
    const { ApiSync } = await import('./api-sync');
    return this.injector.get(ApiSync);
  }

  // Já tem sessão (cookie)? Então carrega os dados do banco
  async check() {
    try {
      const me = await api<Me>('/auth/me');
      await (await this.sync()).load(me);
      this.me.set(me);
      this.error.set('');
      this.status.set('in');
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) this.error.set('Não foi possível carregar os dados do banco. Tente de novo.');
      this.status.set('out');
    }
  }

  // Erros do login (senha errada, muitas tentativas) sobem para a tela
  async login(email: string, senha: string) {
    await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, senha }) });
    await this.check();
  }

  async selectCompany(id: number) {
    (await this.sync()).selectCompany(id);
  }

  // Sai e recarrega a página, para não sobrar nenhum dado da sessão na memória nem no navegador
  // (computador compartilhado): apaga o que o app guardou, menos o tema
  async logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    try {
      for (const key of Object.keys(localStorage)) if (key.startsWith('stars.') && key !== 'stars.theme') localStorage.removeItem(key);
    } catch {
      // armazenamento bloqueado: nada a apagar
    }
    location.assign('/');
  }
}
