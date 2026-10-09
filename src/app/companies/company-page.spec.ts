import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CompanyPage } from './company-page';
import { SectorStore } from './sector-store';

describe('CompanyPage', () => {
  it('shows the company header, its sector profiles and creates a sector', async () => {
    await TestBed.configureTestingModule({ imports: [CompanyPage], providers: [provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(CompanyPage);
    fixture.componentRef.setInput('id', '1'); // Acme Ltda
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const sectors = () => [...el.querySelectorAll('.sector-card h3')].map((h) => h.textContent);

    expect(el.querySelector('.project-page__title')!.textContent).toBe('Acme Ltda');
    expect(sectors()).toEqual(['Marketing', 'Comercial', 'Financeiro', 'TI']);
    // o perfil do setor lista os projetos da empresa naquele setor
    const marketing = el.querySelector('.sector-card')!;
    expect(marketing.textContent).toContain('Redesign do site');

    el.querySelector<HTMLButtonElement>('.company-page__sectors .backlog__new')!.click();
    fixture.detectChanges();
    const form = el.querySelector<HTMLFormElement>('.company-page__new')!;
    form.querySelector<HTMLInputElement>('[name="name"]')!.value = 'RH';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    expect(sectors()).toContain('RH');
    expect(TestBed.inject(SectorStore).isNameTaken(1, 'rh')).toBe(true);

    // nome repetido na mesma empresa não cria outro
    el.querySelector<HTMLButtonElement>('.company-page__sectors .backlog__new')!.click();
    fixture.detectChanges();
    const again = el.querySelector<HTMLFormElement>('.company-page__new')!;
    again.querySelector<HTMLInputElement>('[name="name"]')!.value = 'Marketing';
    again.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    expect(el.querySelector('.company-page__error')!.textContent).toContain('Já existe');
    expect(sectors().filter((s) => s === 'Marketing')).toHaveLength(1);
  });
});
