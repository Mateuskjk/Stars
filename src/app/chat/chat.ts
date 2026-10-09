import { Component, DestroyRef, afterNextRender, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { RecentsStore } from '../home/recents-store';
import { USERS } from './users';

interface Message {
  fromMe: boolean;
  text: string;
  time: Date;
}

export { USERS } from './users';

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

const INITIAL: Record<number, Message[]> = {
  1: [
    { fromMe: false, text: 'Oi! Conseguiu ver o planning da semana?', time: minutesAgo(45) },
    { fromMe: true, text: 'Vi sim, só tenho dúvida na prioridade do CRM.', time: minutesAgo(40) },
    { fromMe: false, text: 'Fechou, vamos alinhar na daily amanhã.', time: minutesAgo(12) },
  ],
  2: [
    { fromMe: true, text: 'O deploy de hoje já foi?', time: minutesAgo(180) },
    { fromMe: false, text: 'Foi sim, tudo certo em produção 🚀', time: minutesAgo(170) },
  ],
  3: [
    { fromMe: false, text: 'Subi as telas novas do portal no Figma.', time: minutesAgo(60 * 26) },
  ],
  5: [
    { fromMe: false, text: 'Achei um bug no fluxo de login, abri um card.', time: minutesAgo(60 * 50) },
    { fromMe: true, text: 'Valeu, vou olhar agora.', time: minutesAgo(60 * 49) },
  ],
};

export function initials(name: string) {
  return name
    .split(' ')
    .map((word) => word[0])
    .slice(0, 2)
    .join('');
}

// Hoje: "14:32"; outros dias: "05/10"
export function formatTime(date: Date, now = new Date()) {
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

// Busca sem diferenciar maiúsculas nem acentos ("joao" encontra "João")
const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

@Component({
  selector: 'app-chat',
  templateUrl: './chat.html',
  host: {
    class: 'chat',
    '[class.has-active]': 'activeId() !== null',
  },
})
export class Chat {
  protected readonly users = USERS;
  protected readonly initials = initials;
  protected readonly formatTime = formatTime;

  protected readonly messages = signal<Record<number, Message[]>>(INITIAL);
  protected readonly activeId = signal<number | null>(null);
  protected readonly search = signal('');
  protected readonly pickingUser = signal(false);
  protected readonly draft = signal('');

  // Contatos com conversa, a mais recente primeiro, filtrados pela busca
  protected readonly contacts = computed(() => {
    const term = normalize(this.search());
    return USERS.filter((user) => this.messages()[user.id]?.length)
      .map((user) => ({ user, last: this.messages()[user.id].at(-1)! }))
      .filter(({ user }) => normalize(user.name).includes(term))
      .sort((a, b) => b.last.time.getTime() - a.last.time.getTime());
  });

  protected readonly activeUser = computed(() => USERS.find((user) => user.id === this.activeId()) ?? null);

  // Invertidas: com column-reverse, a conversa já abre rolada até a última mensagem
  protected readonly activeMessages = computed(() => {
    const id = this.activeId();
    return id === null ? [] : [...(this.messages()[id] ?? [])].reverse();
  });

  private readonly recents = inject(RecentsStore);

  constructor() {
    // Vindo dos Recentes: /conversas?com=ID abre a conversa com a pessoa
    const route = inject(ActivatedRoute);
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      route.queryParamMap.pipe(takeUntilDestroyed(destroyRef)).subscribe((params) => {
        const id = Number(params.get('com'));
        if (USERS.some((user) => user.id === id)) this.open(id);
      });
    });
  }

  protected open(userId: number) {
    this.recents.visit('chat', userId);
    this.activeId.set(userId);
    this.pickingUser.set(false);
    this.draft.set('');
  }

  protected send(event: Event) {
    event.preventDefault();
    const text = this.draft().trim();
    const id = this.activeId();
    if (!text || id === null) return;

    this.messages.update((all) => ({
      ...all,
      [id]: [...(all[id] ?? []), { fromMe: true, text, time: new Date() }],
    }));
    this.draft.set('');
  }
}
