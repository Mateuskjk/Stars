// Domínios de e-mail com acesso ao LexÁgile — roda SOMENTE no servidor.
// Só entra quem já tem usuário no banco E e-mail de um domínio desta lista (login com senha, com Google e convites).
import { Router, json } from 'express';
import { db } from './db';
import { requireAuth, SUPERADMIN_ONLY, isSuperAdmin } from './auth';

// Lista inicial (e reserva, se o banco não responder: nesse caso só estes entram)
export const DEFAULT_DOMAINS = ['luisalbertadv.com.br', 'nicolasgomesadv.com.br', 'lexgroup.com.br'];
const DOMAIN_RE = /^(?=.{3,120}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const CACHE_MS = 60_000;

let table: Promise<void> | null = null;
let cache: { list: string[]; at: number } | null = null;

// Cria a tabela na primeira vez, já com os domínios iniciais
function ensureTable() {
  table ??= db()
    .query(
      `create schema if not exists lexagile;
       do $$ begin
         if to_regclass('lexagile.dominio') is null then
           create table lexagile.dominio (dominio text primary key, "criadoEm" timestamptz not null default now(), "criadoPor" text);
           insert into lexagile.dominio (dominio) values ${DEFAULT_DOMAINS.map((d) => `('${d}')`).join(', ')};
         end if;
       end $$;`,
    )
    .then(() => undefined)
    .catch((error) => {
      table = null;
      throw error;
    });
  return table;
}

export async function allowedDomains(): Promise<string[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.list;
  try {
    await ensureTable();
    const { rows } = await db().query<{ dominio: string }>(`select dominio from lexagile.dominio order by dominio`);
    cache = { list: rows.map((r) => r.dominio), at: Date.now() };
    return cache.list;
  } catch (error) {
    console.error('[dominios] usando a lista padrão:', (error as Error).message);
    return DEFAULT_DOMAINS;
  }
}

// Domínio do e-mail. Exatamente um "@" (x@empresa.com.br@outro.com não passa como empresa.com.br)
export const domainOf = (email: string) => {
  const parts = email.trim().toLowerCase().split('@');
  return parts.length === 2 && parts[0] ? parts[1] : '';
};

export async function isAllowedEmail(email: string) {
  const domain = domainOf(email);
  return !!domain && (await allowedDomains()).includes(domain);
}

// Configurações › Membros: ver (todos logados), adicionar e remover (só superadmin: a lista vale para todas as empresas)
export function domainsRouter() {
  const router = Router();
  router.use(requireAuth, json({ limit: '5kb' }));

  router.get('/dominios', async (_req, res) => void res.json(await allowedDomains()));

  router.post('/dominios', async (req, res) => {
    if (!isSuperAdmin(req.session!)) {
      res.status(403).json({ error: SUPERADMIN_ONLY });
      return;
    }
    const dominio = String(req.body?.dominio ?? '')
      .trim()
      .toLowerCase()
      .replace(/^@/, '');
    if (!DOMAIN_RE.test(dominio)) {
      res.status(400).json({ error: 'Domínio inválido. Use o formato empresa.com.br (sem o @).' });
      return;
    }
    try {
      await ensureTable();
      await db().query(`insert into lexagile.dominio (dominio, "criadoPor") values ($1, $2) on conflict do nothing`, [dominio, req.session!.email]);
      cache = null;
      console.log(`[dominios] ${req.session!.email} adicionou ${dominio}`);
      res.json(await allowedDomains());
    } catch (error) {
      console.error('[dominios]', (error as Error).message);
      res.status(500).json({ error: 'Não foi possível salvar o domínio.' });
    }
  });

  router.delete('/dominios/:dominio', async (req, res) => {
    if (!isSuperAdmin(req.session!)) {
      res.status(403).json({ error: SUPERADMIN_ONLY });
      return;
    }
    const dominio = String(req.params['dominio']).toLowerCase();
    // Não deixa o Admin se trancar para fora
    if (dominio === domainOf(req.session!.email)) {
      res.status(400).json({ error: 'Você não pode remover o domínio do seu próprio e-mail.' });
      return;
    }
    try {
      await ensureTable();
      await db().query(`delete from lexagile.dominio where dominio = $1`, [dominio]);
      cache = null;
      console.log(`[dominios] ${req.session!.email} removeu ${dominio}`);
      res.json(await allowedDomains());
    } catch (error) {
      console.error('[dominios]', (error as Error).message);
      res.status(500).json({ error: 'Não foi possível remover o domínio.' });
    }
  });

  return router;
}
