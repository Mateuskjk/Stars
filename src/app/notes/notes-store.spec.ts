import { TestBed } from '@angular/core/testing';
import { NotesStore, linksIn } from './notes-store';

describe('NotesStore', () => {
  beforeEach(() => localStorage.clear());

  it('reads [[links]] without duplicates', () => {
    expect(linksIn('ver [[Ideias]] e [[ ideias ]] e [[Plano Q4]]')).toEqual(['Ideias', 'ideias', 'Plano Q4']);
  });

  it('links notes, finds backlinks, keeps links on rename and saves to localStorage', () => {
    const store = TestBed.inject(NotesStore);
    store.load(); // sem nada salvo: começa com as notas de boas-vindas
    expect(store.notes()).toHaveLength(2);

    const a = store.create('Projeto Alfa', 'Depende de [[Fornecedores]]');
    const b = store.create('Fornecedores', 'Lista de contatos');
    expect(store.backlinks(b).map((n) => n.title)).toEqual(['Projeto Alfa']);
    expect(store.edges()).toContainEqual([a.id, b.id]);

    // Renomear atualiza o link na outra nota
    store.update(b.id, { title: 'Parceiros' });
    store.rename(b.id, 'Fornecedores', 'Parceiros');
    expect(store.notes().find((n) => n.id === a.id)!.content).toBe('Depende de [[Parceiros]]');
    expect(store.edges()).toContainEqual([a.id, b.id]);

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
    expect(store.notes()).toHaveLength(2); // as notas deste navegador continuam

    remote = [{ id: 'db-2', texto: 'Outra', criadoEm: '2026-06-01T10:00:00Z', atualizadoEm: '2026-06-01T10:00:00Z' }];
    await store.pull();
    store.remove(store.notes().find((n) => n.dbId === 'db-2')!.id);
    expect(calls.at(-1)).toMatchObject({ url: '/api/data/anotacoes/db-2', method: 'DELETE' });
    vi.useRealTimers();
  });
});
