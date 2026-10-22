import { Injectable, inject, signal } from '@angular/core';
import { ApiSync } from '../api/api-sync';
import { api } from '../api/http';
import { CompanyStore } from '../companies/company-store';
import { MembersStore } from '../members/members-store';

export interface DailyParticipant {
  name: string;
  moves: number;
  notes: { yesterday: string; today: string; blockers: string } | null;
}

export interface DailyRecord {
  id: number | string; // string: id do banco
  date: string; // ISO
  participants: DailyParticipant[];
}

const KEY = 'stars.daily-history';

// Histórico das dailies finalizadas: com login, no banco, por empresa (o time todo vê);
// sem login (exemplos e testes), só neste navegador
@Injectable({ providedIn: 'root' })
export class DailyHistory {
  private readonly sync = inject(ApiSync);
  private readonly companies = inject(CompanyStore);
  private readonly members = inject(MembersStore);
  readonly records = signal<DailyRecord[]>([]);
  readonly error = signal('');

  private tenantId() {
    return this.members.sessionEmail() ? this.sync.ids.empresa.db(this.companies.currentId()) : null;
  }

  // Chamado no navegador depois da primeira renderização (no SSR não existe localStorage)
  async load() {
    const tenantId = this.tenantId();
    if (!tenantId) return this.records.set(read());
    try {
      this.records.set(await api<DailyRecord[]>(`/data/dailies?tenantId=${encodeURIComponent(tenantId)}`));
    } catch (e) {
      this.error.set(`Não foi possível carregar as dailies: ${(e as Error).message}`);
    }
  }

  async add(record: DailyRecord) {
    this.records.update((list) => [record, ...list]);
    const tenantId = this.tenantId();
    if (!tenantId) return write(this.records());
    try {
      const { id } = await api<{ id: string }>('/data/dailies', { method: 'POST', body: JSON.stringify({ tenantId, record }) });
      this.records.update((list) => list.map((r) => (r === record ? { ...r, id } : r)));
    } catch (e) {
      this.error.set(`A daily não foi salva no banco: ${(e as Error).message}`);
    }
  }

  async remove(id: number | string) {
    const record = this.records().find((r) => r.id === id);
    this.records.update((list) => list.filter((r) => r.id !== id));
    if (typeof id === 'number') return write(this.records());
    try {
      await api(`/data/dailies/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (e) {
      this.error.set(`Não foi possível excluir a daily: ${(e as Error).message}`);
      if (record) this.records.update((list) => [...list, record].sort((a, b) => b.date.localeCompare(a.date)));
    }
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

