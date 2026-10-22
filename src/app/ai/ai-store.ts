import { Injectable, computed, signal } from '@angular/core';

export type Provider = 'openai' | 'anthropic' | 'gemini' | 'deepseek';

export const PROVIDERS: { id: Provider; label: string; vendor: string; color: string; models: string[]; keyHint: string }[] = [
  // ponytail: sugestões de modelo mudam com o tempo; o campo aceita qualquer nome — confira na documentação de cada fornecedor
  { id: 'anthropic', label: 'Claude', vendor: 'Anthropic', color: '#d97757', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5-20251001'], keyHint: 'sk-ant-…' },
  { id: 'openai', label: 'ChatGPT', vendor: 'OpenAI', color: '#10a37f', models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1'], keyHint: 'sk-…' },
  { id: 'gemini', label: 'Gemini', vendor: 'Google', color: '#4285f4', models: ['gemini-2.5-pro', 'gemini-2.5-flash'], keyHint: 'AIza…' },
  { id: 'deepseek', label: 'DeepSeek', vendor: 'DeepSeek', color: '#4d6bfe', models: ['deepseek-chat', 'deepseek-reasoner'], keyHint: 'sk-…' },
];

// GPT-5 e família "o" da OpenAI só aceitam a temperatura padrão (o servidor não envia a criatividade)
export const fixedTemperature = (config: { provider: Provider; model: string }) => config.provider === 'openai' && /^(gpt-5|o\d)/i.test(config.model);

export const DEFAULT_PROMPT = `Você é o assistente do LexÁgile, um sistema de gestão de trabalho em equipe. Responda em português, de forma curta e prática.
Seu papel: dar dicas de uso, explicar como cada tela funciona e apontar quando o usuário parece estar fazendo algo errado, sugerindo o jeito certo.
Telas do LexÁgile: Home (carrosséis de projetos e empresas), Dashboards (duas abas: Sprints e setores — indicadores, burn-up/down, carga de trabalho das atividades gerais; Projetos — burn-up, burn-down, Gantt e insights dos projetos),
Projetos (Geral com carrossel e kanban por status; tabela de criação), Workspace > Daily (reunião diária com anotações e resumo), Backlog (kanban de atividades gerais
com bloqueio, anexos e sub atividades), Planning (sprints: criar, fechar, cancelar e enviar atividades refinadas), Notas (pessoais),
e Configurações (Perfis de empresas, Membros com convite por código de 6 dígitos, Equipes e Integração com IA).
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

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...init.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error ?? `Erro ${response.status}`);
  return data as T;
}

// Configurações dos modelos de IA: ficam no servidor (banco), valem para todos os usuários e o navegador só recebe
// o que não é segredo (nome, modelo, ajustes, final da chave). A chave de API vai uma única vez ao salvar.
// Configurar é só para Admin; usar o assistente, para qualquer pessoa logada.
@Injectable({ providedIn: 'root' })
export class AiStore {
  readonly configs = signal<AiModelConfig[]>([]);
  readonly assistantId = signal<string | null>(null);
  readonly assistant = computed(() => this.configs().find((c) => c.id === this.assistantId()) ?? null);
  private loading: Promise<void> | null = null;

  // Busca a lista no servidor (pode ser chamado de várias telas: só busca uma vez por vez)
  load() {
    this.loading ??= this.refresh().finally(() => (this.loading = null));
    return this.loading;
  }

  private async refresh() {
    try {
      const list = await request<(AiModelConfig & { assistant: boolean })[]>('/api/ai/configs');
      this.configs.set(list.map(({ assistant, ...c }) => c));
      this.assistantId.set(list.find((c) => c.assistant)?.id ?? null);
    } catch {
      // sem login ou sem banco: fica sem modelos (o assistente avisa ao tentar usar)
    }
  }

  // Cria ou atualiza. apiKey vazia numa atualização = manter a chave atual do servidor.
  async save(draft: AiModelDraft, apiKey: string, id: string | null) {
    const configId = id ?? crypto.randomUUID();
    await request<{ keyHint: string }>(`/api/ai/configs/${configId}`, {
      method: 'PUT',
      body: JSON.stringify({ ...draft, apiKey }),
    });
    await this.refresh();
    return configId;
  }

  async remove(id: string) {
    await request(`/api/ai/configs/${id}`, { method: 'DELETE' });
    await this.refresh();
  }

  async setAssistant(id: string) {
    this.assistantId.set(id); // aparece na hora; o servidor confirma
    await request('/api/ai/assistente', { method: 'PUT', body: JSON.stringify({ id }) }).catch(() => undefined);
    await this.refresh();
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
