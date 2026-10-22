// Ações que geram evento (o nome vai no "<item>.<ação>", ex.: activity.move)
export type EventAction = 'create' | 'update' | 'move' | 'archive' | 'cancel' | 'close' | 'delete';

const ACTION_LABELS: Record<EventAction, string> = {
  create: 'Criação',
  update: 'Alteração',
  move: 'Movimentação',
  archive: 'Arquivamento',
  cancel: 'Cancelamento',
  close: 'Encerramento',
  delete: 'Exclusão',
};

// Eventos de webhook: "<item>.<ação>", ex.: activity.move. Quem emite é o SERVIDOR, depois de gravar no banco
// (src/server/events.ts); esta lista é o catálogo mostrado na tela e precisa bater com o que o servidor envia.
const ENTITIES: { entity: string; slug: string; actions: EventAction[] }[] = [
  { entity: 'Atividade', slug: 'activity', actions: ['create', 'update', 'move', 'archive', 'cancel'] },
  { entity: 'Atividade de projeto', slug: 'project_activity', actions: ['create', 'move', 'archive', 'cancel'] },
  { entity: 'Projeto', slug: 'project', actions: ['create'] },
  { entity: 'Sprint', slug: 'sprint', actions: ['create', 'close'] },
  { entity: 'Membro', slug: 'member', actions: ['create', 'update', 'delete'] },
  { entity: 'Equipe', slug: 'team', actions: ['create', 'update', 'delete'] },
  { entity: 'Perfil de empresa', slug: 'company', actions: ['create', 'update', 'archive'] },
  { entity: 'Daily', slug: 'daily', actions: ['close', 'delete'] },
];

export function eventGroups() {
  return ENTITIES.map(({ entity, slug, actions }) => ({
    entity,
    events: actions.map((action) => ({ id: `${slug}.${action}`, label: ACTION_LABELS[action] })),
  }));
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
      company_id: 'cmabc123empresa',
    },
  };
}
