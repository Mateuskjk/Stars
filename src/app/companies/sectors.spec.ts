import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CompanyStore } from './company-store';
import { SectorStore } from './sector-store';
import { Sectors } from './sectors';

describe('Sectors (aba Setores)', () => {
  it('mostra só os setores da empresa escolhida e troca junto com ela', async () => {
    await TestBed.configureTestingModule({ imports: [Sectors], providers: [provideRouter([])] }).compileComponents();
    const companies = TestBed.inject(CompanyStore);
    const sectors = TestBed.inject(SectorStore);
    const fixture = TestBed.createComponent(Sectors);
    const el = fixture.nativeElement as HTMLElement;
    const names = () => [...el.querySelectorAll('.sector-card h3')].map((h) => h.textContent!.trim());
    const of = (id: number) => sectors.ofCompany(id).map((s) => s.name);

    companies.currentId.set(null);
    fixture.detectChanges();
    expect(el.textContent).toContain('Escolha uma empresa');

    const [first, second] = companies.companies().filter((c) => sectors.ofCompany(c.id).length);
    companies.currentId.set(first.id);
    fixture.detectChanges();
    expect(names()).toEqual(of(first.id));

    if (second) {
      companies.currentId.set(second.id);
      fixture.detectChanges();
      expect(names()).toEqual(of(second.id));
    }
  });
});
