import { Component, ElementRef, afterNextRender, computed, signal, viewChild } from '@angular/core';
import { formatTime } from '../chat/chat';
import { eventGroups, samplePayload } from './webhook-events';

interface Webhook {
  id: string;
  name: string;
  url: string;
  events: string[];
  active: boolean;
  secretHint: string;
  lastDelivery: { at: string; ok: boolean; status?: number; error?: string; event: string } | null;
}

interface Database {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  user: string;
  hasPassword: boolean;
  ssl: 'disable' | 'require' | 'verify-full';
  schema: string;
  connectTimeoutSec: number;
  statementTimeoutSec: number;
  poolMax: number;
  readOnly: boolean;
  applicationName: string;
  lastTest: { at: string; ok: boolean; info?: string; error?: string } | null;
}

type WebhookDraft = Pick<Webhook, 'name' | 'url' | 'events' | 'active'>;
type DatabaseDraft = Omit<Database, 'id' | 'hasPassword' | 'lastTest'>;

const emptyHook = (): WebhookDraft => ({ name: '', url: 'https://', events: [], active: true });
const emptyDb = (): DatabaseDraft => ({
  name: '',
  host: '',
  port: 5432,
  database: '',
  user: '',
  ssl: 'require',
  schema: 'public',
  connectTimeoutSec: 10,
  statementTimeoutSec: 30,
  poolMax: 10,
  readOnly: true,
  applicationName: 'stars',
});

async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/integrations${url}`, { ...init, headers: { 'content-type': 'application/json', ...init.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok && !('ok' in data)) throw new Error(data?.error ?? `Erro ${response.status}`);
  return data as T;
}

// Exemplo de verificação da assinatura do lado de quem recebe o webhook (Node.js)
const VERIFY_SNIPPET = `import { createHmac, timingSafeEqual } from 'node:crypto';

// rawBody = corpo da requisição exatamente como chegou (string)
function isFromStars(rawBody, headers, secret) {
  const timestamp = headers['x-stars-timestamp'];
  const expected = 'sha256=' + createHmac('sha256', secret).update(\`\${timestamp}.\${rawBody}\`).digest('hex');
  const received = headers['x-stars-signature'] ?? '';
  const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) < 300; // recusa reenvios com mais de 5 min
  return fresh && received.length === expected.length && timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}`;

@Component({
  selector: 'app-integrations',
  templateUrl: './integrations.html',
  host: { class: 'integrations' },
})
export class Integrations {
  protected readonly tab = signal<'webhooks' | 'database'>('webhooks');
  protected readonly groups = eventGroups();
  protected readonly verifySnippet = VERIFY_SNIPPET;
  protected readonly formatTime = formatTime;

  protected readonly webhooks = signal<Webhook[]>([]);
  protected readonly databases = signal<Database[]>([]);
  protected readonly loadError = signal('');
  protected readonly busy = signal<Set<string>>(new Set());

  constructor() {
    afterNextRender(() => this.refresh());
  }

  private async refresh() {
    try {
      this.webhooks.set(await api<Webhook[]>('/webhooks'));
      this.databases.set(await api<Database[]>('/databases'));
      this.loadError.set('');
    } catch {
      this.loadError.set('Não foi possível falar com o servidor de integrações.');
    }
  }

  protected at(iso: string) {
    return formatTime(new Date(iso));
  }

  protected eventLabel(id: string) {
    if (id === '*') return 'Todos os eventos';
    for (const group of this.groups) {
      const event = group.events.find((e) => e.id === id);
      if (event) return `${group.entity} · ${event.label}`;
    }
    return id;
  }

  private async withBusy(id: string, work: () => Promise<unknown>) {
    this.busy.update((set) => new Set(set).add(id));
    try {
      await work();
    } finally {
      this.busy.update((set) => {
        const next = new Set(set);
        next.delete(id);
        return next;
      });
    }
  }

  // ---------- Exemplo de payload ----------
  protected readonly sampleEvent = signal('activity.move');
  protected readonly sample = computed(() => JSON.stringify(samplePayload(this.sampleEvent()), null, 2));

  // ---------- Webhooks ----------
  private readonly hookDialog = viewChild.required<ElementRef<HTMLDialogElement>>('hookDialog');
  protected readonly hookId = signal<string | null>(null);
  protected readonly hookDraft = signal<WebhookDraft>(emptyHook());
  protected readonly hookError = signal('');
  protected readonly newSecret = signal<string | null>(null); // aparece uma única vez, logo após criar
  protected readonly saving = signal(false);

  protected openHook(hook?: Webhook) {
    this.hookId.set(hook?.id ?? null);
    this.hookDraft.set(hook ? { name: hook.name, url: hook.url, events: [...hook.events], active: hook.active } : emptyHook());
    this.hookError.set('');
    this.newSecret.set(null);
    this.hookDialog().nativeElement.showModal();
  }

  protected closeHook() {
    this.newSecret.set(null);
    this.hookDialog().nativeElement.close();
  }

  protected patchHook(changes: Partial<WebhookDraft>) {
    this.hookDraft.update((draft) => ({ ...draft, ...changes }));
  }

  protected toggleEvent(id: string) {
    const events = this.hookDraft().events;
    if (id === '*') return this.patchHook({ events: events.includes('*') ? [] : ['*'] });
    const next = events.filter((e) => e !== '*');
    this.patchHook({ events: next.includes(id) ? next.filter((e) => e !== id) : [...next, id] });
  }

  protected async saveHook(event: Event) {
    event.preventDefault();
    const id = this.hookId() ?? crypto.randomUUID();
    this.saving.set(true);
    try {
      const saved = await api<Webhook & { secret?: string; error?: string }>(`/webhooks/${id}`, { method: 'PUT', body: JSON.stringify(this.hookDraft()) });
      await this.refresh();
      if (saved.secret) {
        this.hookId.set(id);
        this.newSecret.set(saved.secret); // mostra o segredo antes de fechar
      } else {
        this.closeHook();
      }
    } catch (error) {
      this.hookError.set(error instanceof Error ? error.message : 'Não foi possível salvar.');
    } finally {
      this.saving.set(false);
    }
  }

  protected testHook(hook: Webhook) {
    return this.withBusy(hook.id, async () => {
      await api(`/webhooks/${hook.id}/test`, { method: 'POST' }).catch(() => null);
      await this.refresh();
    });
  }

  // ---------- Banco de dados ----------
  private readonly dbDialog = viewChild.required<ElementRef<HTMLDialogElement>>('dbDialog');
  protected readonly dbId = signal<string | null>(null);
  protected readonly dbDraft = signal<DatabaseDraft>(emptyDb());
  protected readonly dbPassword = signal('');
  protected readonly dbError = signal('');
  protected readonly editingDb = computed(() => this.databases().find((db) => db.id === this.dbId()) ?? null);

  protected openDb(db?: Database) {
    this.dbId.set(db?.id ?? null);
    if (db) {
      const { id, hasPassword, lastTest, ...draft } = db;
      this.dbDraft.set(draft);
    } else {
      this.dbDraft.set(emptyDb());
    }
    this.dbPassword.set('');
    this.dbError.set('');
    this.dbDialog().nativeElement.showModal();
  }

  protected closeDb() {
    this.dbPassword.set(''); // a senha não fica na memória da tela
    this.dbDialog().nativeElement.close();
  }

  protected patchDb(changes: Partial<DatabaseDraft>) {
    this.dbDraft.update((draft) => ({ ...draft, ...changes }));
  }

  protected async saveDb(event: Event, andTest = false) {
    event.preventDefault();
    if (!this.dbId() && !this.dbPassword()) return this.dbError.set('Informe a senha do usuário do banco.');
    const id = this.dbId() ?? crypto.randomUUID();
    this.saving.set(true);
    try {
      await api(`/databases/${id}`, { method: 'PUT', body: JSON.stringify({ ...this.dbDraft(), password: this.dbPassword() }) });
      this.closeDb();
      await this.refresh();
      if (andTest) await this.testDb(id);
    } catch (error) {
      this.dbError.set(error instanceof Error ? error.message : 'Não foi possível salvar.');
    } finally {
      this.saving.set(false);
    }
  }

  protected testDb(id: string) {
    return this.withBusy(id, async () => {
      await api(`/databases/${id}/test`, { method: 'POST' }).catch(() => null);
      await this.refresh();
    });
  }

  // ---------- Exclusão (webhook ou banco) ----------
  private readonly confirmDialog = viewChild.required<ElementRef<HTMLDialogElement>>('confirmDialog');
  protected readonly deleting = signal<{ kind: 'webhooks' | 'databases'; id: string; name: string } | null>(null);

  protected askDelete(kind: 'webhooks' | 'databases', item: { id: string; name: string }) {
    this.deleting.set({ kind, id: item.id, name: item.name });
    this.confirmDialog().nativeElement.showModal();
  }

  protected async confirmDelete() {
    const target = this.deleting();
    this.confirmDialog().nativeElement.close();
    if (!target) return;
    await api(`/${target.kind}/${target.id}`, { method: 'DELETE' }).catch(() => null);
    await this.refresh();
  }

  protected cancelDelete() {
    this.confirmDialog().nativeElement.close();
  }

  protected closeOnBackdrop(event: MouseEvent, dialog: HTMLDialogElement) {
    if (event.target === dialog) dialog.close();
  }
}
