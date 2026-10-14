import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { formatTime } from '../chat/chat';
import { formatWeekDate } from '../home/home';
import { RecentsStore } from '../home/recents-store';
import { api } from '../api/http';
import { MembersStore } from '../members/members-store';
import { LINK, Note, NotesStore, linksIn } from './notes-store';

type Segment = { text: string } | { link: string; exists: boolean };
interface RoutedNote {
  id: string;
  previa: string;
  tenantId: string;
  autorId: string;
  autor: string;
  autorAtivo: boolean;
  atualizadoEm: string;
}
interface Routing {
  anotacoes: RoutedNote[];
  pessoas: { id: string; nome: string; tenantId: string }[];
}

// Busca sem diferenciar maiúsculas nem acentos
const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

@Component({
  selector: 'app-notes',
  templateUrl: './notes.html',
  host: {
    class: 'notes',
    '[class.has-active]': 'selected() !== null',
  },
})
export class Notes {
  protected readonly store = inject(NotesStore);
  protected readonly weekDate = formatWeekDate(new Date());
  protected readonly formatTime = formatTime;

  protected readonly selectedId = signal<number | null>(null);
  protected readonly mode = signal<'read' | 'edit'>('read');
  protected readonly search = signal('');

  protected readonly list = computed(() => {
    const term = normalize(this.search());
    return [...this.store.notes()]
      .filter((note) => normalize(note.title + ' ' + note.content).includes(term))
      .sort((a, b) => b.updated.localeCompare(a.updated));
  });

  protected readonly selected = computed(() => this.store.notes().find((note) => note.id === this.selectedId()) ?? null);
  protected readonly backlinks = computed(() => {
    const note = this.selected();
    return note ? this.store.backlinks(note) : [];
  });
  protected readonly outgoing = computed(() => {
    const note = this.selected();
    return note ? linksIn(note.content).length : 0;
  });
  protected readonly duplicateTitle = computed(() => {
    const note = this.selected();
    return !!note && this.store.notes().some((other) => other.id !== note.id && normalize(other.title.trim()) === normalize(note.title.trim()));
  });
  protected readonly others = computed(() => this.store.notes().filter((note) => note.id !== this.selectedId()));

  // Texto da nota quebrado em pedaços: texto comum e links [[...]]
  protected readonly segments = computed<Segment[]>(() => {
    const content = this.selected()?.content ?? '';
    const parts: Segment[] = [];
    let last = 0;
    for (const match of content.matchAll(LINK)) {
      if (match.index > last) parts.push({ text: content.slice(last, match.index) });
      const title = match[1].trim();
      parts.push({ link: title, exists: !!this.store.findByTitle(title) });
      last = match.index + match[0].length;
    }
    if (last < content.length) parts.push({ text: content.slice(last) });
    return parts;
  });

  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly recents = inject(RecentsStore);

  constructor() {
    afterNextRender(() => {
      this.store.load();
      // Vindo do Brain ou dos Recentes: /workspace/notes?nota=ID abre a nota direto
      this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
        const note = this.store.notes().find((n) => n.id === Number(params.get('nota')));
        if (note) this.open(note);
      });
    });
  }

  protected isLink(segment: Segment): segment is { link: string; exists: boolean } {
    return 'link' in segment;
  }

  protected toDate(iso: string) {
    return new Date(iso);
  }

  protected linkCount(note: Note) {
    return linksIn(note.content).length;
  }

  protected preview(note: Note) {
    return note.content.replace(LINK, '$1').replace(/\s+/g, ' ').slice(0, 80);
  }

  protected open(note: Note, mode: 'read' | 'edit' = note.content ? 'read' : 'edit') {
    this.commitTitle(); // se estava renomeando outra nota, conclui antes de trocar
    this.selectedId.set(note.id);
    this.titleBeforeEdit = note.title;
    this.recents.visit('note', note.id);
    this.mode.set(mode);
  }

  protected newNote() {
    let title = 'Sem título';
    for (let n = 2; this.store.findByTitle(title); n++) title = `Sem título ${n}`;
    this.open(this.store.create(title), 'edit');
  }

  // Nota do dia, como na Daily: uma por data, criada com um modelo
  protected openToday() {
    const title = `Nota do dia ${new Date().toLocaleDateString('pt-BR')}`;
    const note = this.store.findByTitle(title) ?? this.store.create(title, '## O que fiz hoje\n\n\n## Ideias\n\n\n## Pendências\n');
    this.open(note, 'edit');
  }

  // Clicar num link abre a nota; se ela não existir, cria (igual ao Obsidian)
  protected openLink(title: string) {
    const note = this.store.findByTitle(title) ?? this.store.create(title);
    this.open(note);
  }

  // Renomear: o título de quando a nota foi aberta fica guardado; ao sair do campo, os links são atualizados
  private titleBeforeEdit = '';

  protected commitTitle() {
    const note = this.selected();
    if (!note || note.title === this.titleBeforeEdit) return;
    if (!note.title.trim()) this.store.update(note.id, { title: this.titleBeforeEdit || 'Sem título' });
    this.store.rename(note.id, this.titleBeforeEdit, this.selected()!.title);
    this.titleBeforeEdit = this.selected()!.title;
  }

  protected edit(field: 'title' | 'content', value: string) {
    const id = this.selectedId();
    if (id !== null) this.store.update(id, { [field]: value });
  }

  // Inserir [[link]] onde está o cursor
  private readonly editor = viewChild<ElementRef<HTMLTextAreaElement>>('editor');

  protected insertLink(select: HTMLSelectElement) {
    const title = select.value;
    select.value = '';
    const textarea = this.editor()?.nativeElement;
    if (!title || !textarea) return;
    const { selectionStart: start, selectionEnd: end, value } = textarea;
    const link = `[[${title}]]`;
    this.edit('content', value.slice(0, start) + link + value.slice(end));
    // devolve o cursor para depois do link
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + link.length, start + link.length);
    });
  }

  // Exclusão com confirmação
  private readonly confirmDialog = viewChild.required<ElementRef<HTMLDialogElement>>('confirmDialog');

  protected askDelete() {
    this.confirmDialog().nativeElement.showModal();
  }

  protected cancelDelete() {
    this.confirmDialog().nativeElement.close();
  }

  protected confirmDelete() {
    const id = this.selectedId();
    if (id !== null) this.store.remove(id);
    this.selectedId.set(null);
    this.confirmDialog().nativeElement.close();
  }

  // ---------- Direcionar anotações do banco para o perfil de cada pessoa (Admin) ----------
  protected readonly isAdmin = inject(MembersStore).isAdmin;
  private readonly routeDialog = viewChild.required<ElementRef<HTMLDialogElement>>('routeDialog');
  protected readonly routing = signal<Routing | null>(null);
  protected readonly targets = signal<Record<string, string>>({}); // id da anotação → id do usuário escolhido
  protected readonly routeMessage = signal('');
  protected readonly changed = computed(() => (this.routing()?.anotacoes ?? []).filter((n) => this.targets()[n.id] !== n.autorId));

  protected async openRouting() {
    this.routeMessage.set('');
    this.routing.set(null);
    this.routeDialog().nativeElement.showModal();
    try {
      const data = await api<Routing>('/data/anotacoes/direcionar');
      this.routing.set(data);
      this.targets.set(Object.fromEntries(data.anotacoes.map((n) => [n.id, n.autorId])));
    } catch (error) {
      this.routeMessage.set((error as Error).message);
    }
  }

  // Só as pessoas da mesma empresa da anotação
  protected peopleFor(note: RoutedNote) {
    return this.routing()!.pessoas.filter((p) => p.tenantId === note.tenantId);
  }

  protected setTarget(id: string, userId: string) {
    this.targets.update((t) => ({ ...t, [id]: userId }));
  }

  protected async saveRouting() {
    const itens = this.changed().map((n) => ({ id: n.id, usuarioId: this.targets()[n.id] }));
    try {
      const { movidas } = await api<{ movidas: number }>('/data/anotacoes/direcionar', { method: 'POST', body: JSON.stringify({ itens }) });
      await this.openRouting(); // recarrega com os autores novos
      this.routeMessage.set(`${movidas} ${movidas === 1 ? 'anotação direcionada' : 'anotações direcionadas'}. Elas aparecem nas Notas de cada pessoa.`);
      await this.store.pull(); // alguma pode ter vindo (ou saído) para mim
    } catch (error) {
      this.routeMessage.set((error as Error).message);
    }
  }

  protected closeOnBackdrop(event: MouseEvent, dialog: HTMLDialogElement) {
    if (event.target === dialog) dialog.close();
  }
}
