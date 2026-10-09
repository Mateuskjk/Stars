// Conexão com o banco (Supabase/Postgres) — roda SOMENTE no servidor. A URL fica no .env, nunca vai ao navegador.
import pg from 'pg';

let pool: pg.Pool | null = null;

export function db() {
  if (!pool) {
    const url = process.env['DATABASE_URL'];
    if (!url) throw new Error('DATABASE_URL não configurada no .env');
    // ponytail: TLS sem validar o certificado do pooler; para validar, baixe o CA do Supabase e passe em ssl.ca
    pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 5 });
  }
  return pool;
}

// Campos que o banco guarda como texto JSON ('[]', '{}')
export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
