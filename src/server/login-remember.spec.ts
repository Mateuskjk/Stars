// "Manter conectado por 7 dias úteis": a conta dos dias úteis e o login de verdade (com e sem a caixa marcada).
import { randomBytes, scryptSync } from 'node:crypto';
import { businessDaysFrom } from './auth';
import { TestEnv, startTestEnv } from './testing/test-db';

const brt = (iso: string) => new Date(`${iso}-03:00`).getTime(); // horário de Brasília

describe('businessDaysFrom', () => {
  it('pula sábado e domingo e mantém o horário', () => {
    // sexta 16/10 10h → terça 27/10 10h (19, 20, 21, 22, 23, 26, 27)
    expect(businessDaysFrom(brt('2026-10-16T10:00:00'), 7)).toBe(brt('2026-10-27T10:00:00'));
    // segunda 19/10 9h → quarta 28/10 9h
    expect(businessDaysFrom(brt('2026-10-19T09:00:00'), 7)).toBe(brt('2026-10-28T09:00:00'));
    // sábado e domingo contam a partir da segunda
    expect(businessDaysFrom(brt('2026-10-17T15:00:00'), 7)).toBe(brt('2026-10-27T15:00:00'));
    // sexta 23h em Brasília (já é sábado em UTC) ainda conta como sexta
    expect(businessDaysFrom(brt('2026-10-16T23:00:00'), 7)).toBe(brt('2026-10-27T23:00:00'));
  });
});

describe('login com "Manter conectado"', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await startTestEnv();
    const salt = randomBytes(16).toString('base64');
    const key = scryptSync('senha-certa', Buffer.from(salt, 'base64'), 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    await env.db.exec(`reset role; update "Usuario" set "senhaHash" = 'scrypt$32768$8$1$${salt}$${key.toString('base64')}' where id = 'u-gestor-a'; set role lexagile_app;`);
  }, 60_000);
  afterAll(async () => env?.close());

  const login = async (lembrar?: boolean) => {
    const r = await env.raw(null, 'POST', '/api/auth/login', JSON.stringify({ email: 'gestor.a@lexgroup.com.br', senha: 'senha-certa', lembrar }), { 'content-type': 'application/json' });
    const cookie = r.headers.get('set-cookie') ?? '';
    return { status: r.status, maxAge: Number(/Max-Age=(\d+)/.exec(cookie)?.[1]) };
  };

  it('sem marcar: 12 horas; marcado: até o fim do 7º dia útil (de 9 a 11 dias corridos)', async () => {
    const plain = await login();
    expect(plain.status).toBe(200);
    expect(plain.maxAge).toBe(12 * 60 * 60);

    const kept = await login(true);
    expect(kept.status).toBe(200);
    expect(kept.maxAge).toBeGreaterThanOrEqual(9 * 24 * 60 * 60 - 60); // 7 dias úteis = no mínimo 9 dias corridos
    expect(kept.maxAge).toBeLessThanOrEqual(11 * 24 * 60 * 60);

    // a sessão no banco vence junto com o cookie
    const { rows } = await env.db.query<{ s: number }>(`select extract(epoch from max("expiraEm") - now())::int as s from lexagile.sessao where email = 'gestor.a@lexgroup.com.br'`);
    expect(Math.abs(rows[0].s - kept.maxAge)).toBeLessThan(5);
  });
});
