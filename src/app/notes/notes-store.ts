import { Injectable, computed, signal } from '@angular/core';
import { api } from '../api/http';

export interface Note {
  id: number;
  title: string;
  content: string;
  created: string; // ISO
  updated: string; // ISO
  dbId?: string; // anotação do banco (tabela Anotacao, a mesma do sistema atual): editar/apagar grava lá também
}

interface RemoteNote {
  id: string;
  texto: string;
  criadoEm: string;
  atualizadoEm: string;
}

// No banco a anotação é um texto só: a 1ª linha vira o título e o resto, o conteúdo
const fromText = (texto: string) => {
  const [first, ...rest] = texto.split('\n');
  return { title: first.trim() || 'Anotação', content: rest.join('\n') };
};
const toText = (note: Note) => (note.content ? `${note.title}\n${note.content}` : note.title);

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
    void this.pull();
  }

  // Traz as anotações do banco que são desta pessoa. As que foram direcionadas para outro perfil saem daqui.
  async pull() {
    let remote: RemoteNote[];
    try {
      remote = await api<RemoteNote[]>('/data/anotacoes');
    } catch {
      return; // sem login ou sem banco: ficam só as notas deste navegador
    }
    const known = new Map(this.notes().filter((n) => n.dbId).map((n) => [n.dbId!, n]));
    let next = Math.max(0, ...this.notes().map((n) => n.id)) + 1;
    const fromDb = remote.map<Note>((r) => {
      const old = known.get(r.id);
      const updated = new Date(r.atualizadoEm).toISOString();
      if (old && old.updated >= updated) return old; // a cópia daqui é a mais nova (ainda gravando)
      return { id: old?.id ?? next++, dbId: r.id, ...fromText(r.texto), created: new Date(r.criadoEm).toISOString(), updated };
    });
    this.notes.set([...fromDb, ...this.notes().filter((n) => !n.dbId)]);
    write(this.notes());
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
    const before = this.notes();
    this.notes.set(notes);
    write(notes);
    // Anotações do banco: o que mudou (inclusive links atualizados por renomear) grava lá; o que saiu, apaga lá
    const after = new Map(notes.map((n) => [n.id, n]));
    for (const old of before.filter((n) => n.dbId)) {
      const now = after.get(old.id);
      if (!now) void api(`/data/anotacoes/${encodeURIComponent(old.dbId!)}`, { method: 'DELETE' }).catch(() => undefined);
      else if (now.title !== old.title || now.content !== old.content) this.saveLater(old.id);
    }
  }

  // Digitação vira uma gravação só (depois de uma pausa). Se falhar, a cópia daqui continua mais nova e vai na próxima edição.
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private saveLater(id: number) {
    clearTimeout(this.timers.get(id));
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        const note = this.notes().find((n) => n.id === id);
        if (!note?.dbId) return;
        void api(`/data/anotacoes/${encodeURIComponent(note.dbId)}`, { method: 'PATCH', body: JSON.stringify({ texto: toText(note) }) }).catch(() => undefined);
      }, 800),
    );
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
