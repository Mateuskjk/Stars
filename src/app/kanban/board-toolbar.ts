import { Component, ElementRef, computed, effect, inject, input, model, signal, untracked } from '@angular/core';

export type BoardView = 'board' | 'list';

// Campo que dá para filtrar (Responsável, Etiqueta…) e as opções dele
export interface FilterField {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

// Uma linha do painel de filtros: "Onde <campo> é <valor>" (valor vazio = linha ainda sem escolha, não filtra)
export interface FilterRule {
  key: string;
  value: string;
}

// Busca sem diferenciar maiúsculas nem acentos
export function matchesQuery(text: string, query: string) {
  const q = normalize(query);
  return !q || normalize(text).includes(q);
}

// Linhas do mesmo campo valem como "ou"; campos diferentes, como "e"
export function passesFilters(rules: FilterRule[], valueOf: (key: string) => string | string[]) {
  const byKey = new Map<string, string[]>();
  for (const r of rules) if (r.value) byKey.set(r.key, [...(byKey.get(r.key) ?? []), r.value]);
  for (const [key, wanted] of byKey) {
    const has = [valueOf(key)].flat();
    if (!wanted.some((w) => has.includes(w))) return false;
  }
  return true;
}

// Opções de um campo a partir dos valores que existem (sem repetir, em ordem alfabética)
export function optionsOf(values: (string | undefined | null)[]) {
  return [...new Set(values.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: v }));
}

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

// Barra acima dos kanbans (padrão LexPré): busca, painel de filtros aberto pelo botão "Filtro" e a troca entre
// kanban e lista. A visualização escolhida fica salva neste navegador, por tela.
@Component({
  selector: 'app-board-toolbar',
  host: {
    class: 'board-toolbar',
    '(document:click)': 'closeOnOutsideClick($event)',
    '(document:keydown.escape)': 'filtersOpen.set(false)',
  },
  template: `
    @if (search()) {
    <label class="board-toolbar__search">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16.5 16.5 3.5 3.5" />
      </svg>
      <input
        type="search"
        [placeholder]="'Buscar em ' + count() + ' ' + noun() + '…'"
        [attr.aria-label]="'Buscar ' + noun()"
        [value]="query()"
        (input)="query.set($any($event.target).value)"
      />
    </label>
    }
    @if (fields().length) {
      <div class="board-toolbar__filter">
        <button
          class="board-toolbar__button"
          type="button"
          [class.is-active]="filtersOpen() || active() > 0"
          [attr.aria-expanded]="filtersOpen()"
          (click)="toggleFilters()"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" />
            <circle cx="16" cy="6" r="2" />
            <circle cx="10" cy="12" r="2" />
            <circle cx="18" cy="18" r="2" />
          </svg>
          Filtro
          @if (active()) {
            <span class="board-toolbar__badge">{{ active() }}</span>
          }
        </button>
        @if (filtersOpen()) {
          <div class="board-toolbar__panel" role="dialog" aria-label="Filtros">
            @for (rule of filters(); track $index; let i = $index) {
              <div class="board-toolbar__rule">
                <span class="board-toolbar__where">{{ i === 0 ? 'Onde' : 'e' }}</span>
                <select class="board-toolbar__select" aria-label="Campo" (change)="setRule(i, { key: $any($event.target).value, value: '' })">
                  @for (f of fields(); track f.key) {
                    <option [value]="f.key" [selected]="f.key === rule.key">{{ f.label }}</option>
                  }
                </select>
                <select
                  class="board-toolbar__select board-toolbar__select--value"
                  aria-label="Valor"
                  (change)="setRule(i, { key: rule.key, value: $any($event.target).value })"
                >
                  <option value="" [selected]="!rule.value">Selecione…</option>
                  @for (o of optionsFor(rule.key); track o.value) {
                    <option [value]="o.value" [selected]="o.value === rule.value">
                      {{ o.label }}
                    </option>
                  }
                </select>
                <button class="board-toolbar__remove" type="button" aria-label="Remover filtro" title="Remover filtro" (click)="removeRule(i)">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                  </svg>
                </button>
              </div>
            }
            <button class="board-toolbar__add" type="button" (click)="addRule()">+ Adicionar filtro</button>
          </div>
        }
      </div>
    }
    @if (views()) {
      <div class="board-toolbar__views" role="group" aria-label="Visualização">
        <button
          type="button"
          title="Lista"
          aria-label="Ver em lista"
          [class.is-active]="view() === 'list'"
          [attr.aria-pressed]="view() === 'list'"
          (click)="view.set('list')"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
          </svg>
        </button>
        <button
          type="button"
          [title]="boardLabel()"
          [attr.aria-label]="'Ver em ' + boardLabel().toLowerCase()"
          [class.is-active]="view() === 'board'"
          [attr.aria-pressed]="view() === 'board'"
          (click)="view.set('board')"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="4" y="4" width="6" height="6" rx="1" />
            <rect x="14" y="4" width="6" height="6" rx="1" />
            <rect x="4" y="14" width="6" height="6" rx="1" />
            <rect x="14" y="14" width="6" height="6" rx="1" />
          </svg>
        </button>
      </div>
    }
    <!-- Ações da tela (ex.: "+ Nova atividade"), depois da troca kanban/lista -->
    <ng-content />
  `,
})
export class BoardToolbar {
  readonly count = input.required<number>();
  readonly noun = input('atividades');
  readonly search = input(true); // Dashboards: só filtros, sem busca
  // Telas que não são kanban (Planning) escondem a troca kanban/lista
  readonly views = input(true);
  // Nome da visualização em quadro ("Kanban"; na tela de projetos, "Grade")
  readonly boardLabel = input('Kanban');
  // Campos do painel de filtros (sem campos, o botão "Filtro" não aparece)
  readonly fields = input<FilterField[]>([]);
  readonly filters = model<FilterRule[]>([]);
  // Chave para lembrar a visualização desta tela
  readonly storageKey = input.required<string>();
  // Filtros salvos por registro (ex.: cada setor e cada projeto com os seus); a visualização segue a da tela
  readonly filterKey = input('');
  readonly query = model('');
  readonly view = model<BoardView>('board');
  protected readonly filtersOpen = signal(false);
  protected readonly active = computed(() => this.filters().filter((r) => r.value).length);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    let loaded = false;
    effect(() => {
      const key = `stars.view.${this.storageKey()}`;
      const view = this.view(); // lido sempre, para o efeito acompanhar as trocas
      if (!loaded) {
        loaded = true;
        try {
          const saved = localStorage.getItem(key);
          if (saved === 'board' || saved === 'list') this.view.set(saved);
        } catch {
          // sem acesso ao localStorage: abre no kanban
        }
        return;
      }
      try {
        localStorage.setItem(key, view);
      } catch {
        // sem espaço ou sem permissão: vale só nesta visita
      }
    });

    // Filtros também ficam salvos neste navegador, por tela, até a pessoa mudar. Na volta, só os que ainda
    // existem (campo e valor nas opções de agora): sprint apagada ou pessoa que saiu não filtram sem aparecer.
    let filtersLoaded = false;
    effect(() => {
      const key = `stars.filters.${this.storageKey()}${this.filterKey() ? '.' + this.filterKey() : ''}`;
      const rules = this.filters();
      if (!filtersLoaded) {
        filtersLoaded = true;
        if (rules.length) return; // a tela já abriu com filtro (ex.: link com ?projeto=)
        try {
          const saved = JSON.parse(localStorage.getItem(key) ?? '[]') as FilterRule[];
          const fields = untracked(this.fields);
          const valid = (Array.isArray(saved) ? saved : []).filter((r) => {
            const field = fields.find((f) => f.key === r?.key);
            return field && typeof r.value === 'string' && (!r.value || field.options.some((o) => o.value === r.value));
          });
          if (valid.some((r) => r.value)) this.filters.set(valid.filter((r) => r.value));
        } catch {
          // sem acesso ao localStorage ou valor estragado: abre sem filtros
        }
        return;
      }
      try {
        localStorage.setItem(key, JSON.stringify(rules.filter((r) => r.value)));
      } catch {
        // sem espaço ou sem permissão: vale só nesta visita
      }
    });
  }

  protected optionsFor(key: string) {
    return this.fields().find((f) => f.key === key)?.options ?? [];
  }

  // Abrir sem nenhuma linha já mostra uma, pronta para escolher
  protected toggleFilters() {
    this.filtersOpen.update((open) => !open);
    if (this.filtersOpen() && !this.filters().length) this.addRule();
  }

  // A linha nova usa um campo que ainda não está no painel (ou o primeiro, se todos já estão)
  protected addRule() {
    const used = new Set(this.filters().map((r) => r.key));
    const field = this.fields().find((f) => !used.has(f.key)) ?? this.fields()[0];
    this.filters.update((list) => [...list, { key: field.key, value: '' }]);
  }

  protected setRule(index: number, rule: FilterRule) {
    this.filters.update((list) => list.map((r, i) => (i === index ? rule : r)));
  }

  protected removeRule(index: number) {
    this.filters.update((list) => list.filter((_, i) => i !== index));
  }

  protected closeOnOutsideClick(event: Event) {
    const target = event.target as Element;
    // isConnected: o clique na lixeira tira o botão da página antes deste teste
    if (target.isConnected && !this.host.nativeElement.querySelector('.board-toolbar__filter')?.contains(target)) this.filtersOpen.set(false);
  }
}
