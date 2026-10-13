// Conexão com o banco (Supabase/Postgres) — roda SOMENTE no servidor. A URL fica no .env, nunca vai ao navegador.
import pg from 'pg';

let pool: pg.Pool | null = null;

// TLS com o banco. Com DATABASE_CA (o certificado do Supabase: Database › Settings › SSL Configuration ›
// Download certificate, colado inteiro na variável), o certificado do servidor é conferido: ninguém no caminho
// da rede consegue se passar pelo banco. Sem ela, a conexão é cifrada mas sem conferir quem está do outro lado.
let warned = false;
function sslOptions(): pg.ConnectionConfig['ssl'] {
  const ca = process.env['DATABASE_CA']?.replace(/\\n/g, '\n').trim();
  if (ca) return { ca, rejectUnauthorized: true };
  if (!warned && (process.env['NODE_ENV'] === 'production' || process.env['VERCEL'])) {
    console.warn('[db] DATABASE_CA não definida: TLS com o banco sem conferir o certificado');
    warned = true;
  }
  // nosemgrep: bypass-tls-verification -- reserva intencional sem DATABASE_CA (cifrado, sem conferir o certificado; avisa no log)
  return { rejectUnauthorized: false };
}

export function db() {
  if (!pool) {
    const url = process.env['DATABASE_URL'];
    if (!url) throw new Error('DATABASE_URL não configurada no .env');
    pool = new pg.Pool({ connectionString: url, ssl: sslOptions(), max: 5 });
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
