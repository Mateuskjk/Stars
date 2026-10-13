// Conversas — roda SOMENTE no servidor, nas tabelas do sistema atual ("Canal", "CanalMembro", "Mensagem").
// Canais públicos da empresa aparecem para todos dela; conversas diretas são canais do tipo DIRETO com as duas
// pessoas como membros (só elas leem e escrevem). O servidor confere o acesso em toda leitura e envio.
import { Request, Response, Router, json } from 'express';
import { db } from './db';
import { Session, requireAuth } from './auth';
import { HttpError, newId } from './migration';
import { isAllowedEmail } from './domains';
import { hit } from './limits';

// Escrever no chat: Observador é só leitura; e no máximo 30 mensagens por minuto por pessoa (contra spam)
async function canWrite(s: Session, tenantId: string) {
  const m = s.memberships.find((x) => x.tenantId === tenantId);
  if (!m) throw new HttpError(404, 'Empresa não encontrada.');
  if (m.papel === 'OBSERVADOR') throw new HttpError(403, 'Seu acesso nesta empresa é só leitura.');
  if ((await hit(`chat:${s.email.toLowerCase()}`, 60)) > 30) throw new HttpError(429, 'Muitas mensagens seguidas. Espere um pouco.');
  return m.usuarioId;
}

const tenantsOf = (s: Session) => s.memberships.map((m) => m.tenantId);
const meOf = (s: Session) => s.memberships.map((m) => m.usuarioId);

// Canal que a pessoa pode ver: público da empresa dela, ou um em que ela é membro
const CAN_SEE = `c."tenantId" = any($1::text[]) and (c.tipo = 'PUBLICO' or exists (
  select 1 from "CanalMembro" cm where cm."canalId" = c.id and cm."usuarioId" = any($2::text[])))`;

async function canalVisivel(s: Session, id: string) {
  const { rows } = await db().query<{ tenantId: string }>(`select c."tenantId" from "Canal" c where c.id = $3 and ${CAN_SEE}`, [tenantsOf(s), meOf(s), id]);
  if (!rows[0]) throw new HttpError(404, 'Conversa não encontrada.');
  return rows[0].tenantId;
}

function route(handler: (req: Request, s: Session) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      res.json(await handler(req, req.session!));
    } catch (error) {
      if (error instanceof HttpError) res.status(error.status).json({ error: error.message });
      else {
        console.error('[chat]', req.method, req.path, (error as Error).message);
        res.status(500).json({ error: 'Não foi possível carregar as conversas.' });
      }
    }
  };
}

export function chatRouter() {
  const router = Router();
  router.use(requireAuth, json({ limit: '20kb' }));

  // Conversas (canais públicos e diretas), com a última mensagem
  router.get(
    '/conversas',
    route(async (_req, s) => {
      const { rows } = await db().query(
        `select c.id, c.tipo, c.nome, c.descricao, c."tenantId",
                (select json_build_object('texto', m.texto, 'em', m."criadoEm", 'minha', m."autorId" = any($2::text[]))
                   from "Mensagem" m where m."canalId" = c.id order by m."criadoEm" desc limit 1) as ultima,
                case when c.tipo = 'DIRETO' then (
                  select json_build_object('nome', u.nome, 'email', u.email)
                    from "CanalMembro" cm join "Usuario" u on u.id = cm."usuarioId"
                   where cm."canalId" = c.id and not (cm."usuarioId" = any($2::text[])) limit 1) end as outro
           from "Canal" c where ${CAN_SEE}`,
        [tenantsOf(s), meOf(s)],
      );
      return rows;
    }),
  );

  // Mensagens de uma conversa (as 200 mais recentes, em ordem)
  router.get(
    '/conversas/:id/mensagens',
    route(async (req, s) => {
      const id = String(req.params['id']);
      await canalVisivel(s, id);
      const { rows } = await db().query(
        `select * from (
           select m.id, m.texto, m."criadoEm" as em, u.nome as autor, m."autorId" = any($2::text[]) as minha
             from "Mensagem" m left join "Usuario" u on u.id = m."autorId"
            where m."canalId" = $1 order by m."criadoEm" desc limit 200
         ) t order by em`,
        [id, meOf(s)],
      );
      return rows;
    }),
  );

  router.post(
    '/conversas/:id/mensagens',
    route(async (req, s) => {
      const id = String(req.params['id']);
      const tenantId = await canalVisivel(s, id);
      const texto = typeof req.body?.texto === 'string' ? req.body.texto.trim() : '';
      if (!texto || texto.length > 4000) throw new HttpError(400, 'Mensagem vazia ou longa demais (até 4000 caracteres).');
      const autorId = await canWrite(s, tenantId);
      const msg = { id: newId(), texto, em: new Date().toISOString(), autor: s.nome, minha: true };
      await db().query(`insert into "Mensagem" (id, "canalId", "autorId", texto) values ($1, $2, $3, $4)`, [msg.id, id, autorId, texto]);
      return msg;
    }),
  );

  // Abre (ou cria) a conversa direta com uma pessoa da mesma empresa
  router.post(
    '/diretas',
    route(async (req, s) => {
      const tenantId = String(req.body?.tenantId ?? '');
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      const me = await canWrite(s, tenantId);
      if (!(await isAllowedEmail(email))) throw new HttpError(400, 'Essa pessoa não tem acesso ao LexÁgile.');
      const { rows: outros } = await db().query<{ id: string }>(
        `select id from "Usuario" where lower(email) = $1 and "tenantId" = $2 and situacao = 'ATIVO' and "removidoEm" is null limit 1`,
        [email, tenantId],
      );
      const outro = outros[0]?.id;
      if (!outro || outro === me) throw new HttpError(404, 'Pessoa não encontrada nesta empresa.');
      const nome = `dm:${[me, outro].sort().join(':')}`; // único por empresa (índice do banco), sem duplicar a conversa
      const { rows: existing } = await db().query<{ id: string }>(`select id from "Canal" where "tenantId" = $1 and nome = $2`, [tenantId, nome]);
      if (existing[0]) return { id: existing[0].id };
      const client = await db().connect();
      try {
        await client.query('begin');
        const id = newId();
        await client.query(
          `insert into "Canal" (id, nome, descricao, tipo, "tenantId", "criadoPorId") values ($1, $2, 'Conversa direta', 'DIRETO', $3, $4)`,
          [id, nome, tenantId, me],
        );
        await client.query(`insert into "CanalMembro" ("canalId", "usuarioId", papel) values ($1, $2, 'MEMBRO'), ($1, $3, 'MEMBRO')`, [id, me, outro]);
        await client.query('commit');
        return { id };
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        // Duas pessoas abriram ao mesmo tempo: usa a que foi criada
        if ((error as { code?: string }).code === '23505') {
          const { rows } = await db().query<{ id: string }>(`select id from "Canal" where "tenantId" = $1 and nome = $2`, [tenantId, nome]);
          if (rows[0]) return { id: rows[0].id };
        }
        throw error;
      } finally {
        client.release();
      }
    }),
  );

  return router;
}
