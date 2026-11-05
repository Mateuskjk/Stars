// Convites de membros — roda SOMENTE no servidor.
// Quem é convidado sem conta recebe por e-mail um código de 6 números (vale 24h, 5 tentativas). Na tela /convite
// informa o e-mail, o código e cria a senha: o usuário vira ATIVO e já entra. O código fica guardado só como hash.
// Quem já tem conta em outra empresa recebe um aviso de que ganhou acesso (entra com a senha de sempre).
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { Request, Response, Router, json } from 'express';
import type { PoolClient } from 'pg';
import { db, ddl, onDbReset } from './db';
import { hashPassword, loginKeys, overLimit, requireAuth, startSession, usersForEmail } from './auth';
import { Layout, escapeHtml, layout, sendMail } from './mail';

export const CODE_TTL_H = 24;
export const MAX_ATTEMPTS = 5;
const ROLE_LABEL: Record<string, string> = { DONO: 'Admin', GESTOR: 'Supervisor', ATENDENTE: 'Membro', OBSERVADOR: 'Observador' };

let table: Promise<void> | null = null;
onDbReset(() => {
  table = null;
});
export function ensureTable() {
  table ??= ddl(
    `create schema if not exists lexagile;
     create table if not exists lexagile.convite (
       "usuarioId" text primary key references public."Usuario"(id) on delete cascade,
       "codigoHash" text not null,
       "expiraEm" timestamptz not null,
       tentativas integer not null default 0,
       "enviadoEm" timestamptz not null default now()
     )`,
  )
    .then(() => undefined)
    .catch((error) => {
      table = null;
      throw error;
    });
  return table;
}

const hashCode = (usuarioId: string, code: string) => createHash('sha256').update(`${usuarioId}:${code}`).digest('hex');

// Código novo para o usuário convidado (substitui o anterior e zera as tentativas)
export async function newInviteCode(client: PoolClient | ReturnType<typeof db>, usuarioId: string) {
  await ensureTable();
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await client.query(
    `insert into lexagile.convite ("usuarioId", "codigoHash", "expiraEm", tentativas, "enviadoEm")
     values ($1, $2, now() + make_interval(hours => $3), 0, now())
     on conflict ("usuarioId") do update set "codigoHash" = excluded."codigoHash", "expiraEm" = excluded."expiraEm", tentativas = 0, "enviadoEm" = now()`,
    [usuarioId, hashCode(usuarioId, code), CODE_TTL_H],
  );
  return code;
}

const appUrl = () => (process.env['APP_URL'] || 'http://localhost:4200').replace(/\/$/, '');

// Monta e envia o e-mail. code = null: a pessoa já tem conta (só avisa do acesso novo)
export async function sendInviteMail(usuarioId: string, invitedBy: string, message: string, code: string | null) {
  const { rows } = await db().query<{ nome: string; email: string; papel: string; empresa: string }>(
    `select u.nome, u.email, u.papel, t.nome as empresa from "Usuario" u join "Tenant" t on t.id = u."tenantId" where u.id = $1`,
    [usuarioId],
  );
  const u = rows[0];
  if (!u) throw new Error('Usuário não encontrado.');
  const who = escapeHtml(invitedBy);
  const role = ROLE_LABEL[u.papel] ?? 'Membro';
  const empresa = escapeHtml(u.empresa);
  const link = `${appUrl()}/convite?email=${encodeURIComponent(u.email)}`;
  const mail: Layout = code
    ? {
        preheader: `Seu código de acesso: ${code}`,
        title: `${invitedBy} convidou você para o LexÁgile`,
        greeting: `Olá, ${u.nome.split(' ')[0]}!`,
        paragraphs: [`<strong>${who}</strong> convidou você para entrar na <strong>${empresa}</strong> como <strong>${role}</strong>.`],
        quote: message.trim() || undefined,
        code,
        button: { label: 'Ativar minha conta', url: link },
        footnote: `Na tela de ativação, informe este e-mail, o código acima e crie a sua senha. O código vale por ${CODE_TTL_H} horas.<br>Se você não esperava este convite, é só ignorar esta mensagem.`,
      }
    : {
        preheader: `Você agora tem acesso à ${u.empresa}`,
        title: `Você ganhou acesso à ${u.empresa}`,
        greeting: `Olá, ${u.nome.split(' ')[0]}!`,
        paragraphs: [`<strong>${who}</strong> liberou o seu acesso à <strong>${empresa}</strong> como <strong>${role}</strong>. Entre com a mesma senha que você já usa no LexÁgile.`],
        quote: message.trim() || undefined,
        button: { label: 'Entrar no LexÁgile', url: appUrl() },
        footnote: 'A empresa nova aparece no seletor do topo do menu.',
      };
  const text = [
    `Olá, ${u.nome.split(' ')[0]}!`,
    '',
    code
      ? `${invitedBy} convidou você para entrar na ${u.empresa} como ${role}.`
      : `${invitedBy} liberou o seu acesso à ${u.empresa} como ${role}. Entre com a mesma senha de sempre.`,
    ...(message.trim() ? ['', `“${message.trim()}”`] : []),
    ...(code ? ['', `Seu código de verificação: ${code}`, '', `Ative sua conta em ${link} (o código vale por ${CODE_TTL_H} horas).`] : ['', appUrl()]),
    '',
    'Equipe LexÁgile',
  ].join('\n');
  await sendMail({ to: u.email, subject: mail.title, html: layout(mail), text });
}

// Envia sem derrubar a gravação: o resultado vai para a tela (a pessoa foi criada mesmo se o e-mail falhar)
export async function trySendInvite(usuarioId: string, invitedBy: string, message: string, code: string | null) {
  try {
    await sendInviteMail(usuarioId, invitedBy, message, code);
    return { emailEnviado: true };
  } catch (error) {
    console.error('[convite] e-mail não enviado:', (error as Error).message);
    return { emailEnviado: false, emailErro: 'Não foi possível enviar o e-mail do convite. Confira a configuração de e-mail do servidor.' };
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function invitesRouter() {
  const router = Router();
  router.use(json({ limit: '10kb' }));

  // Convidado: valida o código, cria a senha e já entra (público, com limite de tentativas)
  router.post('/convite', async (req: Request, res: Response) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const codigo = String(req.body?.codigo ?? '').replace(/\D/g, '');
    const senha = String(req.body?.senha ?? '');
    if (!EMAIL.test(email) || codigo.length !== 6) return void res.status(400).json({ error: 'Informe o e-mail e o código de 6 números.' });
    if (senha.length < 8 || senha.length > 200) return void res.status(400).json({ error: 'A senha precisa ter pelo menos 8 caracteres.' });
    try {
      if (await overLimit(loginKeys(email, req.ip ?? ''))) return void res.status(429).json({ error: 'Muitas tentativas. Espere alguns minutos.' });
      await ensureTable();
      const { rows } = await db().query<{ usuarioId: string; codigoHash: string; vencido: boolean; tentativas: number }>(
        `select c."usuarioId", c."codigoHash", c."expiraEm" < now() as vencido, c.tentativas
           from lexagile.convite c join "Usuario" u on u.id = c."usuarioId"
          where lower(u.email) = $1 and u.situacao = 'CONVIDADO' and u."removidoEm" is null`,
        [email],
      );
      if (!rows.length) return void res.status(404).json({ error: 'Não encontramos um convite pendente para esse e-mail.' });
      const got = (r: (typeof rows)[number]) => Buffer.from(hashCode(r.usuarioId, codigo));
      const match = rows.find((r) => !r.vencido && r.tentativas < MAX_ATTEMPTS && timingSafeEqual(got(r), Buffer.from(r.codigoHash)));
      if (!match) {
        await db().query(`update lexagile.convite set tentativas = tentativas + 1 where "usuarioId" = any($1::text[])`, [rows.map((r) => r.usuarioId)]);
        if (rows.every((r) => r.vencido)) return void res.status(410).json({ error: `Esse código expirou (vale ${CODE_TTL_H}h). Peça para reenviarem o convite.` });
        if (rows.every((r) => r.tentativas + 1 >= MAX_ATTEMPTS)) return void res.status(429).json({ error: `Muitas tentativas erradas. Peça para reenviarem o convite com um código novo.` });
        return void res.status(400).json({ error: 'Código incorreto. Confira o e-mail e tente de novo.' });
      }
      // O código provou que o e-mail é da pessoa: ativa os convites dela em todas as empresas, com a mesma senha
      await db().query(
        `update "Usuario" set "senhaHash" = $2, "senhaAtualizadaEm" = now(), situacao = 'ATIVO'
          where lower(email) = $1 and situacao = 'CONVIDADO' and "removidoEm" is null`,
        [email, await hashPassword(senha)],
      );
      await db().query(`delete from lexagile.convite where "usuarioId" = any($1::text[])`, [rows.map((r) => r.usuarioId)]);
      const users = await usersForEmail(email);
      if (!users.length) return void res.status(403).json({ error: 'Conta ativada, mas o seu acesso está bloqueado. Fale com o administrador.' });
      await startSession(res, email, users);
      console.log(`[convite] ${email} ativou a conta`);
      res.json({ ok: true, nome: users[0].nome });
    } catch (error) {
      console.error('[convite]', (error as Error).message);
      res.status(500).json({ error: 'Não foi possível ativar a conta agora. Tente de novo.' });
    }
  });

  return router;
}

// Admin: reenviar o convite (código novo) de quem ainda não ativou a conta
export function resendInviteRouter() {
  const router = Router();
  router.post('/usuarios/:id/convite', requireAuth, json({ limit: '10kb' }), async (req: Request, res: Response) => {
    const s = req.session!;
    const id = String(req.params['id']);
    try {
      const { rows } = await db().query<{ tenantId: string; situacao: string }>(`select "tenantId", situacao from "Usuario" where id = $1 and "removidoEm" is null`, [id]);
      const u = rows[0];
      if (!u || !s.memberships.some((m) => m.tenantId === u.tenantId && m.papel === 'DONO')) return void res.status(404).json({ error: 'Convite não encontrado.' });
      if (u.situacao !== 'CONVIDADO') return void res.status(409).json({ error: 'Essa pessoa já ativou a conta.' });
      const code = await newInviteCode(db(), id);
      res.json(await trySendInvite(id, s.nome, String(req.body?.mensagem ?? '').slice(0, 1000), code));
    } catch (error) {
      console.error('[convite] reenviar:', (error as Error).message);
      res.status(500).json({ error: 'Não foi possível reenviar o convite.' });
    }
  });
  return router;
}
