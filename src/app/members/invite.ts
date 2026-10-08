import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MAX_ATTEMPTS, MembersStore, ValidationResult } from './members-store';

const MESSAGES: Record<Exclude<ValidationResult, 'ok'>, string> = {
  'not-found': 'Não encontramos um convite pendente para esse e-mail.',
  expired: 'Esse código expirou (vale 24h). Peça para reenviarem o convite.',
  blocked: `Muitas tentativas erradas (${MAX_ATTEMPTS}). Peça para reenviarem o convite com um código novo.`,
  'wrong-code': 'Código incorreto. Confira o e-mail e tente de novo.',
};

// Tela onde a pessoa convidada valida o código de 6 dígitos que recebeu por e-mail
@Component({
  imports: [RouterLink],
  selector: 'app-invite',
  templateUrl: './invite.html',
  host: { class: 'invite' },
})
export class Invite {
  private readonly store = inject(MembersStore);
  protected readonly email = inject(ActivatedRoute).snapshot.queryParamMap.get('email') ?? '';
  protected readonly error = signal('');
  protected readonly welcome = signal<string | null>(null);

  protected submit(event: Event) {
    event.preventDefault();
    const data = new FormData(event.target as HTMLFormElement);
    const email = String(data.get('email') ?? '');
    const code = String(data.get('code') ?? '').replace(/\D/g, '');
    if (code.length !== 6) {
      this.error.set('O código tem 6 números.');
      return;
    }
    const result = this.store.validate(email, code);
    if (result === 'ok') {
      this.error.set('');
      this.welcome.set(this.store.findByEmail(email)!.name.split(' ')[0]);
    } else {
      this.error.set(MESSAGES[result]);
    }
  }

  // Aceita só números no campo do código (também ao colar)
  protected onlyDigits(input: HTMLInputElement) {
    input.value = input.value.replace(/\D/g, '').slice(0, 6);
  }
}
