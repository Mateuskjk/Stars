import { Component, ElementRef, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { formatTime } from '../chat/chat';
import { AiModelConfig, AiModelDraft, AiStore, DEFAULT_PROMPT, PROVIDERS, Provider, fixedTemperature } from './ai-store';

const empty = (provider: Provider = 'anthropic'): AiModelDraft => ({
  name: '',
  provider,
  model: PROVIDERS.find((p) => p.id === provider)!.models[0],
  temperature: 0.7,
  maxTokens: 800,
  systemPrompt: DEFAULT_PROMPT,
});

@Component({
  selector: 'app-ai-integration',
  templateUrl: './ai-integration.html',
  host: { class: 'ai' },
})
export class AiIntegration {
  protected readonly store = inject(AiStore);
  protected readonly providers = PROVIDERS;
  protected readonly fixedTemperature = fixedTemperature;
  protected readonly defaultPrompt = DEFAULT_PROMPT;

  constructor() {
    afterNextRender(() => this.store.load());
  }

  protected provider(id: Provider) {
    return PROVIDERS.find((p) => p.id === id)!;
  }

  protected testedAt(config: AiModelConfig) {
    return config.lastTest ? formatTime(new Date(config.lastTest.at)) : '';
  }

  // Testes em andamento (por id), para mostrar "Testando…"
  protected readonly testing = signal<Set<string>>(new Set());

  protected async test(id: string) {
    this.testing.update((set) => new Set(set).add(id));
    await this.store.test(id);
    this.testing.update((set) => {
      const next = new Set(set);
      next.delete(id);
      return next;
    });
  }

  // ---------- Modal ----------
  private readonly editor = viewChild.required<ElementRef<HTMLDialogElement>>('editor');
  protected readonly editingId = signal<string | null>(null);
  protected readonly draft = signal<AiModelDraft>(empty());
  protected readonly apiKey = signal('');
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly pageError = signal(''); // erros fora do formulário (ex.: excluir sem ser Admin)
  protected readonly editingConfig = computed(() => this.store.configs().find((c) => c.id === this.editingId()) ?? null);

  protected openNew() {
    this.editingId.set(null);
    this.draft.set(empty());
    this.openEditor();
  }

  protected openEdit(config: AiModelConfig) {
    this.editingId.set(config.id);
    const { id, keyHint, lastTest, ...draft } = config;
    this.draft.set(draft);
    this.openEditor();
  }

  private openEditor() {
    this.apiKey.set('');
    this.error.set('');
    this.editor().nativeElement.showModal();
  }

  protected closeEditor() {
    this.apiKey.set(''); // a chave não fica na memória da tela depois de fechar
    this.editor().nativeElement.close();
  }

  protected patch(changes: Partial<AiModelDraft>) {
    this.draft.update((draft) => ({ ...draft, ...changes }));
  }

  protected chooseProvider(provider: Provider) {
    if (provider === this.draft().provider) return;
    this.patch({ provider, model: this.provider(provider).models[0] });
  }

  protected async save(event: Event, andTest = false) {
    event.preventDefault();
    const draft = this.draft();
    if (!draft.name.trim()) return this.error.set('Dê um nome para este modelo (ex.: “Assistente rápido”).');
    if (!draft.model.trim()) return this.error.set('Informe o nome do modelo.');
    if (!this.editingId() && !this.apiKey().trim()) return this.error.set('Informe a chave de API.');
    this.saving.set(true);
    this.error.set('');
    try {
      const id = await this.store.save({ ...draft, name: draft.name.trim(), model: draft.model.trim() }, this.apiKey().trim(), this.editingId());
      this.closeEditor();
      if (andTest) this.test(id);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Não foi possível salvar.');
    } finally {
      this.saving.set(false);
    }
  }

  // ---------- Exclusão ----------
  private readonly confirmDialog = viewChild.required<ElementRef<HTMLDialogElement>>('confirmDialog');
  protected readonly deleting = signal<AiModelConfig | null>(null);

  protected askDelete(config: AiModelConfig) {
    this.deleting.set(config);
    this.confirmDialog().nativeElement.showModal();
  }

  protected async confirmDelete() {
    const config = this.deleting();
    this.confirmDialog().nativeElement.close();
    if (!config) return;
    this.pageError.set('');
    try {
      await this.store.remove(config.id);
    } catch (error) {
      this.pageError.set(error instanceof Error ? error.message : 'Não foi possível excluir.');
    }
  }

  protected cancelDelete() {
    this.confirmDialog().nativeElement.close();
  }

  protected closeOnBackdrop(event: MouseEvent, dialog: HTMLDialogElement) {
    if (event.target === dialog) dialog.close();
  }
}
