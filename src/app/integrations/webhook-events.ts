import { AUDIT_ACTIONS, AuditAction, AuditEntry } from '../audit/audit-store';

// Cada ação registrada na auditoria vira um evento de webhook: "<item>.<ação>", ex.: activity.move
const ENTITIES: { entity: string; slug: string; actions: AuditAction[] }[] = [
  { entity: 'Atividade', slug: 'activity', actions: ['create', 'update', 'move', 'archive', 'cancel', 'delete'] },
  { entity: 'Atividade de projeto', slug: 'project_activity', actions: ['move', 'archive', 'cancel'] },
  { entity: 'Projeto', slug: 'project', actions: ['create'] },
  { entity: 'Sprint', slug: 'sprint', actions: ['create', 'close', 'cancel', 'archive'] },
  { entity: 'Membro', slug: 'member', actions: ['create', 'update', 'move', 'delete'] },
  { entity: 'Equipe', slug: 'team', actions: ['create', 'update', 'delete'] },
  { entity: 'Perfil de empresa', slug: 'company', actions: ['create', 'update', 'archive'] },
  { entity: 'Daily', slug: 'daily', actions: ['close', 'delete'] },
  { entity: 'Modelo de IA', slug: 'ai_model', actions: ['create', 'update', 'delete'] },
];

// Função (e não constante) porque a auditoria importa este arquivo: na carga, AUDIT_ACTIONS ainda não existe
export function eventGroups() {
  return ENTITIES.map(({ entity, slug, actions }) => ({
    entity,
    events: actions.map((action) => ({ id: `${slug}.${action}`, label: AUDIT_ACTIONS[action].label })),
  }));
}

export function eventFor(entry: Pick<AuditEntry, 'entity' | 'action'>) {
  const group = ENTITIES.find((e) => e.entity === entry.entity);
  return group?.actions.includes(entry.action) ? `${group.slug}.${entry.action}` : null;
}

// O que vai no campo "data" do webhook (mesmo formato do exemplo mostrado na tela)
export function eventData(entry: AuditEntry) {
  return {
    entity: entry.entity,
    name: entry.name,
    from: entry.from ?? null,
    to: entry.to ?? null,
    details: entry.details ?? null,
    actor: entry.actor,
    occurred_at: entry.at,
  };
}

// Exemplo de payload completo para um evento (como o servidor envia)
export function samplePayload(event: string) {
  const [slug, action] = event.split('.');
  const group = ENTITIES.find((e) => e.slug === slug);
  const moving = action === 'move' || action === 'archive' || action === 'cancel' || action === 'close';
  return {
    id: '7c0e4b7a-2f1d-4a8e-9b1c-2d3e4f5a6b7c',
    event,
    created_at: '2026-10-08T14:32:10.000Z',
    data: {
      entity: group?.entity ?? 'Atividade',
      name: group?.slug === 'sprint' ? 'Sprint 12' : 'Revisar contratos',
      from: moving ? 'Para refinar' : null,
      to: moving ? (action === 'archive' ? 'Arquivado' : action === 'cancel' ? 'Cancelados' : 'Refinado') : null,
      details: action === 'update' ? 'Prazo: 10/10 → 15/10' : null,
      actor: 'Ana Souza',
      occurred_at: '2026-10-08T14:32:09.812Z',
    },
  };
}
