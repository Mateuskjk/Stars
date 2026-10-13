// Limites de tentativas e de uso (login, API pública, assistente de IA) — roda SOMENTE no servidor.
// Os contadores ficam no banco (lexagile.limite): valem em todas as cópias do servidor na Vercel e
// sobrevivem a reinícios. Sem banco (testes, desenvolvimento offline), ficam na memória.
import { db } from './db';

let table: Promise<boolean> | null = null;
function ensureTable() {
  table ??= Promise.resolve() // sem DATABASE_URL, db() lança na hora: vira "sem banco" e cai para a memória
    .then(() =>
      db().query(
        `create schema if not exists lexagile;
         create table if not exists lexagile.limite (chave text primary key, n int not null, desde timestamptz not null)`,
      ),
    )
    .then(() => true)
    .catch(() => {
      table = null;
      return false;
    });
  return table;
}

const memory = new Map<string, { n: number; since: number }>();

// Soma 1 no contador da janela (que recomeça depois de windowS segundos) e devolve o total
export async function hit(key: string, windowS: number): Promise<number> {
  if (await ensureTable()) {
    try {
      const { rows } = await db().query<{ n: number }>(
        `insert into lexagile.limite (chave, n, desde) values ($1, 1, now())
         on conflict (chave) do update set
           n = case when lexagile.limite.desde < now() - make_interval(secs => $2) then 1 else lexagile.limite.n + 1 end,
           desde = case when lexagile.limite.desde < now() - make_interval(secs => $2) then now() else lexagile.limite.desde end
         returning n`,
        [key, windowS],
      );
      if (Math.random() < 0.01) void db().query(`delete from lexagile.limite where desde < now() - interval '1 day'`).catch(() => undefined);
      return rows[0].n;
    } catch {
      // banco indisponível: cai para a memória
    }
  }
  const now = Date.now();
  const current = memory.get(key);
  if (!current || now - current.since >= windowS * 1000) {
    memory.set(key, { n: 1, since: now });
    if (memory.size > 10_000) memory.clear(); // ponytail: sem banco, não deixa a memória crescer sem fim
    return 1;
  }
  return ++current.n;
}

// Quantas vezes nesta janela (sem somar)
export async function count(key: string, windowS: number): Promise<number> {
  if (await ensureTable()) {
    try {
      const { rows } = await db().query<{ n: number }>(
        `select n from lexagile.limite where chave = $1 and desde >= now() - make_interval(secs => $2)`,
        [key, windowS],
      );
      return rows[0]?.n ?? 0;
    } catch {
      // banco indisponível: cai para a memória
    }
  }
  const current = memory.get(key);
  return current && Date.now() - current.since < windowS * 1000 ? current.n : 0;
}

export async function reset(key: string) {
  memory.delete(key);
  if (await ensureTable()) await db().query(`delete from lexagile.limite where chave = $1`, [key]).catch(() => undefined);
}
