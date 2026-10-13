// Eventos de webhook gerados pelo SERVIDOR (não pelo navegador): cada gravação enfileira o seu evento na
// transação, e ele só é entregue depois do commit — se a gravação falhar, nenhum webhook fica sabendo de algo
// que não aconteceu. Quem recebe: os webhooks dos Admins (Donos) da empresa onde a mudança aconteceu.
import type { PoolClient } from 'pg';

export interface DomainEvent {
  tenantId: string;
  event: string; // ex.: activity.move (catálogo em src/app/integrations/webhook-events.ts)
  data: {
    entity: string;
    name: string;
    from: string | null;
    to: string | null;
    details: string | null;
    actor: string;
    occurred_at: string;
    company_id: string;
  };
}

const pending = new WeakMap<PoolClient, DomainEvent[]>();

export function queueEvent(
  client: PoolClient,
  tenantId: string,
  event: string,
  actor: string,
  info: { entity: string; name: string; from?: string | null; to?: string | null; details?: string | null },
) {
  const list = pending.get(client) ?? [];
  list.push({
    tenantId,
    event,
    data: {
      entity: info.entity,
      name: info.name,
      from: info.from ?? null,
      to: info.to ?? null,
      details: info.details ?? null,
      actor,
      occurred_at: new Date().toISOString(),
      company_id: tenantId,
    },
  });
  pending.set(client, list);
}

// Retira os eventos da transação (para entregar depois do commit, ou descartar no rollback)
export function takeEvents(client: PoolClient): DomainEvent[] {
  const list = pending.get(client) ?? [];
  pending.delete(client);
  return list;
}
