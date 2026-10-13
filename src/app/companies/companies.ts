import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { MembersStore } from '../members/members-store';
import { Company, CompanyData, CompanyStore, DEFAULT_VIEW, ViewSettings, compressImage } from './company-store';
import { RecentsStore } from '../home/recents-store';
import { cssImage } from '../projects/project-store';

type Filter = 'active' | 'inactive' | 'all';

const empty = (): CompanyData => ({
  name: '',
  description: '',
  site: '',
  active: true,
  image: null,
  timeZone: 'America/Sao_Paulo',
  view: { ...DEFAULT_VIEW },
});

// Todos os fusos que o navegador conhece (lista nativa do Intl)
const TIME_ZONES = Intl.supportedValuesOf('timeZone');

@Component({
  selector: 'app-companies',
  templateUrl: './companies.html',
  host: { class: 'companies' },
})
export class Companies {
  protected readonly cssImage = cssImage;
  protected readonly store = inject(CompanyStore);
  private readonly members = inject(MembersStore);
  protected readonly timeZones = TIME_ZONES;

  protected readonly locales = [
    { id: 'pt-BR', label: 'Português (Brasil)' },
    { id: 'en-US', label: 'English (US)' },
    { id: 'es-ES', label: 'Español' },
  ];
  protected readonly dateFormats = ['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd'];
  protected readonly currencies = [
    { id: 'BRL', label: 'Real (R$)' },
    { id: 'USD', label: 'Dólar (US$)' },
    { id: 'EUR', label: 'Euro (€)' },
  ];

  protected readonly filter = signal<Filter>('active');
  protected readonly list = computed(() => {
    const filter = this.filter();
    return this.store.companies().filter((c) => filter === 'all' || (filter === 'active' ? c.active : !c.active));
  });
  protected readonly counts = computed(() => {
    const all = this.store.companies();
    return { active: all.filter((c) => c.active).length, inactive: all.filter((c) => !c.active).length, all: all.length };
  });

  // Relógio para mostrar a hora local de cada empresa (atualiza a cada minuto)
  protected readonly now = signal(new Date());

  constructor() {
    const destroyRef = inject(DestroyRef);
    const route = inject(ActivatedRoute);
    // Vindo dos "Perfis acessados": ?empresa=ID abre direto
    afterNextRender(() =>
      route.queryParamMap.pipe(takeUntilDestroyed(destroyRef)).subscribe((params) => {
        const found = this.store.companies().find((item) => item.id === Number(params.get('empresa')));
        if (found) this.openEdit(found);
      }),
    );
    afterNextRender(() => {
      const id = setInterval(() => this.now.set(new Date()), 60_000);
      destroyRef.onDestroy(() => clearInterval(id));
    });
  }

  protected localTime(timeZone: string, now = this.now()) {
    return now.toLocaleTimeString('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' });
  }

  protected zoneLabel(timeZone: string) {
    return timeZone.replaceAll('_', ' ');
  }

  protected memberCount(company: Company) {
    return this.members.members().filter((m) => m.company === company.name).length;
  }

  // Exemplo de como datas e valores aparecem com as configurações escolhidas
  protected preview(view: ViewSettings) {
    const date = new Date(2026, 9, 8);
    const pad = (n: number) => String(n).padStart(2, '0');
    const parts = { dd: pad(date.getDate()), MM: pad(date.getMonth() + 1), yyyy: String(date.getFullYear()) };
    const formattedDate = view.dateFormat.replace(/dd|MM|yyyy/g, (token) => parts[token as keyof typeof parts]);
    const money = new Intl.NumberFormat(view.locale, { style: 'currency', currency: view.currency }).format(12345.67);
    return `${formattedDate} · ${money}`;
  }

  protected toggleActive(company: Company) {
    this.store.setActive(company.id, !company.active);
  }

  // ---------- Modal ----------
  private readonly editor = viewChild.required<ElementRef<HTMLDialogElement>>('editor');
  protected readonly editingId = signal<number | null>(null);
  protected readonly draft = signal<CompanyData>(empty());
  protected readonly error = signal('');
  protected readonly imageError = signal('');

  protected openNew() {
    this.editingId.set(null);
    this.draft.set(empty());
    this.openEditor();
  }

  private readonly recents = inject(RecentsStore);

  protected openEdit(company: Company) {
    this.recents.visit('company', company.id);
    this.editingId.set(company.id);
    const { id, cover, ...data } = company;
    this.draft.set({ ...data, view: { ...data.view } });
    this.openEditor();
  }

  private openEditor() {
    this.error.set('');
    this.imageError.set('');
    this.editor().nativeElement.showModal();
  }

  protected closeEditor() {
    this.editor().nativeElement.close();
  }

  protected patch(changes: Partial<CompanyData>) {
    this.draft.update((draft) => ({ ...draft, ...changes }));
  }

  protected patchView(changes: Partial<ViewSettings>) {
    this.draft.update((draft) => ({ ...draft, view: { ...draft.view, ...changes } }));
  }

  protected async onImage(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.imageError.set('Escolha um arquivo de imagem (PNG, JPG, WebP…).');
      return;
    }
    try {
      this.imageError.set('');
      this.patch({ image: await compressImage(file) });
    } catch {
      this.imageError.set('Não foi possível ler essa imagem.');
    }
  }

  protected save(event: Event) {
    event.preventDefault();
    const draft = this.draft();
    if (!draft.name.trim()) {
      this.error.set('Dê um nome para a empresa.');
      return;
    }
    if (this.store.isNameTaken(draft.name, this.editingId())) {
      this.error.set('Já existe um perfil com esse nome.');
      return;
    }
    const id = this.editingId();
    if (id === null) this.store.create(draft);
    else this.store.update(id, draft);
    this.closeEditor();
  }

  protected closeOnBackdrop(event: MouseEvent, dialog: HTMLDialogElement) {
    if (event.target === dialog) dialog.close();
  }
}
