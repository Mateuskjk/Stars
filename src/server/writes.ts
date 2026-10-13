// Gravação das telas no banco (atividades, sprints e configurações) — roda SOMENTE no servidor.
// Toda escrita: exige login, recusa Observador (só leitura), só mexe no que a pessoa pode ver
// (mesma regra da leitura) e só aceita referências (responsável, sprint, setor, projeto) da mesma empresa.
import { Request, Response, Router, json } from 'express';
import type { PoolClient } from 'pg';
import { db } from './db';
import { Session, requireAuth } from './auth';
import { HttpError, createTenant, ensureSchema, newId } from './migration';
import { meOf, seesAllTenants, tenantsOf, visibleActivitySql } from './data';
import { isAllowedEmail } from './domains';

const STATUSES = ['RASCUNHO', 'PRONTO', 'EM_EXECUCAO', 'EM_REVISAO', 'CONCLUIDO'];
const SPRINT_SITUACOES = ['ATIVA', 'FECHADA', 'PREPARACAO'];

const membership = (s: Session, tenantId: string) => s.memberships.find((m) => m.tenantId === tenantId);

export function writer(s: Session, tenantId: string) {
  const m = membership(s, tenantId);
  if (!m) throw new HttpError(404, 'Empresa não encontrada.');
  if (m.papel === 'OBSERVADOR') throw new HttpError(403, 'Seu acesso nesta empresa é só leitura.');
  return m;
}

function manager(s: Session, tenantId: string) {
  const m = writer(s, tenantId);
  if (m.papel !== 'DONO' && m.papel !== 'GESTOR') throw new HttpError(403, 'Só Admin e Supervisor mexem nas sprints.');
  return m;
}

const text = (v: unknown, max: number, field: string) => {
  if (typeof v !== 'string' || v.length > max) throw new HttpError(400, `Campo inválido: ${field}.`);
  return v;
};
const nonEmpty = (v: unknown, max: number, field: string) => {
  const s = text(v, max, field).trim();
  if (!s) throw new HttpError(400, `Preencha: ${field}.`);
  return s;
};
const isoDateOrNull = (v: unknown) => {
  if (v === null || v === '') return null;
  const s = text(v, 10, 'data');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s))) throw new HttpError(400, 'Data inválida.');
  return s;
};
const idOrNull = (v: unknown, field: string) => (v == null || v === '' ? null : nonEmpty(v, 60, field));
const has = (body: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(body, key);

// O registro existe e é da empresa?
async function sameTenant(client: PoolClient, table: string, ids: string[], tenantId: string, field: string) {
  if (!ids.length) return;
  const { rows } = await client.query(`select count(*)::int as n from "${table}" where id = any($1::text[]) and "tenantId" = $2`, [ids, tenantId]);
  if (rows[0].n !== new Set(ids).size) throw new HttpError(400, `${field} de outra empresa ou inexistente.`);
}

// A atividade existe e a pessoa pode vê-la? Devolve a empresa dela
export async function visibleActivity(client: PoolClient, s: Session, id: string) {
  const installed = await ensureSchema();
  const { rows } = await client.query(`select a."tenantId" from "Atividade" a where ${visibleActivitySql(installed)} and a.id = $4`, [
    tenantsOf(s),
    meOf(s),
    await seesAllTenants(s, installed),
    id,
  ]);
  if (!rows[0]) throw new HttpError(404, 'Atividade não encontrada.');
  return rows[0].tenantId as string;
}

// Aplica as mudanças enviadas (só os campos presentes no corpo)
export async function applyActivity(client: PoolClient, s: Session, id: string, tenantId: string, body: Record<string, unknown>) {
  const me = writer(s, tenantId).usuarioId;
  const installed = await ensureSchema();
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => sets.push(`"${column}" = $${values.push(value)}`);

  if (has(body, 'titulo')) set('titulo', nonEmpty(body['titulo'], 300, 'título'));
  if (has(body, 'descricao')) set('descricao', text(body['descricao'], 20000, 'descrição'));
  if (has(body, 'prazo')) set('prazo', isoDateOrNull(body['prazo']));
  if (has(body, 'estimativa')) {
    const n = body['estimativa'];
    if (n !== null && !(Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 1000)) throw new HttpError(400, 'Estimativa inválida.');
    set('estimativa', n);
  }
  if (has(body, 'status')) {
    if (!STATUSES.includes(body['status'] as string)) throw new HttpError(400, 'Status inválido.');
    set('status', body['status']);
    // Histórico de movimentações (Daily e o sistema atual), no mesmo formato das mudanças manuais de lá
    await client.query(
      `insert into "Transicao" (id, "regraId", "regraTitulo", de, para, porque, "atividadeId")
       select $1, 'MANUAL', 'Movido manualmente', status, $2, 'Alguém moveu o cartão no LexÁgile', id
         from "Atividade" where id = $3 and status <> $2`,
      [newId(), body['status'], id],
    );
  }
  if (has(body, 'responsavelId')) {
    const responsavelId = idOrNull(body['responsavelId'], 'responsável');
    if (responsavelId) await sameTenant(client, 'Usuario', [responsavelId], tenantId, 'Responsável');
    set('responsavelId', responsavelId);
  }
  if (has(body, 'compartilhadoCom')) {
    const list = body['compartilhadoCom'];
    if (!Array.isArray(list) || list.length > 50) throw new HttpError(400, 'Compartilhamento inválido.');
    const ids = list.map((v) => nonEmpty(v, 60, 'compartilhado com'));
    await sameTenant(client, 'Usuario', ids, tenantId, 'Pessoa compartilhada');
    set('compartilhadoCom', JSON.stringify([...new Set(ids)]));
  }
  if (has(body, 'tags')) {
    const list = body['tags'];
    if (!Array.isArray(list) || list.length > 30) throw new HttpError(400, 'Tags inválidas.');
    set('tags', JSON.stringify(list.map((t) => nonEmpty(t, 40, 'tag'))));
  }
  if (has(body, 'sprintId')) {
    const sprintId = idOrNull(body['sprintId'], 'sprint');
    if (sprintId) await sameTenant(client, 'Sprint', [sprintId], tenantId, 'Sprint');
    set('sprintId', sprintId);
  }
  if (has(body, 'bloqueado')) {
    sets.push(body['bloqueado'] === true ? `"bloqueioMotivo" = coalesce("bloqueioMotivo", 'Bloqueado no LexÁgile')` : `"bloqueioMotivo" = null`);
  }
  if (has(body, 'arquivado')) {
    const tipo = body['arquivado'];
    if (tipo !== null && tipo !== 'ARQUIVADO' && tipo !== 'CANCELADO') throw new HttpError(400, 'Arquivamento inválido.');
    if (tipo) {
      set('arquivadoTipo', tipo);
      set('arquivadoPorId', me);
      sets.push(`"arquivadoEm" = now()`);
    } else {
      sets.push(`"arquivadoEm" = null`, `"arquivadoTipo" = null`, `"arquivadoPorId" = null`);
    }
  }
  sets.push(`"atualizadoEm" = now()`);
  await client.query(`update "Atividade" set ${sets.join(', ')} where id = $${values.push(id)}`, values);

  // ---------- Extras do LexÁgile (schema "lexagile") ----------
  if (installed && has(body, 'setorGeral')) {
    const setorId = idOrNull(body['setorGeral'], 'setor');
    if (setorId) {
      await sameTenant(client, 'Setor', [setorId], tenantId, 'Setor');
      await client.query(
        `insert into lexagile.atividade_setor ("atividadeId", "setorId") values ($1, $2)
         on conflict ("atividadeId") do update set "setorId" = excluded."setorId"`,
        [id, setorId],
      );
    } else {
      await client.query(`delete from lexagile.atividade_setor where "atividadeId" = $1`, [id]);
    }
  }
  // Coluna exata do kanban e categoria da Planning (o banco só tem 5 status); nomes de coluna de uma lista fixa
  const frontCols = ['colunaBacklog', 'colunaSprint', 'planning'].filter((k) => has(body, k));
  if (installed && frontCols.length) {
    const vals = frontCols.map((k) => (body[k] === null ? null : nonEmpty(body[k], 60, 'coluna')));
    await client.query(
      `insert into lexagile.atividade_front ("atividadeId", ${frontCols.map((c) => `"${c}"`).join(', ')})
       values ($1, ${frontCols.map((_, i) => `$${i + 2}`).join(', ')})
       on conflict ("atividadeId") do update set ${frontCols.map((c) => `"${c}" = excluded."${c}"`).join(', ')}`,
      [id, ...vals],
    );
  }

  // ---------- Subtarefas (substitui a lista), favorito (de quem está logado) e comentário novo ----------
  if (has(body, 'subtarefas')) {
    const list = body['subtarefas'];
    if (!Array.isArray(list) || list.length > 100) throw new HttpError(400, 'Subtarefas inválidas.');
    await client.query(`delete from "Subtarefa" where "atividadeId" = $1`, [id]);
    for (const [i, st] of list.entries()) {
      await client.query(`insert into "Subtarefa" (id, titulo, feito, ordem, "atividadeId") values ($1, $2, $3, $4, $5)`, [
        newId(),
        nonEmpty((st as { titulo?: unknown })?.titulo, 300, 'subtarefa'),
        (st as { feito?: unknown })?.feito === true,
        i,
        id,
      ]);
    }
  }
  if (has(body, 'favorito')) {
    if (body['favorito'] === true) {
      await client.query(
        `insert into "Favorito" (id, "usuarioId", "atividadeId")
         select $1, $2, $3 where not exists (select 1 from "Favorito" where "usuarioId" = $2 and "atividadeId" = $3)`,
        [newId(), me, id],
      );
    } else {
      await client.query(`delete from "Favorito" where "usuarioId" = $1 and "atividadeId" = $2`, [me, id]);
    }
  }
  if (has(body, 'comentario')) {
    await client.query(`insert into "Comentario" (id, "atividadeId", "autorId", texto) values ($1, $2, $3, $4)`, [
      newId(),
      id,
      me,
      nonEmpty(body['comentario'], 5000, 'comentário'),
    ]);
  }
}

// Cria a atividade (tela ou Claude): quem cria é o responsável, a não ser que venha outro
export async function createActivity(client: PoolClient, s: Session, body: Record<string, unknown>) {
  const tenantId = nonEmpty(body['tenantId'], 60, 'empresa');
  const me = writer(s, tenantId).usuarioId;
  const projetoId = idOrNull(body['projetoId'], 'projeto');
  if (projetoId) await sameTenant(client, 'Projeto', [projetoId], tenantId, 'Projeto');
  const id = newId();
  await client.query(
    `insert into "Atividade" (id, numero, titulo, "tenantId", "projetoId", "criadoPorId", "responsavelId", "atualizadoEm")
     values ($1, (select coalesce(max(numero), 0) + 1 from "Atividade" where "tenantId" = $3), $2, $3, $4, $5, $5, now())`,
    [id, nonEmpty(body['titulo'], 300, 'título'), tenantId, projetoId, me],
  );
  const { tenantId: _t, projetoId: _p, titulo: _ti, ...rest } = body;
  await applyActivity(client, s, id, tenantId, rest);
  return id;
}

// Cada escrita numa transação: se algo falhar, nada fica pela metade
function write(handler: (client: PoolClient, req: Request, s: Session) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    const client = await db().connect();
    try {
      await client.query('begin');
      const result = await handler(client, req, req.session!);
      await client.query('commit');
      res.json(result ?? { ok: true });
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      if (error instanceof HttpError) res.status(error.status).json({ error: error.message });
      else {
        console.error('[writes]', req.method, req.path, (error as Error).message);
        res.status(500).json({ error: 'Não foi possível salvar no banco. Nada foi alterado.' });
      }
    } finally {
      client.release();
    }
  };
}

export function writesRouter() {
  const router = Router();
  router.use(requireAuth, json({ limit: '1mb' })); // a imagem da empresa vem como data URL

  router.patch(
    '/atividades/:id',
    write(async (client, req, s) => {
      const id = String(req.params['id']);
      const tenantId = await visibleActivity(client, s, id);
      await applyActivity(client, s, id, tenantId, req.body ?? {});
    }),
  );

  router.post(
    '/atividades',
    write(async (client, req, s) => ({ id: await createActivity(client, s, (req.body ?? {}) as Record<string, unknown>) })),
  );

  router.post(
    '/sprints',
    write(async (client, req, s) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const tenantId = nonEmpty(body['tenantId'], 60, 'empresa');
      manager(s, tenantId);
      const inicio = isoDateOrNull(body['inicio']);
      const fim = isoDateOrNull(body['fim']);
      if (!inicio || !fim || fim < inicio) throw new HttpError(400, 'Período da sprint inválido.');
      const { rows } = await client.query(`select 1 from "Sprint" where "tenantId" = $1 and situacao = 'ATIVA'`, [tenantId]);
      if (rows.length) throw new HttpError(409, 'Já existe uma sprint ativa nesta empresa. Feche-a antes.');
      const id = newId();
      await client.query(`insert into "Sprint" (id, nome, situacao, "tenantId") values ($1, $2, 'ATIVA', $3)`, [id, nonEmpty(body['nome'], 120, 'nome'), tenantId]);
      if (await ensureSchema()) {
        await client.query(`insert into lexagile.sprint_periodo ("sprintId", inicio, fim) values ($1, $2, $3)`, [id, inicio, fim]);
      }
      return { id };
    }),
  );

  router.patch(
    '/sprints/:id',
    write(async (client, req, s) => {
      const id = String(req.params['id']);
      const { rows } = await client.query(`select "tenantId" from "Sprint" where id = $1`, [id]);
      if (!rows[0] || !membership(s, rows[0].tenantId)) throw new HttpError(404, 'Sprint não encontrada.');
      manager(s, rows[0].tenantId);
      const situacao = req.body?.situacao;
      if (!SPRINT_SITUACOES.includes(situacao)) throw new HttpError(400, 'Situação inválida.');
      await client.query(`update "Sprint" set situacao = $1 where id = $2`, [situacao, id]);
    }),
  );

  configRoutes(router);
  return router;
}

// ---------- Configurações: empresas, setores, membros, equipes e projetos ----------

function owner(s: Session, tenantId: string) {
  const m = writer(s, tenantId);
  if (m.papel !== 'DONO') throw new HttpError(403, 'Só Admin altera esta configuração.');
  return m;
}

const PAPEIS = ['DONO', 'GESTOR', 'ATENDENTE', 'OBSERVADOR'];
const money = (v: unknown, field: string) => {
  if (!(Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 2_000_000_000)) throw new HttpError(400, `Valor inválido: ${field}.`);
  return v as number;
};
const idList = (v: unknown, field: string) => {
  if (!Array.isArray(v) || v.length > 500) throw new HttpError(400, `Lista inválida: ${field}.`);
  return [...new Set(v.map((x) => nonEmpty(x, 60, field)))];
};

// Dados das telas que o banco atual não tem (schema lexagile.extra)
async function saveExtra(client: PoolClient, tipo: string, registroId: string, tenantId: string, extra: unknown) {
  if (extra === undefined || !(await ensureSchema())) return;
  // Até ~900 KB: cabe a foto do projeto (já comprimida no navegador, lado maior de 800px)
  if (typeof extra !== 'object' || extra === null || JSON.stringify(extra).length > 900_000) throw new HttpError(400, 'Dados extras inválidos.');
  await client.query(
    `insert into lexagile.extra (tipo, "registroId", "tenantId", dados) values ($1, $2, $3, $4)
     on conflict (tipo, "registroId") do update set dados = excluded.dados`,
    [tipo, registroId, tenantId, JSON.stringify(extra)],
  );
}

async function tenantOfRow(client: PoolClient, table: string, id: string, s: Session) {
  const { rows } = await client.query(`select "tenantId" from "${table}" where id = $1`, [id]);
  if (!rows[0] || !membership(s, rows[0].tenantId)) throw new HttpError(404, 'Registro não encontrado.');
  return rows[0].tenantId as string;
}

async function updateRow(client: PoolClient, table: string, id: string, sets: string[], values: unknown[], touch = true) {
  if (touch) sets.push(`"atualizadoEm" = now()`);
  if (sets.length) await client.query(`update "${table}" set ${sets.join(', ')} where id = $${values.push(id)}`, values);
}

async function patchEmpresa(client: PoolClient, id: string, body: Record<string, unknown>) {
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (c: string, v: unknown) => sets.push(`"${c}" = $${values.push(v)}`);
  if (has(body, 'nome')) set('nome', nonEmpty(body['nome'], 80, 'nome'));
  if (has(body, 'sigla')) set('sigla', nonEmpty(body['sigla'], 4, 'sigla').toUpperCase());
  if (has(body, 'ativo')) set('ativo', body['ativo'] === true);
  if (has(body, 'fusoHorario')) set('fusoHorario', nonEmpty(body['fusoHorario'], 60, 'fuso horário'));
  if (has(body, 'avatarUrl')) set('avatarUrl', body['avatarUrl'] === null ? null : text(body['avatarUrl'], 800_000, 'imagem'));
  await updateRow(client, 'Tenant', id, sets, values, false);
  await saveExtra(client, 'empresa', id, id, body['extra']);
}

async function patchSetor(client: PoolClient, id: string, tenantId: string, body: Record<string, unknown>) {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (has(body, 'nome')) sets.push(`nome = $${values.push(nonEmpty(body['nome'], 60, 'nome'))}`);
  if (has(body, 'cor')) sets.push(`cor = $${values.push(nonEmpty(body['cor'], 20, 'cor'))}`);
  await updateRow(client, 'Setor', id, sets, values);
  if (has(body, 'membros') && (await ensureSchema())) {
    const membros = body['membros'];
    if (!Array.isArray(membros) || membros.length > 500) throw new HttpError(400, 'Membros inválidos.');
    const ids = membros.map((m) => nonEmpty((m as { usuarioId?: unknown })?.usuarioId, 60, 'membro'));
    await sameTenant(client, 'Usuario', ids, tenantId, 'Membro');
    await client.query(`delete from lexagile.setor_membro where "setorId" = $1`, [id]);
    for (const m of membros as { usuarioId: string; gestor?: unknown }[]) {
      await client.query(`insert into lexagile.setor_membro ("setorId", "usuarioId", gestor) values ($1, $2, $3) on conflict do nothing`, [
        id,
        m.usuarioId,
        m.gestor === true,
      ]);
    }
  }
  await saveExtra(client, 'setor', id, tenantId, body['extra']);
}

async function patchEquipe(client: PoolClient, id: string, tenantId: string, body: Record<string, unknown>) {
  if (has(body, 'nome')) await client.query(`update "Equipe" set nome = $1 where id = $2`, [nonEmpty(body['nome'], 80, 'nome'), id]);
  if (has(body, 'membros')) {
    const ids = idList(body['membros'], 'membro');
    await sameTenant(client, 'Usuario', ids, tenantId, 'Membro');
    await client.query(`delete from "EquipeMembro" where "equipeId" = $1`, [id]);
    for (const u of ids) await client.query(`insert into "EquipeMembro" ("equipeId", "usuarioId") values ($1, $2)`, [id, u]);
  }
  if (has(body, 'projetos')) {
    const ids = idList(body['projetos'], 'projeto');
    await sameTenant(client, 'Projeto', ids, tenantId, 'Projeto');
    await client.query(`update "Projeto" set "equipeId" = null, "atualizadoEm" = now() where "equipeId" = $1 and not (id = any($2::text[]))`, [id, ids]);
    await client.query(`update "Projeto" set "equipeId" = $1, "atualizadoEm" = now() where id = any($2::text[])`, [id, ids]);
  }
  await saveExtra(client, 'equipe', id, tenantId, body['extra']);
}

async function patchProjeto(client: PoolClient, id: string, tenantId: string, body: Record<string, unknown>) {
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (c: string, v: unknown) => sets.push(`"${c}" = $${values.push(v)}`);
  if (has(body, 'nome')) set('nome', nonEmpty(body['nome'], 120, 'nome'));
  if (has(body, 'descricao')) set('descricao', text(body['descricao'], 5000, 'descrição'));
  if (has(body, 'situacao')) {
    if (!['NAO_INICIADO', 'EM_ANDAMENTO', 'PARADO', 'CONCLUIDO'].includes(body['situacao'] as string)) throw new HttpError(400, 'Situação inválida.');
    set('situacao', body['situacao']);
  }
  if (has(body, 'arquivado')) set('arquivado', body['arquivado'] === true);
  for (const [key, label] of [['orcamento', 'custo inicial'], ['custoPrevisto', 'custo de desenvolvimento'], ['custoRealizado', 'custo final']]) {
    if (has(body, key)) set(key, money(body[key], label));
  }
  for (const [key, table, label] of [['responsavelId', 'Usuario', 'Responsável'], ['setorId', 'Setor', 'Setor'], ['equipeId', 'Equipe', 'Equipe']]) {
    if (!has(body, key)) continue;
    const ref = idOrNull(body[key], label);
    if (ref) await sameTenant(client, table, [ref], tenantId, label);
    else if (key === 'responsavelId') continue; // o banco exige responsável: sem nome, mantém o atual
    set(key, ref);
  }
  await updateRow(client, 'Projeto', id, sets, values);
  await saveExtra(client, 'projeto', id, tenantId, body['extra']);
}

function configRoutes(router: Router) {
  // Empresas
  router.post(
    '/empresas',
    write(async (client, req, s) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const id = await createTenant(client, s, { nome: nonEmpty(body['nome'], 80, 'nome'), sigla: nonEmpty(body['sigla'], 4, 'sigla').toUpperCase() });
      const { nome: _n, sigla: _s, ...rest } = body;
      await patchEmpresa(client, id, rest);
      return { id };
    }),
  );
  router.patch(
    '/empresas/:id',
    write(async (client, req, s) => {
      const id = String(req.params['id']);
      owner(s, id);
      await patchEmpresa(client, id, req.body ?? {});
    }),
  );

  // Setores
  router.post(
    '/setores',
    write(async (client, req, s) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const tenantId = nonEmpty(body['tenantId'], 60, 'empresa');
      owner(s, tenantId);
      const id = newId();
      await client.query(
        `insert into "Setor" (id, nome, cor, ordem, "tenantId", "atualizadoEm")
         values ($1, $2, $3, (select coalesce(max(ordem), 0) + 1 from "Setor" where "tenantId" = $4), $4, now())`,
        [id, nonEmpty(body['nome'], 60, 'nome'), typeof body['cor'] === 'string' ? body['cor'] : 'sky', tenantId],
      );
      const { nome: _n, cor: _c, tenantId: _t, ...rest } = body;
      await patchSetor(client, id, tenantId, rest);
      return { id };
    }),
  );
  router.patch(
    '/setores/:id',
    write(async (client, req, s) => {
      const id = String(req.params['id']);
      const tenantId = await tenantOfRow(client, 'Setor', id, s);
      owner(s, tenantId);
      await patchSetor(client, id, tenantId, req.body ?? {});
    }),
  );
  router.delete(
    '/setores/:id',
    write(async (client, req, s) => {
      const id = String(req.params['id']);
      owner(s, await tenantOfRow(client, 'Setor', id, s));
      await client.query(`update "Setor" set arquivado = true, "atualizadoEm" = now() where id = $1`, [id]); // arquiva, não apaga
    }),
  );

  // Membros: convidar / dar acesso a uma empresa
  router.post(
    '/usuarios',
    write(async (client, req, s) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const tenantId = nonEmpty(body['tenantId'], 60, 'empresa');
      owner(s, tenantId);
      const email = nonEmpty(body['email'], 200, 'e-mail').toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'E-mail inválido.');
      if (!(await isAllowedEmail(email))) throw new HttpError(400, 'Esse domínio de e-mail não está entre os permitidos (Configurações › Membros › Domínios).');
      const papel = PAPEIS.includes(body['papel'] as string) ? body['papel'] : 'ATENDENTE';
      const { rows: dup } = await client.query(`select 1 from "Usuario" where lower(email) = $1 and "tenantId" = $2 and "removidoEm" is null`, [email, tenantId]);
      if (dup.length) throw new HttpError(409, 'Essa pessoa já está nessa empresa.');
      const id = newId();
      // Já tem conta em outra empresa: entra com a mesma senha. Senão, fica como convidada (sem senha).
      const { rowCount } = await client.query(
        `insert into "Usuario" (id, nome, email, papel, situacao, "avatarUrl", "senhaHash", "senhaAtualizadaEm", tema, "tenantId")
         select $1, nome, email, $2, 'ATIVO', "avatarUrl", "senhaHash", "senhaAtualizadaEm", tema, $3
           from "Usuario" where lower(email) = $4 and "removidoEm" is null and "senhaHash" is not null limit 1`,
        [id, papel, tenantId, email],
      );
      if (!rowCount) {
        await client.query(
          `insert into "Usuario" (id, nome, email, papel, situacao, "convidadoEm", "tenantId") values ($1, $2, $3, $4, 'CONVIDADO', now(), $5)`,
          [id, nonEmpty(body['nome'], 120, 'nome'), email, papel, tenantId],
        );
      }
      return { id };
    }),
  );

  // Membros: nome e cargo valem para a pessoa em todas as empresas onde quem altera é Admin
  router.patch(
    '/pessoas',
    write(async (client, req, s) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const email = nonEmpty(body['email'], 200, 'e-mail').toLowerCase();
      const tenants = s.memberships.filter((m) => m.papel === 'DONO').map((m) => m.tenantId);
      if (!tenants.length) throw new HttpError(403, 'Só Admin altera membros.');
      if (has(body, 'papel')) {
        if (!PAPEIS.includes(body['papel'] as string)) throw new HttpError(400, 'Cargo inválido.');
        if (email === s.email) throw new HttpError(400, 'Você não pode mudar o próprio cargo.');
        await client.query(`update "Usuario" set papel = $1 where lower(email) = $2 and "tenantId" = any($3::text[])`, [body['papel'], email, tenants]);
      }
      if (has(body, 'nome')) {
        await client.query(`update "Usuario" set nome = $1 where lower(email) = $2 and "tenantId" = any($3::text[])`, [nonEmpty(body['nome'], 120, 'nome'), email, tenants]);
      }
    }),
  );
  router.post(
    '/pessoas/remover',
    write(async (client, req, s) => {
      const email = nonEmpty(req.body?.email, 200, 'e-mail').toLowerCase();
      if (email === s.email) throw new HttpError(400, 'Você não pode remover a si mesmo.');
      const tenants = s.memberships.filter((m) => m.papel === 'DONO').map((m) => m.tenantId);
      if (!tenants.length) throw new HttpError(403, 'Só Admin remove membros.');
      await client.query(
        `update "Usuario" set situacao = 'REMOVIDO', "removidoEm" = now() where lower(email) = $1 and "tenantId" = any($2::text[]) and "removidoEm" is null`,
        [email, tenants],
      );
    }),
  );

  // Equipes
  router.post(
    '/equipes',
    write(async (client, req, s) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const tenantId = nonEmpty(body['tenantId'], 60, 'empresa');
      manager(s, tenantId);
      const id = newId();
      await client.query(`insert into "Equipe" (id, nome, "tenantId") values ($1, $2, $3)`, [id, nonEmpty(body['nome'], 80, 'nome'), tenantId]);
      const { nome: _n, tenantId: _t, ...rest } = body;
      await patchEquipe(client, id, tenantId, rest);
      return { id };
    }),
  );
  router.patch(
    '/equipes/:id',
    write(async (client, req, s) => {
      const id = String(req.params['id']);
      const tenantId = await tenantOfRow(client, 'Equipe', id, s);
      manager(s, tenantId);
      await patchEquipe(client, id, tenantId, req.body ?? {});
    }),
  );
  router.delete(
    '/equipes/:id',
    write(async (client, req, s) => {
      const id = String(req.params['id']);
      manager(s, await tenantOfRow(client, 'Equipe', id, s));
      await client.query(`update "Equipe" set ativa = false where id = $1`, [id]); // desativa, não apaga
    }),
  );

  // Projetos
  router.post(
    '/projetos',
    write(async (client, req, s) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const tenantId = nonEmpty(body['tenantId'], 60, 'empresa');
      const me = manager(s, tenantId).usuarioId;
      const id = newId();
      await client.query(
        `insert into "Projeto" (id, numero, nome, "dataInicio", "responsavelId", "tenantId", "atualizadoEm")
         values ($1, (select coalesce(max(numero), 0) + 1 from "Projeto" where "tenantId" = $3), $2, now(), $4, $3, now())`,
        [id, nonEmpty(body['nome'], 120, 'nome'), tenantId, me],
      );
      const { nome: _n, tenantId: _t, ...rest } = body;
      await patchProjeto(client, id, tenantId, rest);
      return { id };
    }),
  );
  router.patch(
    '/projetos/:id',
    write(async (client, req, s) => {
      const id = String(req.params['id']);
      const tenantId = await tenantOfRow(client, 'Projeto', id, s);
      manager(s, tenantId);
      await patchProjeto(client, id, tenantId, req.body ?? {});
    }),
  );
}
