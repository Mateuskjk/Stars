import { Component, inject, signal } from '@angular/core';
import { SessionStore } from '../api/session';

// Tela de entrada: e-mail e senha do sistema atual (tabela de usuários do banco)
@Component({
  selector: 'app-login',
  templateUrl: './login.html',
})
export class Login {
  protected readonly session = inject(SessionStore);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected async submit(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    this.busy.set(true);
    this.error.set('');
    try {
      await this.session.login(String(data.get('email')), String(data.get('senha')));
      if (this.session.status() !== 'in') this.error.set(this.session.error() || 'Não foi possível entrar.');
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
