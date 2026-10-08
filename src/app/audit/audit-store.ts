import { Injectable, signal } from '@angular/core';

export type AuditAction = 'create' | 'update' | 'move' | 'archive' | 'cancel' | 'close' | 'delete';

export const AUDIT_ACTIONS: Record<AuditAction, { label: string; color: string }> = {
  create: { label: 'Criação', color: '#0ca30c' },
  update: { label: 'Alteração', color: '#2a78d6' },
  move: { label: 'Movimentação', color: '#9b7be0' },
  archive: { label: 'Arquivamento', color: '#898781' },
  cancel: { label: 'Cancelamento', color: '#eb6834' },
  close: { label: 'Encerramento', color: '#1baf7a' },
  delete: { label: 'Exclusão', color: '#d03b3b' },
};

export interface AuditEntry {
  id: string;
  at: string; // ISO: data e hora
  actor: string; // quem fez
  action: AuditAction;
  entity: string; // tipo do item: Atividade, Projeto, Sprint…
  name: string; // nome do item
  from?: string; // de onde saiu (coluna, status, valor antigo)
  to?: string; // para onde foi
  details?: string;
}

const KEY = 'stars.audit';
const LIMIT = 2000; // guarda as 2.000 ações mais recentes

// ponytail: quem fez é fixo até existir login
export const CURRENT_USER = 'Usuário';

// Registro de auditoria: só acrescenta (não há como editar nem apagar uma entrada pela tela).
// ponytail: guardado no localStorage deste navegador; em produção, gravar no servidor (append-only),
// senão o próprio usuário consegue apagar o histórico limpando os dados do navegador.
@Injectable({ providedIn: 'root' })
export class AuditStore {
  readonly entries = signal<AuditEntry[]>([]);
  private loaded = false;

  // No navegador lê o que já foi registrado; no SSR não faz nada (não existe localStorage)
  load() {
    if (this.loaded || typeof localStorage === 'undefined') return;
    this.loaded = true;
    try {
      const data = JSON.parse(localStorage.getItem(KEY) ?? '[]');
      if (Array.isArray(data)) this.entries.set([...data, ...this.entries()].slice(0, LIMIT));
    } catch {
      // armazenamento bloqueado ou dado corrompido: começa vazio
    }
  }

  log(entry: Omit<AuditEntry, 'id' | 'at' | 'actor'> & { actor?: string }) {
    this.load();
    const full: AuditEntry = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      actor: entry.actor ?? CURRENT_USER,
      ...entry,
    };
    this.entries.update((list) => [full, ...list].slice(0, LIMIT));
    try {
      localStorage.setItem(KEY, JSON.stringify(this.entries()));
    } catch {
      // sem armazenamento: o registro vale só nesta sessão
    }
  }
}

// Lista "Campo: antes → depois" só com o que mudou (para o detalhe de uma alteração)
export function diff(beforeItem: object, afterItem: object, labels: Record<string, string>) {
  const before = beforeItem as Record<string, unknown>;
  const after = afterItem as Record<string, unknown>;
  const show = (value: unknown) => (Array.isArray(value) ? value.join(', ') || '—' : value === '' || value == null ? '—' : String(value));
  return Object.entries(labels)
    .filter(([key]) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map(([key, label]) => `${label}: ${show(before[key])} → ${show(after[key])}`)
    .join(' · ');
}
