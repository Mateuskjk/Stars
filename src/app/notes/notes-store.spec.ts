import { TestBed } from '@angular/core/testing';
import { NotesStore } from './notes-store';

describe('NotesStore', () => {
  beforeEach(() => localStorage.clear());

  it('creates, finds by title and saves to localStorage', () => {
    const store = TestBed.inject(NotesStore);
    store.load(); // sem nada salvo: começa com a nota de boas-vindas
    expect(store.notes()).toHaveLength(1);

    const a = store.create('Projeto Alfa', 'Lista de fornecedores');
    expect(store.findByTitle(' projeto alfa ')!.id).toBe(a.id);
    store.update(a.id, { title: 'Parceiros' });

    // Persistido: uma nova "sessão" lê do localStorage
    const saved = JSON.parse(localStorage.getItem('stars.notes')!);
    expect(saved.map((n: { title: string }) => n.title)).toContain('Parceiros');
  });
});

describe('NotesStore com as anotações do banco', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('traz as minhas anotações, grava edições e exclusões lá e tira as que foram para outro perfil', async () => {
    vi.useFakeTimers();
    const calls: { url: string; method: string; body?: string }[] = [];
    let remote = [{ id: 'db-1', texto: 'Ideias\nlinha 2', criadoEm: '2026-06-01T10:00:00Z', atualizadoEm: '2026-06-01T10:00:00Z' }];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body as string | undefined });
      return init.method ? new Response(null, { status: 204 }) : Response.json(remote);
    });
    const store = TestBed.inject(NotesStore);
    store.load();
    await store.pull();
    const note = store.notes().find((n) => n.dbId === 'db-1')!;
    expect(note).toMatchObject({ title: 'Ideias', content: 'linha 2' });

    store.update(note.id, { content: 'linha nova' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls.at(-1)).toEqual({ url: '/api/data/anotacoes/db-1', method: 'PATCH', body: JSON.stringify({ texto: 'Ideias\nlinha nova' }) });

    remote = []; // o Admin direcionou para outra pessoa
    await store.pull();
    expect(store.notes().some((n) => n.dbId)).toBe(false);
    expect(store.notes()).toHaveLength(1); // a nota deste navegador continua

    remote = [{ id: 'db-2', texto: 'Outra', criadoEm: '2026-06-01T10:00:00Z', atualizadoEm: '2026-06-01T10:00:00Z' }];
    await store.pull();
    store.remove(store.notes().find((n) => n.dbId === 'db-2')!.id);
    expect(calls.at(-1)).toMatchObject({ url: '/api/data/anotacoes/db-2', method: 'DELETE' });
    vi.useRealTimers();
  });
});
