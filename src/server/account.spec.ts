// Minha conta no banco: cada pessoa lê e grava só a sua (pelo e-mail do login).
import { TestEnv, startTestEnv } from './testing/test-db';

let env: TestEnv;
beforeAll(async () => {
  env = await startTestEnv();
}, 60_000);
afterAll(async () => env?.close());

describe('minha conta', () => {
  it('começa vazia, grava e volta igual — e uma pessoa não vê a da outra', async () => {
    expect((await env.call('gestorA', 'GET', '/api/data/conta')).data).toEqual({ dados: null });
    const dados = { fullName: 'Gestor A', notifications: { enabled: false } };
    expect((await env.call('gestorA', 'PUT', '/api/data/conta', { dados })).status).toBe(204);
    expect((await env.call('gestorA', 'GET', '/api/data/conta')).data).toEqual({ dados });
    expect((await env.call('donoB', 'GET', '/api/data/conta')).data).toEqual({ dados: null });
  });

  it('recusa sem login, formato errado e conta grande demais', async () => {
    expect((await env.call(null, 'GET', '/api/data/conta')).status).toBe(401);
    expect((await env.call('gestorA', 'PUT', '/api/data/conta', { dados: [1, 2] })).status).toBe(400);
    expect((await env.call('gestorA', 'PUT', '/api/data/conta', { dados: { photo: 'x'.repeat(310_000) } })).status).toBe(413);
  });
});
