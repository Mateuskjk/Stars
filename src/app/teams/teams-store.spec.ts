import { TestBed } from '@angular/core/testing';
import { MembersStore, defaultPermissions } from '../members/members-store';
import { TeamsStore } from './teams-store';

describe('TeamsStore', () => {
  it('only keeps members that are active and linked to a company profile', () => {
    const members = TestBed.inject(MembersStore);
    const teams = TestBed.inject(TeamsStore);

    const withoutCompany = members.members().find((m) => !m.company)!; // membro ativo sem empresa
    const pending = members.invite({ name: 'Rui Prado', email: 'rui@empresa.com', role: 'member', permissions: defaultPermissions('member'), company: 'Acme Ltda' });
    const ok = members.eligibleForTeams()[0];

    const id = teams.create({ name: '  Nova Equipe ', focus: '', memberIds: [ok.id, withoutCompany.id, pending.id, ok.id], projectIds: [1], activityIds: [2] });
    expect(teams.teams().find((t) => t.id === id)).toMatchObject({ name: 'Nova Equipe', memberIds: [ok.id], projectIds: [1], activityIds: [2] });

    // Ao ganhar empresa, a pessoa passa a poder entrar
    members.patch(withoutCompany.id, { company: 'Nova Tech' });
    teams.update(id, { name: 'Nova Equipe', focus: 'Dados', memberIds: [ok.id, withoutCompany.id], projectIds: [], activityIds: [] });
    expect(teams.teams().find((t) => t.id === id)!.memberIds).toEqual([ok.id, withoutCompany.id]);

    teams.remove(id);
    expect(teams.teams().some((t) => t.id === id)).toBe(false);
  });
});
