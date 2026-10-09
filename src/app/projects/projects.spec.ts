import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AccountStore } from '../account/account-store';
import { Projects } from './projects';

// jsdom não implementa showModal/close do <dialog>
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};

describe('Projects kanban', () => {
  it('lists projects by status, moves them and creates columns', async () => {
    await TestBed.configureTestingModule({ imports: [Projects], providers: [provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(Projects);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const count = (label: string) =>
      Number([...el.querySelectorAll('.kanban__column')].find((c) => c.querySelector('h3')!.textContent === label)?.querySelector('.kanban__count')!.textContent);

    expect(count('Em andamento')).toBe(2);
    expect(count('Cancelado')).toBe(0);

    const select = el.querySelector<HTMLSelectElement>('.kanban__move')!; // primeiro projeto da primeira coluna com cards
    select.value = 'canceled';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(count('Cancelado')).toBe(1);

    el.querySelector<HTMLButtonElement>('.add-column__open')!.click();
    fixture.detectChanges();
    const input = el.querySelector<HTMLInputElement>('.add-column__input')!;
    input.value = 'Homologação';
    input.form!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(count('Homologação')).toBe(0);
    expect(el.querySelectorAll('.kanban__column').length).toBe(10);

    // só a coluna criada tem renomear/excluir
    const actions = () => el.querySelectorAll<HTMLButtonElement>('.column-title__action');
    expect(actions().length).toBe(2);
    actions()[0].click();
    fixture.detectChanges();
    const rename = el.querySelector<HTMLInputElement>('.column-title__input')!;
    rename.value = 'Homologar';
    rename.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    expect(count('Homologar')).toBe(0);

    // excluir manda os projetos para a primeira coluna
    const cancelSelect = [...el.querySelectorAll<HTMLSelectElement>('.kanban__move')].find((s) => s.value === 'canceled')!;
    cancelSelect.value = [...cancelSelect.options].at(-1)!.value;
    cancelSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(count('Homologar')).toBe(1);
    el.querySelector<HTMLButtonElement>('.confirm-dialog__button--danger')!.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('.kanban__column').length).toBe(9);
    expect(count('Ideia')).toBe(1);
  });

  it('only admins can create, rename or delete columns', async () => {
    await TestBed.configureTestingModule({ imports: [Projects], providers: [provideRouter([])] }).compileComponents();
    const account = TestBed.inject(AccountStore);
    account.account.update((a) => ({ ...a, email: 'carlos.lima@stars.com' })); // membro comum
    const fixture = TestBed.createComponent(Projects);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-add-column')).toBeNull();
    expect(el.querySelector('.column-title__action')).toBeNull();
  });

  it('clicking a project card opens the project page (the "Mover para" select does not)', async () => {
    await TestBed.configureTestingModule({ imports: [Projects], providers: [provideRouter([])] }).compileComponents();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(Projects);
    fixture.detectChanges();
    const card = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.kanban__card')!;

    card.querySelector('select')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(navigate).not.toHaveBeenCalled();

    card.querySelector<HTMLElement>('.kanban__description, .kanban__card-footer')!.click();
    expect(navigate).toHaveBeenCalledWith(['/projetos', expect.any(Number)]);
  });
});
