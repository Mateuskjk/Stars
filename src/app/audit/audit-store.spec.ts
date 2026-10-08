import { TestBed } from '@angular/core/testing';
import { BacklogStore } from '../backlog/backlog-store';
import { MembersStore } from '../members/members-store';
import { SprintStore } from '../planning/sprint-store';
import { AuditStore, diff } from './audit-store';

describe('AuditStore', () => {
  beforeEach(() => localStorage.clear());

  it('lists only what changed, before → after', () => {
    expect(diff({ name: 'A', due: '', tags: ['x'] }, { name: 'B', due: '', tags: ['x', 'y'] }, { name: 'Nome', due: 'Prazo', tags: 'Tags' })).toBe(
      'Nome: A → B · Tags: x → x, y',
    );
  });

  it('records who, what, from → to and when for actions across the system, newest first, and saves them', () => {
    const audit = TestBed.inject(AuditStore);
    const backlog = TestBed.inject(BacklogStore);
    const sprints = TestBed.inject(SprintStore);
    const members = TestBed.inject(MembersStore);
    const item = backlog.items().find((i) => i.status === 'to-refine' && !i.locked)!;

    backlog.move(item.id, 'refined');
    backlog.move(item.id, 'refined'); // sem mudança: não registra
    backlog.patch(item.id, { status: 'archived' });
    sprints.setStatus(sprints.active()!.id, 'canceled');
    members.patch(2, { role: 'supervisor' });
    backlog.remove(item.id);

    const [deleted, role, sprint, archived, moved] = audit.entries();
    expect(moved).toMatchObject({ action: 'move', entity: 'Atividade', name: item.name, from: 'Para refinar', to: 'Refinado', actor: 'Usuário' });
    expect(archived).toMatchObject({ action: 'archive', from: 'Refinado', to: 'Arquivado' });
    expect(sprint).toMatchObject({ action: 'cancel', entity: 'Sprint', from: 'Ativa', to: 'Cancelada' });
    expect(role).toMatchObject({ entity: 'Membro', from: 'Membro', to: 'Supervisor' });
    expect(deleted).toMatchObject({ action: 'delete', name: item.name });
    expect(audit.entries()).toHaveLength(5);
    expect(new Date(moved.at).getTime()).not.toBeNaN();

    expect(JSON.parse(localStorage.getItem('stars.audit')!)).toHaveLength(5);
  });
});
