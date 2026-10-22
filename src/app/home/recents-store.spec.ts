import { TestBed } from '@angular/core/testing';
import { BacklogStore } from '../backlog/backlog-store';
import { NotesStore } from '../notes/notes-store';
import { RecentsStore } from './recents-store';

describe('RecentsStore', () => {
  beforeEach(() => localStorage.clear());

  it('lists only what was opened and still exists, most recent first', () => {
    const recents = TestBed.inject(RecentsStore);
    const notes = TestBed.inject(NotesStore);
    const backlog = TestBed.inject(BacklogStore);
    recents.load();

    const note = notes.notes()[0];
    const card = backlog.items()[0];
    recents.visit('project', 2);
    recents.visit('note', note.id);
    recents.visit('card', card.id);
    recents.visit('project', 2); // de novo: sobe para o topo, sem repetir
    recents.visit('project', 999); // não existe

    expect(recents.items().map((i) => `${i.type}: ${i.title}`)).toEqual([
      'Projeto: App mobile',
      `Cartão: ${card.name}`,
      `Nota: ${note.title}`,
    ]);

    // apagou a nota: some dos Recentes; renomeou o cartão: o nome novo aparece
    notes.notes.update((list) => list.filter((n) => n.id !== note.id));
    backlog.items.update((list) => list.map((i) => (i.id === card.id ? { ...i, name: 'Cartão renomeado' } : i)));
    expect(recents.items().map((i) => i.title)).toEqual(['App mobile', 'Cartão renomeado']);
    expect(JSON.parse(localStorage.getItem('stars.recents')!)).toHaveLength(4);
  });

  it('keeps accessed profiles (members, teams, companies) in their own list', () => {
    const recents = TestBed.inject(RecentsStore);
    recents.load();
    recents.visit('member', 1);
    recents.visit('project', 1);
    recents.visit('member', 999); // não existe
    expect(recents.profiles().map((p) => `${p.type}: ${p.title} (${p.initials})`)).toEqual(['Perfil: Ana Souza (AS)']);
    expect(recents.items().map((i) => i.type)).toEqual(['Projeto']);
  });
});
