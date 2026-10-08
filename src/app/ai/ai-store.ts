import { Injectable, computed, signal } from '@angular/core';

export type Provider = 'openai' | 'anthropic' | 'gemini' | 'deepseek';

export const PROVIDERS: { id: Provider; label: string; vendor: string; color: string; models: string[]; keyHint: string }[] = [
  // ponytail: sugestões de modelo mudam com o tempo; o campo aceita qualquer nome — confira na documentação de cada fornecedor
  { id: 'anthropic', label: 'Claude', vendor: 'Anthropic', color: '#d97757', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5-20251001'], keyHint: 'sk-ant-…' },
  { id: 'openai', label: 'ChatGPT', vendor: 'OpenAI', color: '#10a37f', models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1'], keyHint: 'sk-…' },
  { id: 'gemini', label: 'Gemini', vendor: 'Google', color: '#4285f4', models: ['gemini-2.5-pro', 'gemini-2.5-flash'], keyHint: 'AIza…' },
  { id: 'deepseek', label: 'DeepSeek', vendor: 'DeepSeek', color: '#4d6bfe', models: ['deepseek-chat', 'deepseek-reasoner'], keyHint: 'sk-…' },
];

export const DEFAULT_PROMPT = `Você é o assistente do Stars, um sistema de gestão de trabalho em equipe. Responda em português, de forma curta e prática.
Seu papel: dar dicas de uso, explicar como cada tela funciona e apontar quando o usuário parece estar fazendo algo errado, sugerindo o jeito certo.
Telas do Stars: Home (carrosséis de projetos e empresas), Dashboards (indicadores, burn-up/down, carga de trabalho), Conversas (chat do time),
Projetos (carrossel, kanban por status e tabela de criação), Workspace > Daily (reunião diária com anotações e resumo), Backlog (kanban de atividades gerais
com bloqueio, anexos, sub atividades e favoritos), Planning (sprints: criar, fechar, cancelar e enviar atividades refinadas), Notas (pessoais, com [[links]]),
Brain (grafo das notas), Favoritos, e Configurações (Perfis de empresas, Membros com convite por código de 6 dígitos, Equipes e Integração com IA).
Se não souber algo sobre o sistema, diga que não sabe em vez de inventar.`;

export interface AiModelConfig {
  id: string;
  name: string;
  provider: Provider;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  keyHint: string; // só o final da chave; a chave inteira fica no servidor
  lastTest: { ok: boolean; at: string; latencyMs?: number; error?: string } | null;
}

export type AiModelDraft = Omit<AiModelConfig, 'id' | 'keyHint' | 'lastTest'>;

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

const KEY = 'stars.ai-configs';

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...init.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error ?? `Erro ${response.status}`);
  return data as T;
}

// Configurações dos modelos de IA. No navegador fica só o que não é segredo (nome, modelo, ajustes, final da chave);
// a chave de API vai uma única vez para o servidor (/api/ai) ao salvar.
@Injectable({ providedIn: 'root' })
export class AiStore {
  readonly configs = signal<AiModelConfig[]>([]);
  readonly assistantId = signal<string | null>(null);
  readonly assistant = computed(() => this.configs().find((c) => c.id === this.assistantId()) ?? null);
  private loaded = false;

  // Chamado no navegador depois da primeira renderização (no SSR não existe localStorage)
  load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const data = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (data && Array.isArray(data.configs)) {
        this.configs.set(data.configs);
        this.assistantId.set(data.assistantId ?? null);
      }
    } catch {
      // armazenamento bloqueado ou dado corrompido: começa vazio
    }
  }

  private persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ configs: this.configs(), assistantId: this.assistantId() }));
    } catch {
      // sem armazenamento: vale só nesta sessão
    }
  }

  // Cria ou atualiza. apiKey vazia numa atualização = manter a chave atual do servidor.
  async save(draft: AiModelDraft, apiKey: string, id: string | null) {
    const configId = id ?? crypto.randomUUID();
    const { keyHint } = await request<{ keyHint: string }>(`/api/ai/configs/${configId}`, {
      method: 'PUT',
      body: JSON.stringify({ ...draft, apiKey }),
    });
    const existing = this.configs().find((c) => c.id === configId);
    const config: AiModelConfig = { ...draft, id: configId, keyHint, lastTest: apiKey || !existing ? null : existing.lastTest };
    this.configs.update((list) => (existing ? list.map((c) => (c.id === configId ? config : c)) : [...list, config]));
    if (!this.assistantId()) this.assistantId.set(configId); // o primeiro modelo vira o assistente
    this.persist();
    return configId;
  }

  async remove(id: string) {
    await request(`/api/ai/configs/${id}`, { method: 'DELETE' }).catch(() => null);
    this.configs.update((list) => list.filter((c) => c.id !== id));
    if (this.assistantId() === id) this.assistantId.set(this.configs()[0]?.id ?? null);
    this.persist();
  }

  setAssistant(id: string) {
    this.assistantId.set(id);
    this.persist();
  }

  async test(id: string) {
    const at = new Date().toISOString();
    let lastTest: AiModelConfig['lastTest'];
    try {
      const { latencyMs } = await request<{ latencyMs: number }>(`/api/ai/configs/${id}/test`, { method: 'POST' });
      lastTest = { ok: true, at, latencyMs };
    } catch (error) {
      lastTest = { ok: false, at, error: error instanceof Error ? error.message : 'Falha na conexão.' };
    }
    this.configs.update((list) => list.map((c) => (c.id === id ? { ...c, lastTest } : c)));
    this.persist();
    return lastTest;
  }

  async chat(messages: ChatTurn[], page: string) {
    const id = this.assistantId();
    if (!id) throw new Error('Nenhum modelo de IA configurado.');
    const { reply } = await request<{ reply: string }>('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ configId: id, messages, page }),
    });
    return reply;
  }
}
