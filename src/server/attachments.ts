// Anexos das atividades (tabela "Anexo" do sistema atual: o arquivo fica no próprio banco) — roda SOMENTE no servidor.
// Vale para atividades gerais e de projeto: quem vê a atividade vê e baixa os anexos; quem pode gravar na empresa anexa e remove.
import { NextFunction, Request, Response, Router, raw } from 'express';
import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { requireAuth } from './auth';
import { db } from './db';
import { HttpError } from './migration';
import { visibleActivity, writer } from './writes';

// A Vercel recusa pedidos acima de ~4,5 MB
export const MAX_FILE = 4 * 1024 * 1024;

const client = () => db() as unknown as PoolClient; // visibleActivity só usa query()

export function attachmentsRouter() {
  const router = Router();
  router.use(['/atividades/:id/anexos', '/anexos/:id'], requireAuth);

  // A atividade pela qual se chega ao anexo (e a visibilidade dela)
  async function attachmentActivity(req: Request) {
    const { rows } = await db().query<{ atividadeId: string }>(`select "atividadeId" from "Anexo" where id = $1`, [String(req.params['id'])]);
    if (!rows[0]) throw new HttpError(404, 'Anexo não encontrado.');
    return visibleActivity(client(), req.session!, rows[0].atividadeId); // a empresa da atividade
  }

  const handle =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response) => {
      try {
        await fn(req, res);
      } catch (error) {
        if (error instanceof HttpError) return void res.status(error.status).json({ error: error.message });
        console.error('[anexos]', (error as Error).message);
        res.status(500).json({ error: 'Não foi possível concluir. Tente de novo.' });
      }
    };

  router.get(
    '/atividades/:id/anexos',
    handle(async (req, res) => {
      await visibleActivity(client(), req.session!, String(req.params['id']));
      const { rows } = await db().query(
        `select x.id, x.nome, x.mime, x.tamanho, x."criadoEm" at time zone 'utc' as "criadoEm", u.nome as autor
           from "Anexo" x left join "Usuario" u on u.id = x."enviadoPorId" where x."atividadeId" = $1 order by x."criadoEm"`,
        [String(req.params['id'])],
      );
      res.json(rows);
    }),
  );

  // Sempre como download (nunca abre como página do site); a tela monta a pré-visualização só de imagens e PDF
  router.get(
    '/anexos/:id',
    handle(async (req, res) => {
      await attachmentActivity(req);
      const { rows } = await db().query<{ nome: string; conteudo: Uint8Array }>(`select nome, conteudo from "Anexo" where id = $1`, [String(req.params['id'])]);
      res.set({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(rows[0].nome)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      // Não é XSS: vai como octet-stream + attachment + nosniff (o navegador só baixa, nunca interpreta como página)
      res.send(Buffer.from(rows[0].conteudo)); // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write
    }),
  );

  // Corpo = o arquivo; nome e tipo nos cabeçalhos
  router.post(
    '/atividades/:id/anexos',
    raw({ type: () => true, limit: MAX_FILE }),
    handle(async (req, res) => {
      const tenantId = await visibleActivity(client(), req.session!, String(req.params['id']));
      const me = writer(req.session!, tenantId);
      const body: unknown = req.body;
      if (!Buffer.isBuffer(body) || !body.length) throw new HttpError(400, 'Arquivo vazio.');
      let nome = '';
      try {
        nome = decodeURIComponent(String(req.get('x-file-name') ?? '')).trim();
      } catch {
        // nome mal codificado: cai no "sem nome" abaixo
      }
      nome = nome.replace(/[\\/\0\r\n]/g, '_').slice(0, 200) || 'arquivo';
      const mime = String(req.get('content-type') ?? '').split(';')[0].trim().toLowerCase().slice(0, 100) || 'application/octet-stream';
      const id = randomUUID();
      await db().query(
        `insert into "Anexo" (id, "atividadeId", nome, mime, tamanho, conteudo, "enviadoPorId", "criadoEm") values ($1, $2, $3, $4, $5, decode($6, 'hex'), $7, now() at time zone 'utc')`,
        [id, String(req.params['id']), nome, mime, body.length, body.toString('hex'), me.usuarioId], // em hex (decode no banco): igual em qualquer driver
      );
      res.status(201).json({ id, nome, mime, tamanho: body.length, criadoEm: new Date().toISOString(), autor: req.session!.nome });
    }),
  );

  router.delete(
    '/anexos/:id',
    handle(async (req, res) => {
      writer(req.session!, await attachmentActivity(req));
      await db().query(`delete from "Anexo" where id = $1`, [String(req.params['id'])]);
      res.status(204).end();
    }),
  );

  // Arquivo grande demais (o raw() recusa antes de chegar na rota)
  router.use(
    ['/atividades/:id/anexos'],
    (error: { type?: string }, _req: Request, res: Response, next: NextFunction) => {
      if (error?.type === 'entity.too.large') return void res.status(413).json({ error: 'Arquivo grande demais (máximo 4 MB).' });
      next(error);
    },
  );

  return router;
}
