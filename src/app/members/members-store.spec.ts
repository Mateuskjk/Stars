import { TestBed } from '@angular/core/testing';
import { MembersStore, defaultPermissions, generateToken } from './members-store';

describe('MembersStore', () => {
  it('invites as pending (the server sends the e-mail with the code) and makes opaque tokens', () => {
    const store = TestBed.inject(MembersStore);
    const member = store.invite(
      { name: 'Joana Prado', email: 'Joana@Empresa.com ', role: 'member', permissions: defaultPermissions('member'), company: 'Acme Ltda' },
      ' Bem-vinda! ',
      5,
    );
    expect(member).toMatchObject({ status: 'pending', email: 'joana@empresa.com', invite: { sentAt: 5, message: 'Bem-vinda!' } });
    expect(store.inviteMail()).toEqual({ email: 'joana@empresa.com', state: 'sending' });
    expect(generateToken()).toMatch(/^stars_[0-9a-f]{48}$/);
    expect(generateToken()).not.toBe(generateToken());
  });

  it('shows a token once and keeps only its last 4 characters', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"ok":true}'));
    const store = TestBed.inject(MembersStore);
    const token = await store.issueToken(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/internal/tokens/1'); // registrado no servidor (que guarda só o hash)
    expect(store.members()[0].tokenHint).toBe(token.slice(-4));
    store.revokeToken(1);
    expect(store.members()[0].tokenHint).toBeNull();
    fetchMock.mockRestore();
  });
});
