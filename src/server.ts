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
import { dataRouter } from './server/data';
import { migrationRouter } from './server/migration';
import { integrationsRouter } from './server/integrations';
import { publicApiInternalRouter, publicApiRouter } from './server/public-api';

// Segredos locais (DATABASE_URL etc.). Em produção vêm das variáveis de ambiente do servidor.
try {
  process.loadEnvFile();
} catch {
  // sem .env: segue com as variáveis de ambiente
}

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

/**
 * Login com os usuários do banco, API de dados (leitura) e migração (só admins). Tudo exige sessão.
 */
app.use('/api/auth', authRouter());
app.use('/api/data', dataRouter());
app.use('/api/migracao', migrationRouter());

/**
 * API da integração com IA (as chaves ficam só no servidor).
 */
app.use('/api/ai', requireAuth, aiRouter());

/**
 * Integrações: webhooks e bancos PostgreSQL externos (segredos e senhas ficam só no servidor).
 */
app.use('/api/integrations', requireAuth, integrationsRouter());

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
