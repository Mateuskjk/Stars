import { Injectable, computed, signal } from '@angular/core';

export interface Note {
  id: number;
  title: string;
  content: string;
  created: string; // ISO
  updated: string; // ISO
}

const KEY = 'stars.notes';

// [[Título]] — mesmo formato de link do Obsidian
export const LINK = /\[\[([^\[\]]+)\]\]/g;
const normalize = (title: string) => title.trim().toLowerCase();

// Títulos citados com [[...]] no texto (sem repetir)
export function linksIn(content: string) {
  return [...new Set([...content.matchAll(LINK)].map((match) => match[1].trim()))];
}

const now = () => new Date().toISOString();

function welcomeNotes(): Note[] {
  const at = now();
  return [
    {
      id: 1,
      title: 'Bem-vindo às notas',
      content:
        'Estas notas são só suas: ficam salvas neste navegador.\n\n' +
        'Para ligar uma nota em outra, escreva o título entre colchetes duplos, assim: [[Ideias]].\n' +
        'Se a nota ainda não existir, clique no link para criá-la.\n\n' +
        'Veja também [[Como organizar o brain]].',
      created: at,
      updated: at,
    },
    {
      id: 2,
      title: 'Como organizar o brain',
      content:
        'Cada link entre notas vira uma ligação no grafo do Brain.\n' +
        'Notas com muitos links (como [[Bem-vindo às notas]]) viram os centros do seu cérebro.',
      created: at,
      updated: at,
    },
  ];
}

// Notas pessoais (com links entre si). Também é a fonte do grafo da rota Brain.
// ponytail: guardadas no localStorage (só neste navegador); trocar read/write por API se um dia sincronizar entre aparelhos
@Injectable({ providedIn: 'root' })
export class NotesStore {
  readonly notes = signal<Note[]>([]);
  private loaded = false;

  // Chamado no navegador depois da primeira renderização (no SSR não existe localStorage)
  load() {
    if (this.loaded) return;
    this.loaded = true;
    const saved = read();
    this.notes.set(saved ?? welcomeNotes());
    if (!saved) write(this.notes());
  }

  // Links resolvidos entre notas existentes: [de, para] por id (é o que o Brain desenha)
  readonly edges = computed(() => {
    const byTitle = new Map(this.notes().map((note) => [normalize(note.title), note.id]));
    return this.notes().flatMap((note) =>
      linksIn(note.content)
        .map((title) => byTitle.get(normalize(title)))
        .filter((target): target is number => target !== undefined && target !== note.id)
        .map((target) => [note.id, target] as const),
    );
  });

  findByTitle(title: string) {
    return this.notes().find((note) => normalize(note.title) === normalize(title)) ?? null;
  }

  // Notas que citam esta nota
  backlinks(note: Note) {
    const title = normalize(note.title);
    return this.notes().filter((other) => other.id !== note.id && linksIn(other.content).some((t) => normalize(t) === title));
  }

  create(title: string, content = '') {
    const at = now();
    const note: Note = { id: Math.max(0, ...this.notes().map((n) => n.id)) + 1, title: title.trim() || 'Sem título', content, created: at, updated: at };
    this.commit([note, ...this.notes()]);
    return note;
  }

  update(id: number, changes: Partial<Pick<Note, 'title' | 'content'>>) {
    this.commit(this.notes().map((note) => (note.id === id ? { ...note, ...changes, updated: now() } : note)));
  }

  // Renomear atualiza os [[links]] das outras notas, para nenhuma ligação quebrar
  rename(id: number, oldTitle: string, newTitle: string) {
    if (normalize(oldTitle) === normalize(newTitle) || !oldTitle.trim()) return;
    const old = normalize(oldTitle);
    this.commit(
      this.notes().map((note) => {
        if (note.id === id) return note;
        const content = note.content.replace(LINK, (match, title: string) => (normalize(title) === old ? `[[${newTitle.trim()}]]` : match));
        return content === note.content ? note : { ...note, content, updated: now() };
      }),
    );
  }

  remove(id: number) {
    this.commit(this.notes().filter((note) => note.id !== id));
  }

  private commit(notes: Note[]) {
    this.notes.set(notes);
    write(notes);
  }
}

function read(): Note[] | null {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

function write(notes: Note[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(notes));
  } catch {
    // armazenamento cheio ou bloqueado: as notas ficam só nesta sessão
  }
}
