// Integração com IAs — roda SOMENTE no servidor (Node). As chaves de API ficam aqui e nunca voltam para o navegador.
import { Router, json } from 'express';

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

// Endereços fixos por fornecedor: o navegador escolhe o fornecedor, nunca a URL (evita o servidor ser usado como proxy aberto)
export function buildRequest(config: AiConfig, messages: ChatMessage[]): ProviderRequest {
  const { provider, model, apiKey, temperature, maxTokens, systemPrompt } = config;
  switch (provider) {
    case 'openai':
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: {
          model,
          temperature,
          max_completion_tokens: maxTokens,
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
        },
      };
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

function parseMessages(body: any): ChatMessage[] | string {
  const raw = Array.isArray(body?.messages) ? body.messages.slice(-20) : null; // só as 20 últimas
  if (!raw?.length) return 'Envie ao menos uma mensagem.';
  const messages = raw.map((m: any) => ({ role: m?.role === 'assistant' ? 'assistant' : 'user', content: String(m?.content ?? '').slice(0, 4000) }));
  if (messages.at(-1).role !== 'user') return 'A última mensagem precisa ser do usuário.';
  return messages;
}

// ponytail: configs (com as chaves) ficam na memória do servidor e somem ao reiniciar; em produção,
// guardar cifradas num banco/cofre de segredos — e proteger estas rotas com login quando ele existir,
// senão qualquer pessoa que acesse o servidor consegue gastar os créditos das chaves salvas.
const configs = new Map<string, AiConfig>();

export function aiRouter() {
  const router = Router();
  router.use(json({ limit: '100kb' }));

  // Salvar (criar ou atualizar). A chave é opcional na atualização: sem chave nova, mantém a atual.
  router.put('/configs/:id', (req, res) => {
    const id = req.params.id;
    if (!/^[\w-]{1,64}$/.test(id)) return void res.status(400).json({ error: 'Id inválido.' });
    const parsed = parseConfig(req.body, configs.get(id));
    if (typeof parsed === 'string') return void res.status(400).json({ error: parsed });
    configs.set(id, parsed);
    res.json({ ok: true, keyHint: parsed.apiKey.slice(-4) });
  });

  router.delete('/configs/:id', (req, res) => {
    configs.delete(req.params.id);
    res.json({ ok: true });
  });

  // Testa a conexão com uma pergunta curtinha
  router.post('/configs/:id/test', async (req, res) => {
    const config = configs.get(req.params.id);
    if (!config) return void res.status(404).json({ error: 'Configuração não encontrada no servidor. Salve de novo.' });
    try {
      const { reply, latencyMs } = await callModel({ ...config, maxTokens: Math.min(config.maxTokens, 64) }, [
        { role: 'user', content: 'Responda só com a palavra: ok' },
      ], 15_000);
      res.json({ ok: true, latencyMs, reply: reply.slice(0, 100) });
    } catch (error) {
      res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'Falha na conexão.' });
    }
  });

  router.post('/chat', async (req, res) => {
    const config = configs.get(String(req.body?.configId ?? ''));
    if (!config) return void res.status(404).json({ error: 'Assistente não configurado no servidor. Salve a integração de novo.' });
    const messages = parseMessages(req.body);
    if (typeof messages === 'string') return void res.status(400).json({ error: messages });
    const page = String(req.body?.page ?? '').slice(0, 200);
    const systemPrompt = `${config.systemPrompt}\n\nO usuário está agora na tela: ${page || 'desconhecida'}.`;
    try {
      const { reply } = await callModel({ ...config, systemPrompt }, messages);
      res.json({ reply });
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : 'Falha ao falar com a IA.' });
    }
  });

  return router;
}
