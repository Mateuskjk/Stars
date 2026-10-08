import { Injectable, signal } from '@angular/core';

export interface DailyParticipant {
  name: string;
  moves: number;
  notes: { yesterday: string; today: string; blockers: string } | null;
}

export interface DailyRecord {
  id: number;
  date: string; // ISO
  participants: DailyParticipant[];
}

const KEY = 'stars.daily-history';

// Histórico das dailies finalizadas.
// ponytail: guardado no localStorage (só neste navegador); para compartilhar com o time,
// trocar read/write por chamadas à API — o resto do app usa só records/load/add.
@Injectable({ providedIn: 'root' })
export class DailyHistory {
  readonly records = signal<DailyRecord[]>([]);

  // Chamado no navegador depois da primeira renderização (no SSR não existe localStorage)
  load() {
    this.records.set(read());
  }

  add(record: DailyRecord) {
    this.records.update((list) => [record, ...list]);
    write(this.records());
  }

  remove(id: number) {
    this.records.update((list) => list.filter((record) => record.id !== id));
    write(this.records());
  }
}

function read(): DailyRecord[] {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return []; // armazenamento bloqueado ou dado corrompido: começa vazio
  }
}

function write(records: DailyRecord[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(records));
  } catch {
    // armazenamento cheio ou bloqueado (ex.: janela anônima): o histórico fica só nesta sessão
  }
}
