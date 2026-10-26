import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';
import { aiRouter } from './server/ai';
import { authRouter, requireAuth } from './server/auth';
import { googleRouter } from './server/google-auth';
import { domainsRouter } from './server/domains';
import { mcpRouters } from './server/mcp';
import { dataRouter } from './server/data';
import { writesRouter } from './server/writes';
import { notesRouter } from './server/notes';
import { accountRouter } from './server/account';
import { attachmentsRouter } from './server/attachments';
import { publicApiInternalRouter, publicApiRouter } from './server/public-api';
import { SECURITY_HEADERS, csrfGuard } from './server/security-headers';

// Segredos locais (DATABASE_URL etc.). Em produção vêm das variáveis de ambiente do servidor.
try {
  process.loadEnvFile();
} catch {
  // sem .env: segue com as variáveis de ambiente
}

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
app.disable('x-powered-by');
// CSP, HSTS, anti-iframe etc. em todas as respostas (os estáticos da Vercel recebem os mesmos pelo vercel.json)
app.use((_req, res, next) => {
  res.set(SECURITY_HEADERS);
  next();
});
app.use(csrfGuard); // gravações vindas de outro site são recusadas (security-headers.ts)
// Na Vercel há um proxy na frente: confia nele para saber o IP real (limite de tentativas) e se é HTTPS
if (process.env['VERCEL']) app.set('trust proxy', 1);
// Endereços aceitos pelo SSR do Angular (proteção contra SSRF): o do APP_URL, os que a Vercel informa
// (produção, preview e branch) e o computador local. NG_ALLOWED_HOSTS acrescenta outros, separados por vírgula.
const hostOf = (url?: string) => {
  try {
    return url ? new URL(url.includes('://') ? url : `https://${url}`).hostname : null;
  } catch {
    return null;
  }
};
const allowedHosts = [
  ...['APP_URL', 'VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL'].map((name) => hostOf(process.env[name])),
  ...(process.env['NG_ALLOWED_HOSTS'] ?? '').split(',').map((h) => h.trim()),
  'localhost',
].filter((h): h is string => !!h);
const angularApp = new AngularNodeAppEngine({ allowedHosts });

/**
 * Login com os usuários do banco, API de dados (leitura e gravação) e migração (só admins). Tudo exige sessão.
 */
app.use('/api/auth', authRouter());
app.use('/api/auth', googleRouter());
app.use('/api/data', dataRouter());
app.use('/api/data', writesRouter());
app.use('/api/data', domainsRouter());
app.use('/api/data', notesRouter());
app.use('/api/data', accountRouter());
app.use('/api/data', attachmentsRouter());

/**
 * MCP: o Claude (site/app e Claude Code) conecta em /mcp com login OAuth (conta do LexÁgile).
 */
app.use(mcpRouters());

/**
 * API da integração com IA (as chaves ficam só no servidor).
 */
app.use('/api/ai', requireAuth, aiRouter());

/**
 * API pública v1 (com token) e as rotas internas que o app usa para registrar tokens e enviar o retrato dos dados.
 */
app.use('/api/v1', publicApiRouter());
app.use('/api/internal', requireAuth, publicApiInternalRouter());

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
