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

// Testes (testing/test-db.ts): um Postgres em memória no lugar do banco real. Nunca usado em produção.
export function setDbForTests(fake: pg.Pool) {
  pool = fake;
}

export function db() {
  if (!pool) {
    const url = process.env['DATABASE_URL'];
    if (!url) throw new Error('DATABASE_URL não configurada no .env');
    pool = new pg.Pool({ connectionString: url, ssl: sslOptions(), max: 5 });
  }
  return pool;
}

// DDL (criar o que falta no schema lexagile). O usuário restrito do app (lexagile_app) NÃO tem permissão de DDL:
// nesse caso as tabelas já foram criadas pelo "npm run db:migrate" (com o usuário dono do banco) e o app segue.
let warnedDdl = false;
export async function ddl(sql: string) {
  try {
    await db().query(sql);
  } catch (error) {
    if ((error as { code?: string }).code !== '42501') throw error; // 42501 = sem permissão
    if (!warnedDdl) console.warn('[db] usuário sem permissão de DDL: as tabelas vêm do "npm run db:migrate"');
    warnedDdl = true;
  }
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
