// Integração com IAs — roda SOMENTE no servidor (Node). As chaves de API ficam aqui e nunca voltam para o navegador.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Request, Response, Router, json } from 'express';
import { db, ddl } from './db';
import { hit } from './limits';
import { SUPERADMIN_ONLY, isSuperAdmin } from './auth';

export type Provider = 'openai' | 'anthropic' | 'gemini' | 'deepseek';
export const PROVIDERS: Provider[] = ['openai', 'anthropic', 'gemini', 'deepseek'];

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiConfig {
  provider: Provider;
  model: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
}

interface ProviderRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

// Modelos de raciocínio da OpenAI (gpt-5…, o1, o3, o4-mini…): não aceitam temperatura diferente de 1
export const isReasoningModel = (model: string) => /^(gpt-5|o\d)/i.test(model);
export const REASONING_MIN_TOKENS = 4000;

// Endereços fixos por fornecedor: o navegador escolhe o fornecedor, nunca a URL (evita o servidor ser usado como proxy aberto)
export function buildRequest(config: AiConfig, messages: ChatMessage[]): ProviderRequest {
  const { provider, model, apiKey, temperature, maxTokens, systemPrompt } = config;
  switch (provider) {
    case 'openai': {
      const messagesWithSystem = [{ role: 'system', content: systemPrompt }, ...messages];
      if (isReasoningModel(model)) {
        // GPT-5 e família "o" só aceitam a temperatura padrão (1) e gastam parte do limite raciocinando
        // antes de responder; com pouco limite, a resposta volta vazia. Por isso: sem temperatura,
        // raciocínio curto e um piso de tokens.
        return {
          url: 'https://api.openai.com/v1/chat/completions',
          headers: { Authorization: `Bearer ${apiKey}` },
          body: { model, reasoning_effort: 'low', max_completion_tokens: Math.max(maxTokens, REASONING_MIN_TOKENS), messages: messagesWithSystem },
        };
      }
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: { model, temperature, max_completion_tokens: maxTokens, messages: messagesWithSystem },
      };
    }
    case 'deepseek': // API compatível com a da OpenAI
      return {
        url: 'https://api.deepseek.com/chat/completions',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: { model, temperature, max_tokens: maxTokens, messages: [{ role: 'system', content: systemPrompt }, ...messages] },
      };
    case 'anthropic':
      return {
        url: 'https://api.anthropic.com/v1/messages',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: { model, temperature, max_tokens: maxTokens, system: systemPrompt, messages },
      };
    case 'gemini':
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        headers: { 'x-goog-api-key': apiKey },
        body: {
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          generationConfig: { temperature, maxOutputTokens: maxTokens },
        },
      };
  }
}

// Tira o texto da resposta de cada fornecedor (cada um devolve num formato diferente)
export function readReply(provider: Provider, data: any): string {
  if (provider === 'anthropic') {
    return (data?.content ?? []).filter((block: any) => block?.type === 'text').map((block: any) => block.text).join('');
  }
  if (provider === 'gemini') {
    return (data?.candidates?.[0]?.content?.parts ?? []).map((part: any) => part?.text ?? '').join('');
  }
  return data?.choices?.[0]?.message?.content ?? '';
}

// Mensagem de erro legível, sem repetir a chave nem detalhes internos
export function readError(status: number, data: any): string {
  const message = data?.error?.message ?? data?.message ?? '';
  if (status === 401 || status === 403) return 'Chave de API inválida ou sem permissão para este modelo.';
  if (status === 404) return 'Modelo não encontrado. Confira o nome do modelo.';
  if (status === 429) return 'Limite de uso atingido (rate limit ou créditos). Tente mais tarde.';
  return `O fornecedor recusou a chamada (HTTP ${status})${message ? `: ${String(message).slice(0, 200)}` : ''}`;
}

export async function callModel(config: AiConfig, messages: ChatMessage[], timeoutMs = 30_000) {
  const request = buildRequest(config, messages);
  const started = Date.now();
  const response = await fetch(request.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...request.headers },
    body: JSON.stringify(request.body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(readError(response.status, data));
  return { reply: readReply(config.provider, data), latencyMs: Date.now() - started };
}

// ---------- Validação do que chega do navegador ----------
const MODEL_PATTERN = /^[\w.:\-/]{1,100}$/;

function parseConfig(body: any, existing?: AiConfig): AiConfig | string {
  const provider = body?.provider;
  if (!PROVIDERS.includes(provider)) return 'Fornecedor inválido.';
  const model = String(body?.model ?? '').trim();
  if (!MODEL_PATTERN.test(model)) return 'Nome de modelo inválido.';
  const apiKey = typeof body?.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : existing?.apiKey;
  if (!apiKey || apiKey.length > 500) return 'Informe a chave de API.';
  const temperature = Math.min(2, Math.max(0, Number(body?.temperature ?? 0.7)));
  const maxTokens = Math.min(8000, Math.max(16, Math.round(Number(body?.maxTokens ?? 800))));
  const systemPrompt = String(body?.systemPrompt ?? '').slice(0, 8000);
  return { provider, model, apiKey, temperature, maxTokens, systemPrompt };
}

const nameOf = (body: any) => String(body?.name ?? '').trim().slice(0, 80) || 'Modelo de IA';

function parseMessages(body: any): ChatMessage[] | string {
  const raw = Array.isArray(body?.messages) ? body.messages.slice(-20) : null; // só as 20 últimas
  if (!raw?.length) return 'Envie ao menos uma mensagem.';
  const messages = raw.map((m: any) => ({ role: m?.role === 'assistant' ? 'assistant' : 'user', content: String(m?.content ?? '').slice(0, 4000) }));
  if (messages.at(-1).role !== 'user') return 'A última mensagem precisa ser do usuário.';
  return messages;
}

// ---------- Guarda no banco (lexagile.ia_config) ----------
// Vale para todos os usuários e para qualquer cópia do servidor (Vercel). A chave de API fica CIFRADA
// (AES-256-GCM) com a LEXAGILE_SECRET do servidor; nunca volta para o navegador, só os 4 últimos caracteres.
interface StoredData {
  name: string;
  provider: Provider;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  keyHint: string;
  lastTest: { ok: boolean; at: string; latencyMs?: number; error?: string } | null;
}

class AiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let warned = false;
function cipherKey() {
  const secret = process.env['LEXAGILE_SECRET'];
  if (!secret) {
    if (process.env['NODE_ENV'] === 'production' || process.env['VERCEL']) {
      throw new AiError(503, 'Defina a variável LEXAGILE_SECRET no servidor para guardar as chaves de IA com segurança.');
    }
    if (!warned) console.warn('[ai] LEXAGILE_SECRET não definida: usando uma chave de desenvolvimento (não use em produção)');
    warned = true;
  }
  return createHash('sha256').update(secret || 'lexagile-dev-secret').digest();
}

export function encryptKey(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', cipherKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decryptKey(stored: string) {
  const [iv, tag, data] = stored.split('.').map((p) => Buffer.from(p, 'base64'));
  // Tag de 16 bytes exigida: uma tag truncada (gravada por quem mexeu no banco) não passa como válida
  const decipher = createDecipheriv('aes-256-gcm', cipherKey(), iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

let table: Promise<void> | null = null;
export function ensureTable() {
  table ??= ddl(
      `create schema if not exists lexagile;
       create table if not exists lexagile.ia_config (
         id text primary key,
         dados jsonb not null,
         "chaveCifrada" text not null,
         assistente boolean not null default false,
         "atualizadoEm" timestamptz not null default now()
       )`,
    )
    .then(() => undefined)
    .catch((error) => {
      table = null;
      throw error;
    });
  return table;
}

async function readRow(id: string) {
  await ensureTable();
  const { rows } = await db().query<{ dados: StoredData; chaveCifrada: string; assistente: boolean }>(
    `select dados, "chaveCifrada", assistente from lexagile.ia_config where id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

const toConfig = (row: { dados: StoredData; chaveCifrada: string }): AiConfig => ({ ...row.dados, apiKey: decryptKey(row.chaveCifrada) });

// Configurar a IA (vale para todas as empresas): só superadmin. Usar o assistente: qualquer pessoa logada.
const isAdmin = (req: Request) => !!req.session && isSuperAdmin(req.session);

function handle(fn: (req: Request, res: Response) => Promise<void>, adminOnly = false) {
  return async (req: Request, res: Response) => {
    if (adminOnly && !isAdmin(req)) return void res.status(403).json({ error: SUPERADMIN_ONLY });
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof AiError) return void res.status(error.status).json({ error: error.message });
      console.error('[ai]', req.method, req.path, (error as Error).message);
      res.status(500).json({ error: 'Não foi possível acessar as configurações de IA.' });
    }
  };
}

export function aiRouter() {
  const router = Router();
  router.use(json({ limit: '100kb' }));

  // Lista (sem as chaves) e qual é o assistente
  router.get(
    '/configs',
    handle(async (_req, res) => {
      await ensureTable();
      const { rows } = await db().query<{ id: string; dados: StoredData; assistente: boolean }>(
        `select id, dados, assistente from lexagile.ia_config order by "atualizadoEm"`,
      );
      res.json(rows.map((r) => ({ id: r.id, ...r.dados, assistant: r.assistente })));
    }),
  );

  // Salvar (criar ou atualizar). A chave é opcional na atualização: sem chave nova, mantém a atual.
  router.put(
    '/configs/:id',
    handle(async (req, res) => {
      const id = String(req.params['id']);
      if (!/^[\w-]{1,64}$/.test(id)) return void res.status(400).json({ error: 'Id inválido.' });
      const existing = await readRow(id);
      const parsed = parseConfig(req.body, existing ? toConfig(existing) : undefined);
      if (typeof parsed === 'string') return void res.status(400).json({ error: parsed });
      const keyChanged = !existing || (typeof req.body?.apiKey === 'string' && !!req.body.apiKey.trim());
      const { apiKey, ...rest } = parsed;
      const dados: StoredData = { ...rest, name: nameOf(req.body), keyHint: apiKey.slice(-4), lastTest: keyChanged ? null : (existing?.dados.lastTest ?? null) };
      // O primeiro modelo salvo vira o assistente
      const { rows } = await db().query(`select 1 from lexagile.ia_config where assistente limit 1`);
      await db().query(
        `insert into lexagile.ia_config (id, dados, "chaveCifrada", assistente) values ($1, $2, $3, $4)
         on conflict (id) do update set dados = excluded.dados, "chaveCifrada" = excluded."chaveCifrada", "atualizadoEm" = now()`,
        [id, JSON.stringify(dados), encryptKey(apiKey), !rows.length],
      );
      console.log(`[ai] ${req.session!.email} salvou o modelo ${dados.name} (${dados.provider} · ${dados.model})`);
      res.json({ ok: true, keyHint: dados.keyHint });
    }, true),
  );

  router.delete(
    '/configs/:id',
    handle(async (req, res) => {
      await ensureTable();
      const { rows } = await db().query<{ assistente: boolean }>(`delete from lexagile.ia_config where id = $1 returning assistente`, [String(req.params['id'])]);
      // Era o assistente: o próximo modelo assume
      if (rows[0]?.assistente) {
        await db().query(`update lexagile.ia_config set assistente = true where id = (select id from lexagile.ia_config order by "atualizadoEm" limit 1)`);
      }
      res.json({ ok: true });
    }, true),
  );

  router.put(
    '/assistente',
    handle(async (req, res) => {
      const id = String(req.body?.id ?? '');
      if (!(await readRow(id))) return void res.status(404).json({ error: 'Modelo não encontrado.' });
      await db().query(`update lexagile.ia_config set assistente = (id = $1)`, [id]);
      res.json({ ok: true });
    }, true),
  );

  // Testa a conexão com uma pergunta curtinha (e guarda o resultado)
  router.post(
    '/configs/:id/test',
    handle(async (req, res) => {
      const id = String(req.params['id']);
      const row = await readRow(id);
      if (!row) return void res.status(404).json({ error: 'Configuração não encontrada. Salve de novo.' });
      const config = toConfig(row);
      const at = new Date().toISOString();
      try {
        const { reply, latencyMs } = await callModel({ ...config, maxTokens: Math.min(config.maxTokens, 64) }, [
          { role: 'user', content: 'Responda só com a palavra: ok' },
        ], 15_000);
        await db().query(`update lexagile.ia_config set dados = dados || $2 where id = $1`, [id, JSON.stringify({ lastTest: { ok: true, at, latencyMs } })]);
        res.json({ ok: true, latencyMs, reply: reply.slice(0, 100) });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Falha na conexão.';
        await db().query(`update lexagile.ia_config set dados = dados || $2 where id = $1`, [id, JSON.stringify({ lastTest: { ok: false, at, error: message } })]);
        res.status(502).json({ ok: false, error: message });
      }
    }, true),
  );

  // Conversa com o assistente (o modelo marcado como assistente)
  router.post(
    '/chat',
    handle(async (req, res) => {
      await ensureTable();
      const { rows } = await db().query<{ dados: StoredData; chaveCifrada: string }>(
        `select dados, "chaveCifrada" from lexagile.ia_config where assistente limit 1`,
      );
      if (!rows[0]) return void res.status(404).json({ error: 'Nenhum modelo de IA configurado. Peça a um Admin em Configurações › Integração com IA.' });
      // Cada mensagem custa dinheiro na chave da empresa: 20 por minuto e 300 por dia por pessoa
      const who = req.session!.email.toLowerCase();
      if ((await hit(`ia:${who}`, 60)) > 20 || (await hit(`ia-dia:${who}`, 86_400)) > 300) {
        return void res.status(429).json({ error: 'Você atingiu o limite de mensagens para o assistente. Tente de novo mais tarde.' });
      }
      const config = toConfig(rows[0]);
      const messages = parseMessages(req.body);
      if (typeof messages === 'string') return void res.status(400).json({ error: messages });
      // Só o caminho da tela (ex.: /workspace/backlog): nada de texto livre indo para o prompt de sistema
      const page = String(req.body?.page ?? '').replace(/[^\w/\-]/g, '').slice(0, 100);
      const systemPrompt = `${config.systemPrompt}\n\nO usuário está agora na tela: ${page || 'desconhecida'}.`;
      try {
        const { reply } = await callModel({ ...config, systemPrompt }, messages);
        res.json({ reply });
      } catch (error) {
        console.error('[ai] falha no chat:', error instanceof Error ? error.message : error);
        res.status(502).json({ error: 'O assistente não respondeu agora. Tente de novo em instantes.' });
      }
    }),
  );

  return router;
}
