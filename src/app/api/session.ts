import { Injectable, inject, signal } from '@angular/core';
import { ApiError, api } from './http';
import { ApiSync, Me } from './api-sync';

// Sessão do app: sem login, nenhuma tela de dados aparece (o servidor também recusa as rotas com 401)
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly sync = inject(ApiSync);
  readonly status = signal<'checking' | 'out' | 'in'>('checking');
  readonly me = signal<Me | null>(null);
  readonly error = signal('');

  // Já tem sessão (cookie)? Então carrega os dados do banco
  async check() {
    try {
      const me = await api<Me>('/auth/me');
      await this.sync.load(me);
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

  // Sai e recarrega a página, para não sobrar nenhum dado da sessão na memória
  async logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    location.assign('/');
  }
}
