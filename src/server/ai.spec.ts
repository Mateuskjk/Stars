import { AiConfig, buildRequest, readError, readReply } from './ai';

const base: AiConfig = { provider: 'openai', model: 'm', apiKey: 'sk-test', temperature: 0.5, maxTokens: 100, systemPrompt: 'Seja útil.' };
const messages = [
  { role: 'user' as const, content: 'Oi' },
  { role: 'assistant' as const, content: 'Olá!' },
  { role: 'user' as const, content: 'Como crio um projeto?' },
];

describe('AI providers', () => {
  it('builds each provider request with fixed URLs and its own auth header', () => {
    const openai = buildRequest(base, messages);
    expect(openai.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(openai.headers).toEqual({ Authorization: 'Bearer sk-test' });
    expect((openai.body as any).messages[0]).toEqual({ role: 'system', content: 'Seja útil.' });

    const claude = buildRequest({ ...base, provider: 'anthropic' }, messages);
    expect(claude.url).toBe('https://api.anthropic.com/v1/messages');
    expect(claude.headers['x-api-key']).toBe('sk-test');
    expect(claude.body).toMatchObject({ system: 'Seja útil.', max_tokens: 100, messages });

    const gemini = buildRequest({ ...base, provider: 'gemini', model: 'gemini-x' }, messages);
    expect(gemini.url).toContain('/models/gemini-x:generateContent');
    expect((gemini.body as any).contents[1]).toEqual({ role: 'model', parts: [{ text: 'Olá!' }] });

    expect(buildRequest({ ...base, provider: 'deepseek' }, messages).url).toBe('https://api.deepseek.com/chat/completions');
  });

  it('omits temperature for OpenAI reasoning models (gpt-5, o-series)', () => {
    for (const model of ['gpt-5', 'gpt-5-mini', 'o3', 'o4-mini']) {
      const body = buildRequest({ ...base, model, maxTokens: 800 }, messages).body as any;
      expect(body.temperature).toBeUndefined();
      expect(body).toMatchObject({ reasoning_effort: 'low', max_completion_tokens: 4000 });
    }
    expect((buildRequest({ ...base, model: 'gpt-4.1' }, messages).body as any).temperature).toBe(0.5);
  });

  it('reads the reply text from each response format', () => {
    expect(readReply('openai', { choices: [{ message: { content: 'ok' } }] })).toBe('ok');
    expect(readReply('anthropic', { content: [{ type: 'text', text: 'o' }, { type: 'text', text: 'k' }] })).toBe('ok');
    expect(readReply('gemini', { candidates: [{ content: { parts: [{ text: 'ok' }] } }] })).toBe('ok');
    expect(readReply('openai', {})).toBe('');
  });

  it('turns provider errors into readable messages', () => {
    expect(readError(401, {})).toContain('Chave de API inválida');
    expect(readError(404, {})).toContain('Modelo não encontrado');
    expect(readError(500, { error: { message: 'boom' } })).toContain('boom');
  });
});
