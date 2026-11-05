import { Component, inject, signal } from '@angular/core';
import { api } from '../api/http';
import { SessionStore } from '../api/session';

// Tela /convite (aberta sem login): a pessoa convidada informa o e-mail, o código de 6 números que recebeu
// e cria a senha. O servidor confere o código, ativa a conta e já abre a sessão.
@Component({
  selector: 'app-invite',
  templateUrl: './invite.html',
  host: { class: 'invite' },
})
export class Invite {
  private readonly session = inject(SessionStore);
  protected readonly email = typeof location === 'undefined' ? '' : (new URLSearchParams(location.search).get('email') ?? '');
  protected readonly error = signal('');
  protected readonly sending = signal(false);
  protected readonly welcome = signal<string | null>(null);

  protected async submit(event: Event) {
    event.preventDefault();
    const data = new FormData(event.target as HTMLFormElement);
    const email = String(data.get('email') ?? '').trim();
    const codigo = String(data.get('code') ?? '').replace(/\D/g, '');
    const senha = String(data.get('password') ?? '');
    if (codigo.length !== 6) return void this.error.set('O código tem 6 números.');
    if (senha.length < 8) return void this.error.set('A senha precisa ter pelo menos 8 caracteres.');
    if (senha !== String(data.get('confirm') ?? '')) return void this.error.set('As senhas não conferem.');
    this.error.set('');
    this.sending.set(true);
    try {
      const r = await api<{ nome: string }>('/auth/convite', { method: 'POST', body: JSON.stringify({ email, codigo, senha }) });
      this.welcome.set(r.nome.split(' ')[0]);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.sending.set(false);
    }
  }

  // Sessão já aberta pelo servidor: carrega os dados e vai para o início
  protected async enter() {
    history.replaceState(null, '', '/');
    await this.session.check();
  }

  // Aceita só números no campo do código (também ao colar)
  protected onlyDigits(input: HTMLInputElement) {
    input.value = input.value.replace(/\D/g, '').slice(0, 6);
  }
}
