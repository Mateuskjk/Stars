// Entrar com o Google (OAuth 2.0 + PKCE) — roda SOMENTE no servidor. O segredo do cliente fica no .env.
// 1) /api/auth/google manda a pessoa para o Google com um "state" aleatório (guardado num cookie httpOnly)
// 2) o Google volta em /api/auth/google/callback com um código; o servidor troca o código pelo token
//    (com o segredo e o PKCE), pergunta ao Google quem é a pessoa e procura o usuário no banco:
//    pelo googleSub, ou pelo e-mail verificado quando o usuário ainda não tem Google ligado.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Request, Response, Router } from 'express';
import { db } from './db';
import { parseCookie, setCookie, startSession } from './auth';
import { isAllowedEmail } from './domains';

const STATE_COOKIE = '__Host-lex_google';
const NEXT_COOKIE = '__Host-lex_next';
// Só volta para a autorização do Claude (MCP); qualquer outro destino vai para a Home
const safeNext = (v: unknown) => (typeof v === 'string' && v.startsWith('/authorize?') && !v.includes('//') && !v.includes('\\') ? v : null);
const STATE_MS = 10 * 60 * 1000;

const config = () => ({
  clientId: process.env['GOOGLE_CLIENT_ID'] ?? '',
  secret: process.env['GOOGLE_CLIENT_SECRET'] ?? '',
});
export const googleEnabled = () => !!(config().clientId && config().secret);

// Endereço de volta: o mesmo cadastrado no Google Cloud. Em produção, defina APP_URL (ex.: https://app.lexagile.com.br)
function redirectUri(req: Request) {
  const base = process.env['APP_URL'] || `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/$/, '')}/api/auth/google/callback`;
}

const b64url = (buf: Buffer) => buf.toString('base64url');
// Volta para a tela de login com o motivo; o detalhe técnico vai só para o log do servidor
const fail = (res: Response, motivo: string, detalhe?: string) => {
  if (detalhe) console.error(`[auth] login com Google falhou (${motivo}): ${detalhe}`);
  res.redirect(`/?erro=google-${motivo}`);
};

export function googleRouter() {
  const router = Router();

  // A tela de login só mostra o botão quando o Google está configurado
  router.get('/providers', (_req, res) => void res.json({ google: googleEnabled() }));

  router.get('/google', (req, res) => {
    if (!googleEnabled()) return fail(res, 'desligado');
    const state = b64url(randomBytes(24));
    const verifier = b64url(randomBytes(32));
    setCookie(res, `${state}.${verifier}`, STATE_MS, STATE_COOKIE);
    const next = safeNext(req.query['next']);
    setCookie(res, next ? encodeURIComponent(next) : '', next ? STATE_MS : 0, NEXT_COOKIE);
    const params = new URLSearchParams({
      client_id: config().clientId,
      redirect_uri: redirectUri(req),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: b64url(createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  router.get('/google/callback', async (req, res) => {
    const [state, verifier] = (parseCookie(req.headers.cookie)[STATE_COOKIE] ?? '').split('.');
    setCookie(res, '', 0, STATE_COOKIE); // o state vale uma vez só
    const returned = String(req.query['state'] ?? '');
    const code = String(req.query['code'] ?? '');
    if (req.query['error']) return fail(res, 'cancelado', `Google devolveu "${String(req.query['error'])}"`);
    // O state precisa bater com o do cookie (impede que alguém force um login na sua sessão)
    if (!state || !verifier) return fail(res, 'falha', 'sem o cookie do state (expirou, outro navegador ou cookie bloqueado)');
    if (!code || returned.length !== state.length || !timingSafeEqual(Buffer.from(returned), Buffer.from(state))) {
      return fail(res, 'falha', 'state diferente do enviado');
    }
    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: config().clientId,
          client_secret: config().secret,
          redirect_uri: redirectUri(req),
          grant_type: 'authorization_code',
          code_verifier: verifier,
        }),
      });
      if (!tokenRes.ok) {
        // Ex.: redirect_uri_mismatch (APP_URL ou URI cadastrada diferente), invalid_client (ID/segredo errados)
        const body = (await tokenRes.json().catch(() => ({}))) as { error?: string; error_description?: string };
        return fail(res, 'falha', `troca do código: ${tokenRes.status} ${body.error ?? ''} ${body.error_description ?? ''} · redirect_uri=${redirectUri(req)}`);
      }
      const { access_token } = (await tokenRes.json()) as { access_token?: string };
      const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${access_token}` } });
      if (!infoRes.ok) return fail(res, 'falha', `userinfo: ${infoRes.status}`);
      const info = (await infoRes.json()) as { sub?: string; email?: string; email_verified?: boolean };
      if (!info.sub) return fail(res, 'falha', 'userinfo sem sub');
      const email = (info.email ?? '').trim().toLowerCase();
      if (!(await isAllowedEmail(email))) return fail(res, 'dominio');

      // Mesmo usuário do sistema atual: pelo Google já ligado, ou pelo e-mail verificado (se ainda não ligou outro Google)
      const { rows } = await db().query<{ id: string; nome: string; papel: string; tenantId: string; email: string | null }>(
        `select u.id, u.nome, u.papel, u."tenantId", u.email
           from "Usuario" u join "Tenant" t on t.id = u."tenantId"
          where u.situacao = 'ATIVO' and u."removidoEm" is null and t.ativo
            and (u."googleSub" = $1 or (u."googleSub" is null and $3::boolean and lower(u.email) = $2))`,
        [info.sub, email, info.email_verified === true && !!email],
      );
      if (!rows.length) return fail(res, 'sem-conta');
      // A sessão usa o e-mail do cadastro (a conta pode ter sido achada pelo Google já ligado, com outro e-mail)
      await startSession(res, rows[0].email?.trim().toLowerCase() || email, rows);
      const next = safeNext(parseCookie(req.headers.cookie)[NEXT_COOKIE]);
      setCookie(res, '', 0, NEXT_COOKIE);
      res.redirect(next ?? '/');
    } catch (error) {
      fail(res, 'falha', (error as Error).message);
    }
  });

  return router;
}
