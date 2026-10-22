// Minha conta (perfil e preferências de cada pessoa) — roda SOMENTE no servidor.
// Fica no banco pelo e-mail do login: sobrevive ao "Sair" (que limpa o navegador) e vale em qualquer computador.
import { Router, json } from 'express';
import { requireAuth } from './auth';
import { db, ddl, onDbReset } from './db';

const MAX_BYTES = 300_000; // a foto já vem reduzida (256 px); o resto é texto curto

let table: Promise<void> | null = null;
onDbReset(() => {
  table = null;
});
export function ensureTable() {
  table ??= ddl(
    `create schema if not exists lexagile;
     create table if not exists lexagile.conta (email text primary key, dados jsonb not null, "atualizadoEm" timestamptz not null default now());`,
  )
    .then(() => undefined)
    .catch((error) => {
      table = null;
      throw error;
    });
  return table;
}

export function accountRouter() {
  const router = Router();
  router.use('/conta', requireAuth, json({ limit: '400kb' }));

  router.get('/conta', async (req, res) => {
    await ensureTable();
    const { rows } = await db().query<{ dados: unknown }>(`select dados from lexagile.conta where email = $1`, [req.session!.email.toLowerCase()]);
    res.json({ dados: rows[0]?.dados ?? null });
  });

  router.put('/conta', async (req, res) => {
    const dados: unknown = req.body?.dados;
    if (!dados || typeof dados !== 'object' || Array.isArray(dados)) return void res.status(400).json({ error: 'Conta inválida.' });
    const text = JSON.stringify(dados);
    if (text.length > MAX_BYTES) return void res.status(413).json({ error: 'Conta grande demais (foto muito pesada?).' });
    await ensureTable();
    await db().query(
      `insert into lexagile.conta (email, dados) values ($1, $2::jsonb)
       on conflict (email) do update set dados = excluded.dados, "atualizadoEm" = now()`,
      [req.session!.email.toLowerCase(), text],
    );
    res.status(204).end();
  });

  return router;
}
