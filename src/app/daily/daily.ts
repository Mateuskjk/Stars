import { Component, ElementRef, afterNextRender, computed, inject, linkedSignal, signal, viewChild } from '@angular/core';
import { formatTime, initials } from '../format';
import { api } from '../api/http';
import { MembersStore } from '../members/members-store';
import { PeopleStore } from '../members/people-store';
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

// Status do banco → texto da tela ("EM_REVISAO" → "Em revisão")
const STATUS_LABELS: Record<string, string> = {
  RASCUNHO: 'Rascunho',
  PRONTO: 'Pronto',
  PRONTO_PARA_SPRINT: 'Pronto para a sprint',
  A_FAZER: 'A fazer',
  EM_ANDAMENTO: 'Em andamento',
  EM_EXECUCAO: 'Em execução',
  EM_REVISAO: 'Em revisão',
  CONCLUIDO: 'Concluído',
};
export function statusLabel(code: string | null) {
  if (!code) return null;
  return STATUS_LABELS[code] ?? code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, ' ');
}

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);

// Exemplos (sem login e nos testes); com login, vem o histórico real dos cartões do banco
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
  // Participantes: membros reais ativos da empresa escolhida
  protected readonly users = inject(PeopleStore).team;
  private readonly members = inject(MembersStore);
  protected readonly initials = initials;
  protected readonly formatTime = formatTime;
  protected readonly weekDate = formatWeekDate(new Date());
  protected readonly history = inject(DailyHistory);

  // Resumo em exibição: o da daily que acabou de ser finalizada ou um aberto do histórico
  protected readonly viewing = signal<DailyRecord | null>(null);
  protected readonly fromHistory = signal(false);

  // Movimentações desde a última daily (ou das últimas 24h): histórico real dos cartões, do banco
  protected readonly allMovements = signal<Movement[]>(this.members.sessionEmail() ? [] : MOVEMENTS);

  constructor() {
    afterNextRender(async () => {
      await this.history.load(); // as movimentações contam a partir da última daily
      if (this.members.sessionEmail()) void this.loadMovements();
    });
  }

  private async loadMovements() {
    const last = this.history.records()[0]?.date;
    const desde = last ? new Date(last) : new Date(Date.now() - 86_400_000);
    try {
      const rows = await api<{ de: string; para: string; em: string; titulo: string; responsavelId: string | null; projeto: string | null }[]>(
        `/data/movimentos?desde=${encodeURIComponent(desde.toISOString())}`,
      );
      const names = await this.responsibleNames(rows.map((r) => r.responsavelId));
      this.allMovements.set(
        rows
          .filter((r) => r.responsavelId && names.get(r.responsavelId))
          .map((r) => ({
            user: names.get(r.responsavelId!)!,
            card: r.titulo,
            project: r.projeto ?? 'Atividade geral',
            from: statusLabel(r.de),
            to: statusLabel(r.para) ?? r.para,
            time: new Date(r.em),
          })),
      );
    } catch {
      this.allMovements.set([]);
    }
  }

  // Usuário do banco (um por empresa) → nome da pessoa
  private async responsibleNames(ids: (string | null)[]) {
    const usuarios = await api<{ id: string; nome: string }[]>('/data/usuarios').catch(() => []);
    const wanted = new Set(ids.filter(Boolean));
    return new Map(usuarios.filter((u) => wanted.has(u.id)).map((u) => [u.id, u.nome]));
  }

  protected readonly step = signal<'start' | 'meeting' | 'summary'>('start');
  // Quem está falando agora: começa na primeira pessoa e acompanha a lista se ela mudar
  protected readonly selected = linkedSignal(() => this.users()[0]?.name ?? '');
  protected readonly notes = signal<Record<string, Notes>>({});

  protected readonly fields: { id: NoteField; label: string; placeholder: string }[] = [
    { id: 'yesterday', label: 'O que fiz desde a última daily', placeholder: 'Ex.: terminei a tela de login…' },
    { id: 'today', label: 'O que vou fazer hoje', placeholder: 'Ex.: começar a integração de pagamento…' },
    { id: 'blockers', label: 'Impedimentos', placeholder: 'Algo travando o trabalho? Deixe em branco se não houver.' },
  ];

  // Movimentações da pessoa selecionada
  protected readonly movements = computed(() => this.allMovements().filter((m) => m.user === this.selected()));
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
      participants: this.users().map((user) => {
        // Vale o que foi digitado, mesmo sem clicar em salvar
        const n = notes[user.name];
        const saved = n && (n.saved || n.yesterday.trim() || n.today.trim() || n.blockers.trim()) ? n : null;
        return {
          name: user.name,
          moves: this.allMovements().filter((m) => m.user === user.name).length,
          notes: saved && { yesterday: saved.yesterday, today: saved.today, blockers: saved.blockers },
        };
      }),
    };
    void this.history.add(record);
    this.open(record, false);
  }

  // Excluir não tem volta, então pede confirmação numa janela no estilo do site (<dialog> nativo:
  // fundo escurecido, foco preso na janela e Esc para cancelar já vêm do navegador)
  private readonly confirmDialog = viewChild.required<ElementRef<HTMLDialogElement>>('confirmDialog');
  // Não é limpo ao fechar: o evento "close" chega depois e apagaria o registro de uma janela já reaberta
  protected readonly pendingDelete = signal<DailyRecord | null>(null);

  protected remove(record: DailyRecord) {
    this.pendingDelete.set(record);
    this.confirmDialog().nativeElement.showModal();
  }

  protected confirmDelete() {
    const record = this.pendingDelete();
    if (record) void this.history.remove(record.id);
    this.confirmDialog().nativeElement.close();
  }

  protected cancelDelete() {
    this.confirmDialog().nativeElement.close();
  }

  // Clique no fundo escurecido (fora da caixa) também cancela
  protected onDialogClick(event: MouseEvent) {
    if (event.target === this.confirmDialog().nativeElement) this.cancelDelete();
  }

  protected open(record: DailyRecord, fromHistory = true) {
    this.viewing.set(record);
    this.fromHistory.set(fromHistory);
    this.step.set('summary');
  }

  protected restart() {
    this.notes.set({});
    this.selected.set(this.users()[0]?.name ?? '');
    this.viewing.set(null);
    this.step.set('start');
  }
}
