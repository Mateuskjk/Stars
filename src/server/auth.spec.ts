import { randomBytes, scryptSync } from 'node:crypto';
import { tooManyAttempts, verifyPassword } from './auth';

// Gera um hash no mesmo formato do banco: scrypt$N$r$p$salt$hash
function makeHash(password: string, saltAsText = false) {
  const salt = randomBytes(16).toString('base64');
  const key = scryptSync(password, saltAsText ? salt : Buffer.from(salt, 'base64'), 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$32768$8$1$${salt}$${key.toString('base64')}`;
}

describe('verifyPassword', () => {
  it('aceita a senha certa e recusa a errada', async () => {
    const hash = makeHash('segredo-123');
    expect(await verifyPassword('segredo-123', hash)).toBe(true);
    expect(await verifyPassword('segredo-124', hash)).toBe(false);
  });

  it('aceita hash gerado com o salt como texto', async () => {
    expect(await verifyPassword('abc', makeHash('abc', true))).toBe(true);
  });

  it('recusa hash vazio ou em outro formato', async () => {
    expect(await verifyPassword('abc', null)).toBe(false);
    expect(await verifyPassword('abc', 'bcrypt$xyz')).toBe(false);
    expect(await verifyPassword('abc', 'scrypt$999999999$8$1$AAAA$AAAA')).toBe(false);
  });
});

describe('tooManyAttempts', () => {
  it('sem falhas registradas, libera', () => {
    expect(tooManyAttempts(['email:ninguem@x.com'])).toBe(false);
  });
});
