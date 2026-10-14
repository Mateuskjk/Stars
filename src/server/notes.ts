// Anotações do sistema atual (tabela "Anotacao") — roda SOMENTE no servidor.
// Cada pessoa vê e edita só as suas (autorId); o Admin (Dono) direciona as anotações da empresa para o perfil certo.
import { Router, json } from 'express';
import { Session, requireAuth } from './auth';
import { db } from './db';

const MAX_TEXT = 20_000;
// Os cadastros da pessoa: os da sessão e todos com o mesmo e-mail — inclusive em empresas desativadas,
// que não entram na sessão (senão as anotações feitas lá ficariam inacessíveis para a própria autora)
async function mine(s: Session) {
  const { rows } = await db().query<{ id: string }>(`select id from "Usuario" where id = any($1::text[]) or lower(email) = $2`, [
    s.memberships.map((m) => m.usuarioId),
    s.email.trim().toLowerCase(),
  ]);
  return rows.map((r) => r.id);
}
const adminTenants = (s: Session) => s.memberships.filter((m) => m.papel === 'DONO').map((m) => m.tenantId);
// As datas da tabela são "timestamp sem fuso" gravadas em UTC (Prisma)
const UTC_NOW = `(now() at time zone 'utc')`;

export function notesRouter() {
  const router = Router();
  router.use('/anotacoes', requireAuth, json({ limit: '100kb' }));

  // As minhas anotações
  router.get('/anotacoes', async (req, res) => {
    const { rows } = await db().query(
      `select id, texto, "criadoEm" at time zone 'utc' as "criadoEm", "atualizadoEm" at time zone 'utc' as "atualizadoEm"
         from "Anotacao" where "autorId" = any($1::text[]) order by ordem, "criadoEm"`,
      [await mine(req.session!)],
    );
    res.json(rows);
  });

  // Direcionar (Admin): anotações e pessoas ativas das empresas onde é Dono. Só a 1ª linha do texto, para identificar.
  router.get('/anotacoes/direcionar', async (req, res) => {
    const tenants = adminTenants(req.session!);
    if (!tenants.length) return void res.status(403).json({ error: 'Só Admin direciona anotações.' });
    const [notes, people] = await Promise.all([
      db().query(
        `select a.id, left(split_part(a.texto, E'\\n', 1), 80) as previa, a."tenantId", a."autorId", u.nome as autor,
                (u.situacao = 'ATIVO' and u."removidoEm" is null) as "autorAtivo", a."atualizadoEm" at time zone 'utc' as "atualizadoEm"
           from "Anotacao" a join "Usuario" u on u.id = a."autorId"
          where a."tenantId" = any($1::text[]) order by "autorAtivo", u.nome, a."criadoEm"`,
        [tenants],
      ),
      db().query(
        `select id, nome, "tenantId" from "Usuario" where "tenantId" = any($1::text[]) and situacao = 'ATIVO' and "removidoEm" is null order by nome`,
        [tenants],
      ),
    ]);
    res.json({ anotacoes: notes.rows, pessoas: people.rows });
  });

  // Só para pessoa ativa da MESMA empresa da anotação, e só nas empresas onde quem direciona é Dono
  router.post('/anotacoes/direcionar', async (req, res) => {
    const tenants = adminTenants(req.session!);
    if (!tenants.length) return void res.status(403).json({ error: 'Só Admin direciona anotações.' });
    const itens: unknown = req.body?.itens;
    if (!Array.isArray(itens) || itens.length > 500 || !itens.every((i) => typeof i?.id === 'string' && typeof i?.usuarioId === 'string')) {
      return void res.status(400).json({ error: 'Lista inválida.' });
    }
    let movidas = 0;
    for (const { id, usuarioId } of itens as { id: string; usuarioId: string }[]) {
      const r = await db().query(
        `update "Anotacao" a set "autorId" = u.id, "atualizadoEm" = ${UTC_NOW}
           from "Usuario" u
          where a.id = $1 and u.id = $2 and a."autorId" <> u.id and u."tenantId" = a."tenantId"
            and u.situacao = 'ATIVO' and u."removidoEm" is null and a."tenantId" = any($3::text[])`,
        [id, usuarioId, tenants],
      );
      movidas += r.rowCount ?? 0;
    }
    res.json({ movidas });
  });

  router.patch('/anotacoes/:id', async (req, res) => {
    const texto = req.body?.texto;
    if (typeof texto !== 'string' || texto.length > MAX_TEXT) return void res.status(400).json({ error: 'Texto inválido.' });
    const r = await db().query(`update "Anotacao" set texto = $1, "atualizadoEm" = ${UTC_NOW} where id = $2 and "autorId" = any($3::text[])`, [
      texto,
      req.params['id'],
      await mine(req.session!),
    ]);
    if (!r.rowCount) return void res.status(404).json({ error: 'Anotação não encontrada.' });
    res.status(204).end();
  });

  router.delete('/anotacoes/:id', async (req, res) => {
    const r = await db().query(`delete from "Anotacao" where id = $1 and "autorId" = any($2::text[])`, [req.params['id'], await mine(req.session!)]);
    if (!r.rowCount) return void res.status(404).json({ error: 'Anotação não encontrada.' });
    res.status(204).end();
  });

  return router;
}
