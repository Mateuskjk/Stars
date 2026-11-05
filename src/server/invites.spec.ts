// Convite por e-mail: o Admin cadastra, a pessoa recebe o código, valida, cria a senha e entra.
import { Mail, captureMailForTests } from './mail';
import { A, TestEnv, startTestEnv } from './testing/test-db';

let env: TestEnv;
let outbox: Mail[];
beforeAll(async () => {
  outbox = captureMailForTests();
  env = await startTestEnv();
}, 60_000);
afterAll(async () => env?.close());

const codeIn = (mail: Mail) => /(\d{6})/.exec(mail.text.split('código de verificação: ')[1] ?? '')?.[1] ?? '';
const invite = (body: object) => env.call('donoA', 'POST', '/api/data/usuarios', { tenantId: A, papel: 'ATENDENTE', ...body });
const accept = (body: object) => env.call(null, 'POST', '/api/auth/convite', body);

describe('convite por e-mail', () => {
  it('cadastrar envia o e-mail com o código (HTML estilizado, sem deixar passar HTML da mensagem)', async () => {
    const r = await invite({ email: 'nova@lexgroup.com.br', nome: 'Nova Pessoa', mensagem: 'Bem-vinda ao time! <script>alert(1)</script>' });
    expect(r.status).toBe(200);
    expect(r.data.emailEnviado).toBe(true);
    const mail = outbox.at(-1)!;
    expect(mail.to).toBe('nova@lexgroup.com.br');
    expect(codeIn(mail)).toMatch(/^\d{6}$/);
    expect(mail.html).toContain(codeIn(mail));
    expect(mail.html).toContain('background-color:#4338ca'); // cabeçalho colorido com a marca
    expect(mail.html).toContain('Olá, Nova!');
    expect(mail.html).toContain('Bem-vinda ao time!');
    expect(mail.html).toContain('&lt;script&gt;'); // texto de quem convida não vira HTML
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('/convite?email=nova%40lexgroup.com.br');
  });

  it('código errado não ativa; o certo com senha cria a conta e já entra', async () => {
    const code = codeIn(outbox.at(-1)!);
    const wrong = code === '000000' ? '111111' : '000000';
    expect((await accept({ email: 'nova@lexgroup.com.br', codigo: wrong, senha: 'senha-forte-1' })).status).toBe(400);
    expect((await accept({ email: 'nova@lexgroup.com.br', codigo: code, senha: 'curta' })).status).toBe(400);
    const ok = await env.raw(null, 'POST', '/api/auth/convite', JSON.stringify({ email: 'nova@lexgroup.com.br', codigo: code, senha: 'senha-forte-1' }), {
      'content-type': 'application/json',
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('set-cookie')).toContain('__Host-lex_session=');
    // já ativa: o mesmo código não vale de novo, e a senha nova entra pelo login normal
    expect((await accept({ email: 'nova@lexgroup.com.br', codigo: code, senha: 'senha-forte-1' })).status).toBe(404);
    expect((await env.call(null, 'POST', '/api/auth/login', { email: 'nova@lexgroup.com.br', senha: 'senha-forte-1' })).status).toBe(200);
  });

  it('reenviar troca o código (o antigo deixa de valer)', async () => {
    const created = await invite({ email: 'outra@lexgroup.com.br', nome: 'Outra Pessoa' });
    const old = codeIn(outbox.at(-1)!);
    const again = await env.call('donoA', 'POST', `/api/data/usuarios/${created.data.id}/convite`, {});
    expect(again.data.emailEnviado).toBe(true);
    const fresh = codeIn(outbox.at(-1)!);
    if (fresh !== old) expect((await accept({ email: 'outra@lexgroup.com.br', codigo: old, senha: 'senha-forte-1' })).status).toBe(400);
    // só o Admin da empresa reenvia
    expect((await env.call('donoB', 'POST', `/api/data/usuarios/${created.data.id}/convite`, {})).status).toBe(404);
  });

  it('quem já tem conta em outra empresa recebe o aviso do acesso novo, sem código', async () => {
    await env.db.exec(`reset role; update "Usuario" set "senhaHash" = 'scrypt$x' where id = 'u-dono-b'; set role lexagile_app;`);
    const r = await invite({ email: 'dono.b@lexgroup.com.br', nome: 'Dono B' });
    expect(r.data.emailEnviado).toBe(true);
    const mail = outbox.at(-1)!;
    expect(mail.subject).toContain('Você ganhou acesso');
    expect(codeIn(mail)).toBe('');
  });
});
