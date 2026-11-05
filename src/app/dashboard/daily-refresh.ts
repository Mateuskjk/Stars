import { DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { AccountStore } from '../account/account-store';
import { api } from '../api/http';
import { Insight } from '../projects/project-metrics';
import { toDay } from '../projects/project-tasks';

// Os insights e a análise da IA dos Dashboards são "fotografias" do dia, renovadas às 10h.
// Antes das 10h ainda vale a de ontem.
export const REFRESH_HOUR = 10;

export function dailySlot(date = new Date()) {
  const d = new Date(date);
  if (d.getHours() < REFRESH_HOUR) d.setDate(d.getDate() - 1);
  return toDay(d);
}

export interface DailyAnalysis {
  text: string;
  error: boolean;
  at: string; // ISO
}

export interface DailySnapshot {
  slot: string;
  at: string; // quando os insights foram fotografados (ISO)
  insights: Insight[];
  analysis?: DailyAnalysis;
}

const MAX_SCOPES = 30;

// Análise automática das 10h, feita no servidor pelo Cron da Vercel (src/server/daily-ai.ts) para a empresa.
// Só quem vê tudo da empresa recebe (os demais: null, e seguem com o botão "Analisar com IA").
export interface ServerAnalysis {
  dia: string;
  texto: string;
  erro: boolean;
  criadoEm: string;
}

export function serverAnalysis(painel: 'setores' | 'projetos', tenantId: () => string | null) {
  const result = signal<ServerAnalysis | null>(null);
  effect(() => {
    const tenant = tenantId();
    result.set(null);
    if (!tenant) return;
    api<ServerAnalysis | null>(`/data/analise-diaria?empresa=${encodeURIComponent(tenant)}&painel=${painel}`)
      .then((a) => result.set(a && !a.erro ? a : null))
      .catch(() => result.set(null)); // sem acesso ou fora do ar: fica sem a automática
  });
  return result.asReadonly();
}

// Uma fotografia dos insights por recorte (filtros) e por pessoa, guardada neste navegador.
// ponytail: fica no localStorage (por aparelho); se precisar valer entre aparelhos, mover para a conta no banco.
export class DailyRefresh {
  private readonly email = inject(AccountStore).account;
  private readonly key = computed(() => `stars.dash.${this.name}.${this.email().email || 'local'}`);
  readonly slot = signal(dailySlot());
  private readonly store = signal<Record<string, DailySnapshot>>({});

  constructor(private readonly name: string) {
    this.store.set(this.read());
    // De minuto em minuto: às 10h vira o dia dos painéis (o signal não muda se o dia for o mesmo)
    const timer = setInterval(() => this.slot.set(dailySlot()), 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  get(scope: string): DailySnapshot | null {
    const snap = this.store()[scope];
    return snap && snap.slot === this.slot() ? snap : null;
  }

  save(scope: string, changes: Partial<DailySnapshot>) {
    const current = this.get(scope) ?? { slot: this.slot(), at: new Date().toISOString(), insights: [] };
    const next = { ...this.store(), [scope]: { ...current, ...changes, slot: this.slot() } };
    const kept = Object.entries(next)
      .sort((a, b) => b[1].at.localeCompare(a[1].at))
      .slice(0, MAX_SCOPES);
    this.store.set(Object.fromEntries(kept));
    try {
      localStorage.setItem(this.key(), JSON.stringify(this.store()));
    } catch {
      // sem espaço ou sem permissão: vale só nesta visita
    }
  }

  private read(): Record<string, DailySnapshot> {
    try {
      return JSON.parse(localStorage.getItem(this.key()) ?? '{}') ?? {};
    } catch {
      return {};
    }
  }
}

// "hoje às 10:02" / "ontem às 10:00" / "03/11 às 10:00"
export function updatedAt(iso: string, now = new Date()) {
  const d = new Date(iso);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const day = toDay(d);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const label = day === toDay(now) ? 'hoje' : day === toDay(yesterday) ? 'ontem' : `${day.slice(8, 10)}/${day.slice(5, 7)}`;
  return `${label} às ${time}`;
}
