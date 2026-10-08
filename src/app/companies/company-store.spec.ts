import { TestBed } from '@angular/core/testing';
import { MembersStore } from '../members/members-store';
import { ProjectStore } from '../projects/project-store';
import { CompanyStore } from './company-store';

describe('CompanyStore', () => {
  it('feeds the Home carousel only with active profiles shown in the carousel, using the image as cover', () => {
    const store = TestBed.inject(CompanyStore);
    const acme = store.companies().find((c) => c.name === 'Acme Ltda')!;
    const nova = store.companies().find((c) => c.name === 'Nova Tech')!;

    store.update(acme.id, { ...acme, image: 'data:image/jpeg;base64,AAA' });
    store.setActive(nova.id, false);

    const names = store.carouselItems().map((item) => item.name);
    expect(names).toContain('Acme Ltda');
    expect(names).not.toContain('Nova Tech');
    expect(store.carouselItems().find((i) => i.name === 'Acme Ltda')!.cover).toContain('url("data:image/jpeg;base64,AAA")');
    expect(store.activeNames()).not.toContain('Nova Tech');

    const lumen = store.companies().find((c) => c.name === 'Lumen Saúde')!;
    store.update(lumen.id, { ...lumen, view: { ...lumen.view, showInCarousel: false } });
    expect(store.carouselItems().map((i) => i.name)).not.toContain('Lumen Saúde');
  });

  it('renaming a profile keeps members and projects linked', () => {
    const store = TestBed.inject(CompanyStore);
    const members = TestBed.inject(MembersStore);
    const projects = TestBed.inject(ProjectStore);
    const acme = store.companies().find((c) => c.name === 'Acme Ltda')!;
    const before = members.members().filter((m) => m.company === 'Acme Ltda').length;

    store.update(acme.id, { ...acme, name: 'Acme S.A.' });

    expect(members.members().filter((m) => m.company === 'Acme S.A.')).toHaveLength(before);
    expect(members.members().some((m) => m.company === 'Acme Ltda')).toBe(false);
    expect(projects.projects().some((p) => p.company === 'Acme Ltda')).toBe(false);
    expect(store.isNameTaken('acme s.a.', null)).toBe(true);
  });
});
