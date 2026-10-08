import { Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { AUDIT_ACTIONS, AuditAction, AuditEntry, AuditStore } from './audit-store';

const PAGE = 50;
const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('sv-SE'); // AAAA-MM-DD no fuso local

@Component({
  selector: 'app-audits',
  templateUrl: './audits.html',
  host: { class: 'audits' },
})
export class Audits {
  protected readonly store = inject(AuditStore);
  protected readonly actions = Object.entries(AUDIT_ACTIONS) as [AuditAction, { label: string; color: string }][];
  protected readonly actionInfo = AUDIT_ACTIONS;

  constructor() {
    afterNextRender(() => {
      this.store.load();
      this.store.refreshRemote();
    });
  }

  // ---------- Filtros ----------
  protected readonly search = signal('');
  protected readonly actionFilter = signal<Set<AuditAction>>(new Set());
  protected readonly entityFilter = signal('');
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly limit = signal(PAGE);

  protected readonly entities = computed(() => [...new Set(this.store.entries().map((e) => e.entity))].sort());

  protected readonly filtered = computed(() => {
    const term = normalize(this.search());
    const actions = this.actionFilter();
    const entity = this.entityFilter();
    const [from, to] = [this.from(), this.to()];
    return this.store.entries().filter((entry) => {
      if (actions.size && !actions.has(entry.action)) return false;
      if (entity && entry.entity !== entity) return false;
      const day = dayOf(entry.at);
      if (from && day < from) return false;
      if (to && day > to) return false;
      return !term || normalize([entry.actor, entry.entity, entry.name, entry.from, entry.to, entry.details].join(' ')).includes(term);
    });
  });

  protected readonly visible = computed(() => this.filtered().slice(0, this.limit()));
  protected readonly hasFilters = computed(() => !!(this.search() || this.actionFilter().size || this.entityFilter() || this.from() || this.to()));

  protected toggleAction(action: AuditAction) {
    this.actionFilter.update((set) => {
      const next = new Set(set);
      next.has(action) ? next.delete(action) : next.add(action);
      return next;
    });
    this.limit.set(PAGE);
  }

  protected clearFilters() {
    this.search.set('');
    this.actionFilter.set(new Set());
    this.entityFilter.set('');
    this.from.set('');
    this.to.set('');
    this.limit.set(PAGE);
  }

  protected showMore() {
    this.limit.update((n) => n + PAGE);
  }

  protected date(entry: AuditEntry) {
    return new Date(entry.at).toLocaleDateString('pt-BR');
  }

  protected time(entry: AuditEntry) {
    return new Date(entry.at).toLocaleTimeString('pt-BR');
  }

  // Exporta o que está filtrado (CSV com ";" para o Excel em português)
  protected exportCsv() {
    const cell = (text = '') => `"${text.replaceAll('"', '""')}"`;
    const header = ['Data', 'Hora', 'Quem', 'Ação', 'Tipo', 'Item', 'De', 'Para', 'Detalhes'].map((h) => cell(h)).join(';');
    const rows = this.filtered().map((e) =>
      [this.date(e), this.time(e), e.actor, AUDIT_ACTIONS[e.action].label, e.entity, e.name, e.from, e.to, e.details].map(cell).join(';'),
    );
    const blob = new Blob(['﻿' + [header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: url, download: `auditoria-${new Date().toISOString().slice(0, 10)}.csv` }).click();
    URL.revokeObjectURL(url);
  }
}
