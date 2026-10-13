import { Component, DestroyRef, afterNextRender, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { RecentsStore } from '../home/recents-store';
import { MembersStore } from '../members/members-store';
import { PeopleStore } from '../members/people-store';
import { CompanyStore } from '../companies/company-store';
import { ApiSync } from '../api/api-sync';
import { api } from '../api/http';

interface Message {
  id?: string;
  fromMe: boolean;
  text: string;
  time: Date;
  author?: string; // nos canais, quem escreveu
}

// Uma conversa: direta com uma pessoa ("p:<id>") ou um canal da empresa ("c:<id do banco>")
interface Conversation {
  key: string;
  title: string;
  subtitle: string;
  channel: boolean;
  personId?: number;
  canalId?: string;
}

// Resposta da API (/api/chat/conversas)
interface DbConversa {
  id: string;
  tipo: string;
  nome: string;
  descricao: string;
  tenantId: string;
  ultima: { texto: string; em: string; minha: boolean } | null;
  outro: { nome: string; email: string | null } | null;
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

// Exemplos (sem login e nos testes); com login, as conversas vêm do banco
const INITIAL: Record<string, Message[]> = {
  'p:1': [
    { fromMe: false, text: 'Oi! Conseguiu ver o planning da semana?', time: minutesAgo(45) },
    { fromMe: true, text: 'Vi sim, só tenho dúvida na prioridade do CRM.', time: minutesAgo(40) },
    { fromMe: false, text: 'Fechou, vamos alinhar na daily amanhã.', time: minutesAgo(12) },
  ],
  'p:2': [
    { fromMe: true, text: 'O deploy de hoje já foi?', time: minutesAgo(180) },
    { fromMe: false, text: 'Foi sim, tudo certo em produção 🚀', time: minutesAgo(170) },
  ],
  'p:3': [{ fromMe: false, text: 'Subi as telas novas do portal no Figma.', time: minutesAgo(60 * 26) }],
  'p:5': [
    { fromMe: false, text: 'Achei um bug no fluxo de login, abri um card.', time: minutesAgo(60 * 50) },
    { fromMe: true, text: 'Valeu, vou olhar agora.', time: minutesAgo(60 * 49) },
  ],
};

const ACTIVE_POLL_MS = 5000; // conversa aberta
const LIST_POLL_MS = 20000; // lista de conversas

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
    '[class.has-active]': 'activeKey() !== null',
  },
})
export class Chat {
  // Pessoas reais da empresa escolhida (menos você)
  protected readonly users = inject(PeopleStore).others;
  private readonly members = inject(MembersStore);
  private readonly companies = inject(CompanyStore);
  private readonly sync = inject(ApiSync);
  protected readonly initials = initials;
  protected readonly formatTime = formatTime;

  // Com login, tudo vai para o banco; sem login (exemplos e testes), fica só na memória
  private readonly remote = !!this.members.sessionEmail();

  protected readonly messages = signal<Record<string, Message[]>>(this.remote ? {} : INITIAL);
  protected readonly activeKey = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly pickingUser = signal(false);
  protected readonly draft = signal('');
  protected readonly error = signal('');

  // Conversas do banco (da empresa escolhida)
  private readonly dbConversas = signal<DbConversa[]>([]);

  private readonly tenantId = computed(() => this.sync.ids.empresa.db(this.companies.currentId()));

  protected readonly conversations = computed<Conversation[]>(() => {
    const people: Conversation[] = this.users().map((u) => ({ key: `p:${u.id}`, title: u.name, subtitle: u.role, channel: false, personId: u.id }));
    if (!this.remote) return people;
    const tenant = this.tenantId();
    const conversas = this.dbConversas().filter((c) => !tenant || c.tenantId === tenant);
    const channels = conversas
      .filter((c) => c.tipo !== 'DIRETO')
      .map((c) => ({ key: `c:${c.id}`, title: `# ${c.nome}`, subtitle: c.descricao || 'Canal da empresa', channel: true, canalId: c.id }));
    // Diretas: liga o canal à pessoa pelo e-mail
    for (const c of conversas.filter((c) => c.tipo === 'DIRETO' && c.outro?.email)) {
      const person = this.members.findByEmail(c.outro!.email!);
      const conv = person && people.find((p) => p.personId === person.id);
      if (conv) conv.canalId = c.id;
    }
    return [...channels, ...people];
  });

  // Última mensagem de cada conversa (do banco, ou da conversa já aberta)
  private lastOf(conv: Conversation): Message | null {
    const loaded = this.messages()[conv.key];
    if (loaded?.length) return loaded.at(-1)!;
    const db = conv.canalId ? this.dbConversas().find((c) => c.id === conv.canalId)?.ultima : null;
    return db ? { fromMe: db.minha, text: db.texto, time: new Date(db.em) } : null;
  }

  // Conversas na lista: canais sempre; com pessoas, só as que têm mensagem. Mais recente primeiro.
  protected readonly contacts = computed(() => {
    const term = normalize(this.search());
    return this.conversations()
      .map((conv) => ({ conv, last: this.lastOf(conv) }))
      .filter(({ conv, last }) => (conv.channel || last) && normalize(conv.title).includes(term))
      .sort((a, b) => (b.last?.time.getTime() ?? 0) - (a.last?.time.getTime() ?? 0));
  });

  protected readonly active = computed(() => this.conversations().find((c) => c.key === this.activeKey()) ?? null);

  // Invertidas: com column-reverse, a conversa já abre rolada até a última mensagem
  protected readonly activeMessages = computed(() => {
    const key = this.activeKey();
    return key === null ? [] : [...(this.messages()[key] ?? [])].reverse();
  });

  private readonly recents = inject(RecentsStore);

  constructor() {
    // Vindo dos Recentes: /conversas?com=ID abre a conversa com a pessoa
    const route = inject(ActivatedRoute);
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      route.queryParamMap.pipe(takeUntilDestroyed(destroyRef)).subscribe((params) => {
        const id = Number(params.get('com'));
        if (this.users().some((user) => user.id === id)) void this.open(`p:${id}`);
      });
      if (!this.remote) return;
      void this.loadConversas();
      // ponytail: atualização por consulta periódica (o banco não tem tempo real ligado nessas tabelas)
      const visible = () => document.visibilityState === 'visible';
      const list = setInterval(() => visible() && void this.loadConversas(), LIST_POLL_MS);
      const active = setInterval(() => visible() && void this.loadMessages(), ACTIVE_POLL_MS);
      destroyRef.onDestroy(() => {
        clearInterval(list);
        clearInterval(active);
      });
    });
  }

  private async loadConversas() {
    try {
      this.dbConversas.set(await api<DbConversa[]>('/chat/conversas'));
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  private async loadMessages(key = this.activeKey()) {
    const canalId = key && this.conversations().find((c) => c.key === key)?.canalId;
    if (!canalId) return;
    try {
      const rows = await api<{ id: string; texto: string; em: string; autor: string | null; minha: boolean }[]>(`/chat/conversas/${canalId}/mensagens`);
      const list = rows.map((m) => ({ id: m.id, fromMe: m.minha, text: m.texto, time: new Date(m.em), author: m.autor ?? undefined }));
      this.messages.update((all) => ({ ...all, [key!]: list }));
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  protected async open(key: string) {
    const conv = this.conversations().find((c) => c.key === key);
    if (conv?.personId) this.recents.visit('chat', conv.personId);
    this.activeKey.set(key);
    this.pickingUser.set(false);
    this.draft.set('');
    this.error.set('');
    if (this.remote) await this.loadMessages(key);
  }

  // Conversa direta ainda sem canal no banco: cria na primeira mensagem
  private async ensureCanal(conv: Conversation) {
    if (conv.canalId) return conv.canalId;
    const person = this.members.members().find((m) => m.id === conv.personId);
    const { id } = await api<{ id: string }>('/chat/diretas', { method: 'POST', body: JSON.stringify({ tenantId: this.tenantId(), email: person?.email }) });
    await this.loadConversas();
    return id;
  }

  protected async send(event: Event) {
    event.preventDefault();
    const text = this.draft().trim();
    const key = this.activeKey();
    const conv = this.active();
    if (!text || key === null || !conv) return;

    // Aparece na hora; com login, vai para o banco (se falhar, volta para o campo de texto)
    const optimistic: Message = { fromMe: true, text, time: new Date() };
    this.messages.update((all) => ({ ...all, [key]: [...(all[key] ?? []), optimistic] }));
    this.draft.set('');
    if (!this.remote) return;
    try {
      const canalId = await this.ensureCanal(conv);
      await api(`/chat/conversas/${canalId}/mensagens`, { method: 'POST', body: JSON.stringify({ texto: text }) });
      await this.loadMessages(key);
      this.error.set('');
    } catch (e) {
      this.messages.update((all) => ({ ...all, [key]: (all[key] ?? []).filter((m) => m !== optimistic) }));
      this.draft.set(text);
      this.error.set((e as Error).message);
    }
  }
}
