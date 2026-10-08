import { Component, afterNextRender, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

interface Parameter {
  name: string;
  in: 'path' | 'query';
  required: boolean;
  description: string;
  schema: { type: string; enum?: string[] };
}

interface Operation {
  path: string;
  tag: string;
  summary: string;
  description: string;
  parameters: Parameter[];
  responses: Record<string, { description: string; content?: { 'application/json': { example: unknown } } }>;
}

interface TryResult {
  status: number;
  ms: number;
  body: string;
}

// Documentação no estilo Swagger, montada a partir do OpenAPI 3 que o próprio servidor publica
@Component({
  imports: [RouterLink],
  selector: 'app-api-docs',
  templateUrl: './api-docs.html',
  host: { class: 'api-docs' },
})
export class ApiDocs {
  protected readonly spec = signal<any>(null);
  protected readonly error = signal('');
  protected readonly baseUrl = computed(() => this.spec()?.servers?.[0]?.url ?? '/api/v1');

  protected readonly groups = computed(() => {
    const paths = this.spec()?.paths ?? {};
    const operations: Operation[] = Object.entries(paths).map(([path, item]: [string, any]) => ({
      path,
      tag: item.get.tags[0],
      summary: item.get.summary,
      description: item.get.description,
      parameters: item.get.parameters ?? [],
      responses: item.get.responses,
    }));
    const tags = [...new Set(operations.map((o) => o.tag))];
    return tags.map((tag) => ({ tag, operations: operations.filter((o) => o.tag === tag) }));
  });

  // Token só na memória da página (não é salvo em lugar nenhum)
  protected readonly token = signal('');
  protected readonly tokenValid = computed(() => /^stars_[0-9a-f]{48}$/.test(this.token().trim()));

  protected readonly open = signal<Set<string>>(new Set());
  protected readonly values = signal<Record<string, string>>({});
  protected readonly results = signal<Record<string, TryResult | 'loading'>>({});

  constructor() {
    afterNextRender(async () => {
      try {
        this.spec.set(await (await fetch('/api/v1/openapi.json')).json());
      } catch {
        this.error.set('Não foi possível carregar a especificação da API.');
      }
    });
  }

  protected toggle(path: string) {
    this.open.update((set) => {
      const next = new Set(set);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }

  protected setValue(key: string, value: string) {
    this.values.update((all) => ({ ...all, [key]: value }));
  }

  protected example(op: Operation) {
    return JSON.stringify(op.responses['200']?.content?.['application/json']?.example ?? {}, null, 2);
  }

  // URL final com os parâmetros preenchidos
  protected urlFor(op: Operation) {
    let path = op.path;
    const query = new URLSearchParams();
    for (const p of op.parameters) {
      const value = (this.values()[`${op.path}:${p.name}`] ?? '').trim();
      if (p.in === 'path') path = path.replace(`{${p.name}}`, encodeURIComponent(value || `{${p.name}}`));
      else if (value) query.set(p.name, value);
    }
    const qs = query.toString();
    return `${this.baseUrl()}${path}${qs ? '?' + qs : ''}`;
  }

  protected curl(op: Operation) {
    return `curl -H "Authorization: Bearer ${this.tokenValid() ? this.token().trim() : 'SEU_TOKEN'}" \\\n  "${this.urlFor(op)}"`;
  }

  protected missingRequired(op: Operation) {
    return op.parameters.some((p) => p.required && !(this.values()[`${op.path}:${p.name}`] ?? '').trim());
  }

  // "Experimentar": chama a API de verdade com o token informado (fica registrado na auditoria)
  protected async run(op: Operation) {
    this.results.update((all) => ({ ...all, [op.path]: 'loading' }));
    const started = performance.now();
    let result: TryResult;
    try {
      const response = await fetch(this.urlFor(op), { headers: { Authorization: `Bearer ${this.token().trim()}` } });
      const text = await response.text();
      let body = text;
      try {
        body = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // resposta não é JSON: mostra como veio
      }
      result = { status: response.status, ms: Math.round(performance.now() - started), body };
    } catch {
      result = { status: 0, ms: Math.round(performance.now() - started), body: 'Falha de rede: o servidor não respondeu.' };
    }
    this.results.update((all) => ({ ...all, [op.path]: result }));
  }

  protected result(path: string) {
    const r = this.results()[path];
    return r && r !== 'loading' ? r : null;
  }
}
