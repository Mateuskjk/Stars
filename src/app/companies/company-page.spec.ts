import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CompanyPage } from './company-page';
import { SectorStore } from './sector-store';

// jsdom não implementa showModal/close do <dialog>
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};

describe('CompanyPage', () => {
  it('shows the company header, its sector profiles and creates, edits and deletes sectors', async () => {
    await TestBed.configureTestingModule({ imports: [CompanyPage], providers: [provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(CompanyPage);
    fixture.componentRef.setInput('id', '1'); // Acme Ltda
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const sectors = () => [...el.querySelectorAll('.sector-card h3')].map((h) => h.textContent);
    const submit = (name: string) => {
      const form = el.querySelector<HTMLFormElement>('.sector-editor__form')!;
      form.querySelector<HTMLInputElement>('[name="name"]')!.value = name;
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      fixture.detectChanges();
    };

    expect(el.querySelector('.project-page__title')!.textContent).toBe('Acme Ltda');
    expect(sectors()).toEqual(['Marketing', 'Comercial', 'Financeiro', 'TI']);
    expect(el.querySelector('.sector-card')!.textContent).toContain('Redesign do site');

    // criar
    el.querySelector<HTMLButtonElement>('.company-page__sectors .backlog__new')!.click();
    fixture.detectChanges();
    submit('RH');
    expect(sectors()).toContain('RH');

    // nome repetido na mesma empresa não cria outro
    el.querySelector<HTMLButtonElement>('.company-page__sectors .backlog__new')!.click();
    fixture.detectChanges();
    submit('Marketing');
    expect(el.querySelector('.company-page__error')!.textContent).toContain('Já existe');

    // editar
    const store = TestBed.inject(SectorStore);
    const rh = store.sectors().find((s) => s.name === 'RH')!;
    el.querySelector<HTMLButtonElement>('[aria-label="Editar setor RH"]')!.click();
    fixture.detectChanges();
    submit('Pessoas');
    expect(store.byId(rh.id)!.name).toBe('Pessoas');

    // excluir
    el.querySelector<HTMLButtonElement>('[aria-label="Excluir setor Pessoas"]')!.click();
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('.confirm-dialog__button--danger')!.click();
    fixture.detectChanges();
    expect(sectors()).not.toContain('Pessoas');
  });
});
