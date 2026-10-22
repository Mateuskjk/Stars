// Banco de TESTE: um Postgres de verdade rodando em memória (PGlite), com a estrutura das tabelas do sistema
// (schema.sql, sem dados) e o schema lexagile do próprio app. Nada aqui toca o banco real.
// Como em produção: as tabelas são criadas pelo dono (migrateAll) e o app roda como o usuário RESTRITO
// lexagile_app (scripts/db-role.sql) — se faltar alguma permissão, os testes quebram aqui e não em produção.
// Duas empresas fictícias: A (com um usuário de cada papel, visibilidade RESTRITA) e B (só um Dono).
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import express from 'express';
import type { Pool } from 'pg';
import { setDbForTests } from '../db';
import { authRouter, ensureSessionTable, requireAuth } from '../auth';
import { INSTALL_SQL } from '../schema';
import { dataRouter } from '../data';
import { writesRouter } from '../writes';
import { notesRouter } from '../notes';
import { accountRouter } from '../account';
import { attachmentsRouter } from '../attachments';
import { domainsRouter } from '../domains';
import { publicApiInternalRouter, publicApiRouter } from '../public-api';
import { integrationsRouter } from '../integrations';
import { csrfGuard } from '../security-headers';
import { aiRouter } from '../ai';
import { migrateAll } from '../migrate-all';

export const A = 'tenant-a';
export const B = 'tenant-b';
export type Who = 'donoA' | 'gestorA' | 'atendenteA' | 'observadorA' | 'donoB';
const USERS: Record<Who, { id: string; papel: string; tenantId: string; email: string }> = {
  donoA: { id: 'u-dono-a', papel: 'DONO', tenantId: A, email: 'dono.a@lexgroup.com.br' },
  gestorA: { id: 'u-gestor-a', papel: 'GESTOR', tenantId: A, email: 'gestor.a@lexgroup.com.br' },
  atendenteA: { id: 'u-atendente-a', papel: 'ATENDENTE', tenantId: A, email: 'atendente.a@lexgroup.com.br' },
  observadorA: { id: 'u-observador-a', papel: 'OBSERVADOR', tenantId: A, email: 'observador.a@lexgroup.com.br' },
  donoB: { id: 'u-dono-b', papel: 'DONO', tenantId: B, email: 'dono.b@lexgroup.com.br' },
};

// Ids dos registros de exemplo (usados nos testes)
export const IDS = {
  setorDoAtendente: 'setor-a1',
  outroSetor: 'setor-a2',
  projetoVisivel: 'proj-a-visivel', // do setor do atendente
  projetoEscondido: 'proj-a-escondido', // de outro setor, sem nada do atendente
  projetoB: 'proj-b',
  atividadeDoAtendente: 'ativ-a-atendente',
  atividadeEscondida: 'ativ-a-escondida',
  atividadeB: 'ativ-b',
  sprintAtivaA: 'sprint-a-ativa',
  sprintFechadaA: 'sprint-a-fechada',
};

const SEED = `
insert into "Tenant" (id, nome, sigla) values ('${A}', 'Empresa A', 'EA'), ('${B}', 'Empresa B', 'EB');
insert into "Usuario" (id, nome, email, papel, "tenantId") values
  ${Object.values(USERS).map((u) => `('${u.id}', '${u.id}', '${u.email}', '${u.papel}', '${u.tenantId}')`).join(',\n  ')};
insert into "Setor" (id, nome, "tenantId", "atualizadoEm") values
  ('setor-a1', 'Setor 1', '${A}', now()), ('setor-a2', 'Setor 2', '${A}', now()), ('setor-b1', 'Setor B', '${B}', now());
insert into lexagile.setor_membro ("setorId", "usuarioId", gestor) values ('setor-a1', 'u-atendente-a', false), ('setor-a1', 'u-observador-a', false);
insert into lexagile.empresa_config ("tenantId", visibilidade) values ('${A}', 'RESTRITA'), ('${B}', 'RESTRITA');
insert into "Projeto" (id, numero, nome, "dataInicio", "responsavelId", "tenantId", "setorId", "atualizadoEm") values
  ('proj-a-visivel', 1, 'Projeto visível', now(), 'u-dono-a', '${A}', 'setor-a1', now()),
  ('proj-a-escondido', 2, 'Projeto escondido', now(), 'u-dono-a', '${A}', 'setor-a2', now()),
  ('proj-b', 1, 'Projeto B', now(), 'u-dono-b', '${B}', 'setor-b1', now());
insert into lexagile.extra (tipo, "registroId", "tenantId", dados) values
  ('projeto', 'proj-a-escondido', '${A}', '{"segredo": true}'), ('projeto', 'proj-a-visivel', '${A}', '{}');
insert into "Sprint" (id, nome, situacao, "tenantId") values
  ('sprint-a-ativa', 'Sprint 1', 'ATIVA', '${A}'), ('sprint-a-fechada', 'Sprint 0', 'FECHADA', '${A}');
insert into "Atividade" (id, numero, titulo, "tenantId", "projetoId", "responsavelId", "criadoPorId", "atualizadoEm") values
  ('ativ-a-atendente', 1, 'Do atendente', '${A}', null, 'u-atendente-a', 'u-atendente-a', now()),
  ('ativ-a-escondida', 2, 'Escondida', '${A}', 'proj-a-escondido', 'u-dono-a', 'u-dono-a', now()),
  ('ativ-b', 1, 'Da empresa B', '${B}', null, 'u-dono-b', 'u-dono-b', now());
`;

export interface TestEnv {
  db: PGlite;
  call: (who: Who | null, method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; data: any }>;
  // Corpo e resposta crus (upload e download de arquivos)
  raw: (who: Who | null, method: string, path: string, body?: string, headers?: Record<string, string>) => Promise<{ status: number; text: string; headers: Headers; data: any }>;
  close: () => Promise<void>;
}

export async function startTestEnv(): Promise<TestEnv> {
  const pglite = new PGlite();
  // Adaptador com a mesma cara do Pool do "pg" (query, connect/release)
  const query = async (text: string, params?: unknown[]) => {
    if (!params?.length) {
      const results = await pglite.exec(text); // aceita vários comandos (os "create table ...; ..." do app)
      const last = results[results.length - 1];
      return { rows: last?.rows ?? [], rowCount: last?.affectedRows ?? last?.rows.length ?? 0 };
    }
    const r = await pglite.query(text, params);
    return { rows: r.rows, rowCount: r.affectedRows || r.rows.length };
  };
  setDbForTests({ query, connect: async () => ({ query, release() {} }), end: async () => undefined } as unknown as Pool);

  await pglite.exec(readFileSync('src/server/testing/schema.sql', 'utf8'));
  await pglite.exec(`create schema if not exists lexagile; ${INSTALL_SQL}`);
  await ensureSessionTable();
  await pglite.exec(SEED);
  await migrateAll();

  // Uma sessão de verdade (cookie) para cada pessoa
  const cookies = {} as Record<Who, string>;
  for (const [who, u] of Object.entries(USERS) as [Who, (typeof USERS)[Who]][]) {
    const token = randomBytes(32).toString('base64url');
    await pglite.query(`insert into lexagile.sessao ("tokenHash", nome, email, memberships, "expiraEm") values ($1, $2, $3, $4, now() + interval '1 hour')`, [
      createHash('sha256').update(token).digest('hex'),
      u.id,
      u.email,
      JSON.stringify([{ usuarioId: u.id, tenantId: u.tenantId, papel: u.papel }]),
    ]);
    cookies[who] = `__Host-lex_session=${token}`;
  }

  // Daqui em diante, tudo roda como o usuário restrito do app
  await pglite.exec(readFileSync('scripts/db-role.sql', 'utf8').replace('TROQUE-ESTA-SENHA', randomBytes(16).toString('hex')));
  await pglite.exec('set role lexagile_app');

  // As mesmas rotas e na mesma ordem do server.ts (sem o Angular)
  const app = express();
  app.use(csrfGuard);
  app.use('/api/auth', authRouter());
  app.use('/api/data', dataRouter());
  app.use('/api/data', writesRouter());
  app.use('/api/data', domainsRouter());
  app.use('/api/data', notesRouter());
  app.use('/api/data', accountRouter());
  app.use('/api/data', attachmentsRouter());
  app.use('/api/v1', publicApiRouter());
  app.use('/api/internal', requireAuth, publicApiInternalRouter());
  app.use('/api/integrations', requireAuth, integrationsRouter());
  app.use('/api/ai', requireAuth, aiRouter());
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  return {
    db: pglite,
    async call(who, method, path, body, headers = {}) {
      const r = await fetch(base + path, {
        method,
        headers: { 'content-type': 'application/json', ...(who ? { cookie: cookies[who] } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await r.text();
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return { status: r.status, data };
    },
    async raw(who, method, path, body, headers = {}) {
      const r = await fetch(base + path, { method, headers: { ...(who ? { cookie: cookies[who] } : {}), ...headers }, body });
      const text = await r.text();
      let data: unknown = text;
      try {
        data = JSON.parse(text);
      } catch {
        // não é JSON (arquivo)
      }
      return { status: r.status, text, headers: r.headers, data };
    },
    async close() {
      server.close();
      await pglite.close();
    },
  };
}
