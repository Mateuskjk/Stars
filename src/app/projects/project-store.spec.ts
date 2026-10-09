import { TestBed } from '@angular/core/testing';
import { ProjectStore } from './project-store';

describe('ProjectStore', () => {
  let store: ProjectStore;
  beforeEach(() => (store = TestBed.inject(ProjectStore)));

  it('agrega um projeto a outro (só um nível) e separa', () => {
    store.setParent(2, 1);
    expect(store.childrenOf(1).map((p) => p.id)).toEqual([2]);
    expect(store.topLevel().some((p) => p.id === 2)).toBe(false); // some do kanban e do carrossel

    store.setParent(1, 3); // principal com agregados não vira secundário
    expect(store.projects().find((p) => p.id === 1)?.parentId).toBeFalsy();
    store.setParent(3, 2); // não agrega dentro de um secundário
    expect(store.projects().find((p) => p.id === 3)?.parentId).toBeFalsy();

    store.setParent(2, null);
    expect(store.childrenOf(1)).toEqual([]);
  });

  it('excluir tira o projeto e solta os agregados', () => {
    store.setParent(2, 1);
    store.remove(1);
    expect(store.projects().some((p) => p.id === 1)).toBe(false);
    expect(store.projects().find((p) => p.id === 2)?.parentId).toBeNull();
  });

  it('só mostra projetos de empresas ativas', () => {
    const total = store.visible().length;
    const company = store.projects()[0].company;
    store.activeCompanies.set(new Set(store.projects().map((p) => p.company).filter((c) => c !== company)));
    expect(store.visible().length).toBe(total - store.projects().filter((p) => p.company === company).length);
  });

  it('a foto vira a capa', () => {
    store.setImage(1, 'data:image/jpeg;base64,AAA');
    expect(store.projects()[0].cover).toContain('url("data:image/jpeg;base64,AAA")');
    store.setImage(1, null);
    expect(store.projects()[0].cover).toContain('linear-gradient');
  });
});
