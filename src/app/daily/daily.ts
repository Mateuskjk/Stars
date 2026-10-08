import { Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { USERS, formatTime, initials } from '../chat/chat';
import { formatWeekDate } from '../home/home';
import { DailyHistory, DailyRecord } from './daily-history';

interface Notes {
  yesterday: string;
  today: string;
  blockers: string;
  saved: boolean;
}

export type NoteField = 'yesterday' | 'today' | 'blockers';

interface Movement {
  user: string;
  card: string;
  project: string;
  from: string | null; // null = cartão criado
  to: string;
  time: Date;
}

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);

// ponytail: movimentações fixas de exemplo (desde a daily de ontem); trocar pelo histórico real dos cartões quando o backend existir
const MOVEMENTS: Movement[] = [
  { user: 'Ana Souza', card: 'Revisar backlog da sprint', project: 'Onboarding', from: 'A fazer', to: 'Em andamento', time: hoursAgo(2) },
  { user: 'Carlos Lima', card: 'Login com biometria', project: 'App mobile', from: 'Em andamento', to: 'Revisão', time: hoursAgo(3) },
  { user: 'Carlos Lima', card: 'Modo offline', project: 'App mobile', from: 'Em andamento', to: 'Pausado', time: hoursAgo(18) },
  { user: 'Bruna Alves', card: 'Nova home com carrossel', project: 'Redesign do site', from: 'Revisão', to: 'Concluído', time: hoursAgo(5) },
  { user: 'Bruna Alves', card: 'Peças para redes sociais', project: 'Campanha Q4', from: null, to: 'A fazer', time: hoursAgo(20) },
  { user: 'Diego Rocha', card: 'Integração de pagamento', project: 'Portal do cliente', from: 'A fazer', to: 'Em andamento', time: hoursAgo(6) },
  { user: 'Eva Martins', card: 'Testes end-to-end', project: 'Portal do cliente', from: 'Em andamento', to: 'Bloqueado', time: hoursAgo(4) },
  { user: 'Felipe Costa', card: 'Migração do banco', project: 'Data Lake', from: 'Em andamento', to: 'Revisão', time: hoursAgo(1) },
  { user: 'Gabriela Nunes', card: 'Relatório de funil', project: 'CRM interno', from: 'Revisão', to: 'Concluído', time: hoursAgo(22) },
].sort((a, b) => b.time.getTime() - a.time.getTime());

const EMPTY: Notes = { yesterday: '', today: '', blockers: '', saved: false };

@Component({
  selector: 'app-daily',
  templateUrl: './daily.html',
  host: { class: 'daily' },
})
export class Daily {
  protected readonly users = USERS;
  protected readonly initials = initials;
  protected readonly formatTime = formatTime;
  protected readonly weekDate = formatWeekDate(new Date());
  protected readonly history = inject(DailyHistory);

  // Resumo em exibição: o da daily que acabou de ser finalizada ou um aberto do histórico
  protected readonly viewing = signal<DailyRecord | null>(null);
  protected readonly fromHistory = signal(false);

  constructor() {
    afterNextRender(() => this.history.load());
  }

  protected readonly step = signal<'start' | 'meeting' | 'summary'>('start');
  protected readonly selected = signal(USERS[0].name);
  protected readonly notes = signal<Record<string, Notes>>({});

  protected readonly fields: { id: NoteField; label: string; placeholder: string }[] = [
    { id: 'yesterday', label: 'O que fiz desde a última daily', placeholder: 'Ex.: terminei a tela de login…' },
    { id: 'today', label: 'O que vou fazer hoje', placeholder: 'Ex.: começar a integração de pagamento…' },
    { id: 'blockers', label: 'Impedimentos', placeholder: 'Algo travando o trabalho? Deixe em branco se não houver.' },
  ];

  // Movimentações da pessoa selecionada
  protected readonly movements = computed(() => MOVEMENTS.filter((m) => m.user === this.selected()));
  protected readonly current = computed(() => this.notes()[this.selected()] ?? EMPTY);

  protected withNotes(record: DailyRecord) {
    return record.participants.filter((p) => p.notes).length;
  }

  // "Quinta-feira, 8 de outubro · 09:42"
  protected recordDate(record: DailyRecord) {
    const date = new Date(record.date);
    return `${formatWeekDate(date)} · ${formatTime(date, date)}`;
  }

  protected isSaved(name: string) {
    return !!this.notes()[name]?.saved;
  }

  // Cada pessoa tem o seu rascunho: trocar de avatar não apaga o que foi digitado
  protected edit(field: NoteField, value: string) {
    const name = this.selected();
    this.notes.update((all) => ({ ...all, [name]: { ...(all[name] ?? EMPTY), [field]: value, saved: false } }));
  }

  protected save(event: Event) {
    event.preventDefault();
    const name = this.selected();
    this.notes.update((all) => ({ ...all, [name]: { ...(all[name] ?? EMPTY), saved: true } }));
  }

  protected finish() {
    const notes = this.notes();
    const record: DailyRecord = {
      id: Date.now(),
      date: new Date().toISOString(),
      participants: USERS.map((user) => {
        const saved = notes[user.name]?.saved ? notes[user.name] : null;
        return {
          name: user.name,
          moves: MOVEMENTS.filter((m) => m.user === user.name).length,
          notes: saved && { yesterday: saved.yesterday, today: saved.today, blockers: saved.blockers },
        };
      }),
    };
    this.history.add(record);
    this.open(record, false);
  }

  // Excluir não tem volta, então pede confirmação
  protected remove(record: DailyRecord) {
    if (confirm(`Excluir a daily de ${this.recordDate(record)}? Essa ação não pode ser desfeita.`)) {
      this.history.remove(record.id);
    }
  }

  protected open(record: DailyRecord, fromHistory = true) {
    this.viewing.set(record);
    this.fromHistory.set(fromHistory);
    this.step.set('summary');
  }

  protected restart() {
    this.notes.set({});
    this.selected.set(USERS[0].name);
    this.viewing.set(null);
    this.step.set('start');
  }
}
