// Análise diária da IA dos Dashboards (às 10h de Brasília) — roda SOMENTE no servidor.
// O Cron da Vercel (vercel.json, 13:00 UTC = 10:00 em Brasília) chama GET /api/cron/analise-ia com o CRON_SECRET.
// Para cada empresa ativa, monta um resumo dos números direto do banco (sprint ativa, atrasos, bloqueios, carga
// por pessoa, velocidade, projetos), pede a análise ao modelo marcado como assistente e guarda o texto em
// lexagile.ia_analise_diaria. O Dashboard mostra essa análise para quem vê tudo da empresa.
import { timingSafeEqual } from 'node:crypto';
import { Request, Response, Router } from 'express';
import { db, ddl, onDbReset } from './db';
import { requireAuth } from './auth';
import { assistantConfig, callModel } from './ai';
import { seesAllTenants } from './data';
import { ensureSchema } from './schema';

export type Painel = 'setores' | 'projetos';
const PAINEIS: Painel[] = ['setores', 'projetos'];

let table: Promise<void> | null = null;
onDbReset(() => {
  table = null;
});
export function ensureTable() {
  table ??= ddl(
    `create schema if not exists lexagile;
     create table if not exists lexagile.ia_analise_diaria (
       "tenantId" text not null references public."Tenant"(id) on delete cascade,
       painel text not null check (painel in ('setores', 'projetos')),
       dia date not null,
       texto text not null,
       erro boolean not null default false,
       "criadoEm" timestamptz not null default now(),
       primary key ("tenantId", painel, dia)
     )`,
  )
    .then(() => undefined)
    .catch((error) => {
      table = null;
      throw error;
    });
  return table;
}

// Dia de hoje no fuso da empresa (AAAA-MM-DD)
export const dayIn = (timeZone: string, now = new Date()) => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);
  }
};

// ---------- Resumo dos números (só a empresa; nada de e-mails, chaves ou tokens) ----------

const GERAL = `a."tenantId" = $1 and a."projetoId" is null and a."arquivadoEm" is null and a.tipo = 'NORMAL'`;

export async function sectorsSummary(tenantId: string, hoje: string) {
  const { rows: sprints } = await db().query(
    `select s.id, s.nome, to_char(p.inicio, 'YYYY-MM-DD') as inicio, to_char(p.fim, 'YYYY-MM-DD') as fim
       from "Sprint" s left join lexagile.sprint_periodo p on p."sprintId" = s.id
      where s."tenantId" = $1 and s.situacao = 'ATIVA' limit 1`,
    [tenantId],
  );
  const sprint = sprints[0];
  if (!sprint) return null;
  const { rows: atividades } = await db().query<{ titulo: string; status: string; prazo: string | null; bloqueada: boolean; responsavel: string | null }>(
    `select a.titulo, a.status, to_char(a.prazo, 'YYYY-MM-DD') as prazo, a."bloqueioMotivo" is not null as bloqueada, u.nome as responsavel
       from "Atividade" a left join "Usuario" u on u.id = a."responsavelId"
      where ${GERAL} and a."sprintId" = $2`,
    [tenantId, sprint.id],
  );
  if (!atividades.length) return null;
  // Velocidade: atividades gerais finalizadas nas 3 últimas sprints fechadas
  const { rows: fechadas } = await db().query<{ nome: string; finalizadas: number }>(
    `select s.nome, count(a.id) filter (where a.status = 'CONCLUIDO')::int as finalizadas
       from "Sprint" s
       left join lexagile.sprint_periodo p on p."sprintId" = s.id
       left join "Atividade" a on a."sprintId" = s.id and a."projetoId" is null and a.tipo = 'NORMAL'
      where s."tenantId" = $1 and s.situacao = 'FECHADA'
      group by s.id, s.nome, p.fim
      order by p.fim desc nulls last, s.nome desc
      limit 3`,
    [tenantId],
  );
  const abertas = atividades.filter((a) => a.status !== 'CONCLUIDO');
  const carga: Record<string, number> = {};
  for (const a of abertas) carga[a.responsavel ?? 'Sem responsável'] = (carga[a.responsavel ?? 'Sem responsável'] ?? 0) + 1;
  return {
    cadencia: 'Scrum, sprints de 7 dias úteis; atividades gerais dos setores contadas uma a uma',
    hoje,
    sprint: {
      nome: sprint.nome,
      periodo: sprint.inicio && sprint.fim ? `${sprint.inicio} a ${sprint.fim}` : 'sem período cadastrado',
      total: atividades.length,
      finalizadas: atividades.length - abertas.length,
      emAndamento: abertas.filter((a) => ['EM_EXECUCAO', 'EM_REVISAO'].includes(a.status) && !a.bloqueada).length,
      bloqueadas: abertas.filter((a) => a.bloqueada).length,
    },
    finalizadasNasUltimasSprints: fechadas.map((s) => ({ sprint: s.nome, finalizadas: s.finalizadas })),
    bloqueadas: abertas.filter((a) => a.bloqueada).map((a) => ({ atividade: a.titulo, responsavel: a.responsavel })),
    atrasadas: abertas.filter((a) => a.prazo && a.prazo < hoje).map((a) => ({ atividade: a.titulo, responsavel: a.responsavel, prazo: a.prazo })),
    cargaEmAbertoPorPessoa: carga,
  };
}

export async function projectsSummary(tenantId: string, hoje: string) {
  const { rows: projetos } = await db().query<{ nome: string; total: number; concluidas: number; atrasadas: number; previsao: string | null }>(
    `select p.nome, count(a.id)::int as total,
            count(a.id) filter (where a.status = 'CONCLUIDO')::int as concluidas,
            count(a.id) filter (where a.status <> 'CONCLUIDO' and a.prazo::date < $2::date)::int as atrasadas,
            to_char(p."previsaoTermino", 'YYYY-MM-DD') as previsao
       from "Projeto" p
       left join "Atividade" a on a."projetoId" = p.id and a."arquivadoEm" is null and a.tipo = 'NORMAL'
      where p."tenantId" = $1 and not p.arquivado
      group by p.id, p.nome, p."previsaoTermino"
     having count(a.id) > 0
      order by p.nome`,
    [tenantId, hoje],
  );
  if (!projetos.length) return null;
  const { rows: atrasadas } = await db().query(
    `select a.titulo as atividade, p.nome as projeto, u.nome as responsavel, to_char(a.prazo, 'YYYY-MM-DD') as prazo
       from "Atividade" a join "Projeto" p on p.id = a."projetoId" left join "Usuario" u on u.id = a."responsavelId"
      where a."tenantId" = $1 and a."arquivadoEm" is null and a.tipo = 'NORMAL' and not p.arquivado
        and a.status <> 'CONCLUIDO' and a.prazo::date < $2::date
      order by a.prazo limit 20`,
    [tenantId, hoje],
  );
  const { rows: carga } = await db().query<{ nome: string; abertas: number }>(
    `select coalesce(u.nome, 'Sem responsável') as nome, count(*)::int as abertas
       from "Atividade" a join "Projeto" p on p.id = a."projetoId" left join "Usuario" u on u.id = a."responsavelId"
      where a."tenantId" = $1 and a."arquivadoEm" is null and a.tipo = 'NORMAL' and not p.arquivado and a.status <> 'CONCLUIDO'
      group by 1 order by 2 desc limit 10`,
    [tenantId],
  );
  return {
    cadencia: 'Scrum, sprints de 7 dias úteis',
    hoje,
    projetos: projetos.map((p) => ({
      nome: p.nome,
      progresso: `${Math.round((p.concluidas / p.total) * 100)}%`,
      atividades: p.total,
      atrasadas: p.atrasadas,
      previsaoTermino: p.previsao ?? 'sem previsão',
    })),
    atividadesAtrasadas: atrasadas,
    emAbertoPorPessoa: Object.fromEntries(carga.map((c) => [c.nome, c.abertas])),
  };
}

const PROMPTS: Record<Painel, string> = {
  setores: 'Você é um gestor experiente de times que trabalham com Scrum. Analise os dados das atividades gerais dos setores da empresa',
  projetos: 'Você é um gestor de projetos ágeis experiente. Analise os dados dos projetos da empresa',
};

export function promptFor(painel: Painel, empresa: string, data: unknown) {
  return `${PROMPTS[painel]} ${empresa}.
Responda em português, em texto simples (sem tabelas), com:
1. Diagnóstico em 2 ou 3 frases (andamento e previsibilidade).
2. Principais riscos (bloqueios, atrasos, sobrecarga de pessoas).
3. Até 5 ações de melhoria concretas, dizendo o que fazer e quem deve agir.

Dados:
${JSON.stringify(data, null, 2)}`;
}

// ---------- A rodada das 10h ----------

export async function runDailyAnalysis(now = new Date()) {
  const config = await assistantConfig();
  if (!config) return { ok: false, motivo: 'Nenhum modelo de IA configurado.', feitas: 0, falhas: 0, puladas: 0 };
  if (!(await ensureSchema())) return { ok: false, motivo: 'Banco sem o schema do LexÁgile.', feitas: 0, falhas: 0, puladas: 0 };
  await ensureTable();
  const { rows: empresas } = await db().query<{ id: string; nome: string; fusoHorario: string }>(
    `select id, nome, "fusoHorario" from "Tenant" where ativo order by ordem, nome`,
  );
  const jobs = empresas.flatMap((t) => PAINEIS.map((painel) => ({ t, painel, hoje: dayIn(t.fusoHorario, now) })));
  let feitas = 0;
  let falhas = 0;
  let puladas = 0;
  // Em paralelo: a função da Vercel tem tempo limitado (vercel.json); cada chamada à IA tem 25s
  await Promise.all(
    jobs.map(async ({ t, painel, hoje }) => {
      const { rows: ja } = await db().query(`select 1 from lexagile.ia_analise_diaria where "tenantId" = $1 and painel = $2 and dia = $3 and not erro`, [t.id, painel, hoje]);
      const data = ja.length ? null : painel === 'setores' ? await sectorsSummary(t.id, hoje) : await projectsSummary(t.id, hoje);
      if (!data) return void puladas++; // já feita hoje, ou nada para analisar
      let texto: string;
      let erro = false;
      try {
        texto = (await callModel(config, [{ role: 'user', content: promptFor(painel, t.nome, data) }], 25_000)).reply || '(a IA não respondeu nada)';
        feitas++;
      } catch (error) {
        texto = error instanceof Error ? error.message : 'A IA não respondeu.';
        erro = true;
        falhas++;
      }
      await db().query(
        `insert into lexagile.ia_analise_diaria ("tenantId", painel, dia, texto, erro) values ($1, $2, $3, $4, $5)
         on conflict ("tenantId", painel, dia) do update set texto = excluded.texto, erro = excluded.erro, "criadoEm" = now()`,
        [t.id, painel, hoje, texto, erro],
      );
    }),
  );
  return { ok: true, feitas, falhas, puladas };
}

// Só a Vercel (com o CRON_SECRET) dispara a rodada
export function cronAuthorized(header: string | undefined, secret = process.env['CRON_SECRET']) {
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header ?? '');
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export function cronRouter() {
  const router = Router();
  router.get('/analise-ia', async (req: Request, res: Response) => {
    if (!process.env['CRON_SECRET']) return void res.status(503).json({ error: 'Defina a variável CRON_SECRET no servidor.' });
    if (!cronAuthorized(req.headers.authorization)) return void res.status(401).json({ error: 'Não autorizado.' });
    try {
      const result = await runDailyAnalysis();
      console.log('[cron] análise diária da IA:', JSON.stringify(result));
      res.json(result);
    } catch (error) {
      console.error('[cron] análise diária da IA falhou:', (error as Error).message);
      res.status(500).json({ error: 'A rodada falhou.' });
    }
  });
  return router;
}

// O Dashboard lê a análise mais recente da empresa — só quem vê tudo dela (a análise cita atividades de todos)
export function dailyAnalysisRouter() {
  const router = Router();
  router.get('/analise-diaria', requireAuth, async (req: Request, res: Response) => {
    const empresa = String(req.query['empresa'] ?? '');
    const painel = String(req.query['painel'] ?? '') as Painel;
    if (!PAINEIS.includes(painel) || !empresa || empresa.length > 60) return void res.status(400).json({ error: 'Parâmetros inválidos.' });
    try {
      const installed = await ensureSchema();
      if (!(await seesAllTenants(req.session!, installed)).includes(empresa)) return void res.status(403).json({ error: 'Sem acesso a esta análise.' });
      await ensureTable();
      const { rows } = await db().query(
        `select to_char(dia, 'YYYY-MM-DD') as dia, texto, erro, "criadoEm" from lexagile.ia_analise_diaria
          where "tenantId" = $1 and painel = $2 order by dia desc limit 1`,
        [empresa, painel],
      );
      res.json(rows[0] ?? null);
    } catch (error) {
      console.error('[analise-diaria]', (error as Error).message);
      res.status(500).json({ error: 'Não foi possível carregar a análise.' });
    }
  });
  return router;
}
