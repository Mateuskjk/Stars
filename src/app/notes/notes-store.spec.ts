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
