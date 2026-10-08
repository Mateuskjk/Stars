import { TestBed } from '@angular/core/testing';
import { CODE_TTL, MAX_ATTEMPTS, MembersStore, defaultPermissions, generateCode, generateToken } from './members-store';

describe('MembersStore', () => {
  const invite = (store: MembersStore, now = 0) =>
    store.invite({ name: 'Joana Prado', email: 'Joana@Empresa.com ', role: 'member', permissions: defaultPermissions('member'), company: 'Acme Ltda' }, now);

  it('generates 6-digit codes and opaque tokens', () => {
    for (let i = 0; i < 50; i++) expect(generateCode()).toMatch(/^\d{6}$/);
    expect(generateToken()).toMatch(/^stars_[0-9a-f]{48}$/);
    expect(generateToken()).not.toBe(generateToken());
  });

  it('activates a pending member only with the right code, in time', () => {
    const store = TestBed.inject(MembersStore);
    const member = invite(store);
    expect(member).toMatchObject({ status: 'pending', email: 'joana@empresa.com' });

    const wrong = member.invite!.code === '000000' ? '111111' : '000000';
    expect(store.validate('joana@empresa.com', wrong, 1)).toBe('wrong-code');
    expect(store.validate('JOANA@empresa.com', member.invite!.code, 2)).toBe('ok');
    expect(store.findByEmail('joana@empresa.com')).toMatchObject({ status: 'active', invite: null });
    expect(store.validate('joana@empresa.com', member.invite!.code, 3)).toBe('not-found'); // código não serve duas vezes
  });

  it('expires after 24h and blocks after too many wrong attempts until resent', () => {
    const store = TestBed.inject(MembersStore);
    const member = invite(store);
    expect(store.validate(member.email, member.invite!.code, CODE_TTL + 1)).toBe('expired');

    const wrong = member.invite!.code === '000000' ? '111111' : '000000';
    for (let i = 1; i < MAX_ATTEMPTS; i++) expect(store.validate(member.email, wrong, 1)).toBe('wrong-code');
    expect(store.validate(member.email, wrong, 1)).toBe('blocked');
    expect(store.validate(member.email, member.invite!.code, 1)).toBe('blocked'); // nem o certo passa mais

    const fresh = store.resend(member.id, 10);
    expect(store.validate(member.email, fresh.code, 11)).toBe('ok');
  });

  it('shows a token once and keeps only its last 4 characters', () => {
    const store = TestBed.inject(MembersStore);
    const token = store.issueToken(1);
    expect(store.members()[0].tokenHint).toBe(token.slice(-4));
    store.revokeToken(1);
    expect(store.members()[0].tokenHint).toBeNull();
  });
});
