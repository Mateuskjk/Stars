import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AccountStore } from '../account/account-store';
import { BacklogStore } from '../backlog/backlog-store';
import { CompanyPage } from './company-page';
import { SectorPage } from './sector-page';
import { SectorStore } from './sector-store';

// jsdom não implementa showModal/close do <dialog>
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};

async function open(email = '') {
  await TestBed.configureTestingModule({ imports: [SectorPage], providers: [provideRouter([])] }).compileComponents();
  TestBed.inject(AccountStore).account.update((a) => ({ ...a, email }));
  const fixture = TestBed.createComponent(SectorPage);
  fixture.componentRef.setInput('id', '1'); // Acme Ltda
  fixture.componentRef.setInput('sectorId', '4'); // TI
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const cards = () => [...el.querySelectorAll('.backlog-card__name')].map((n) => n.textContent).sort();
  return { fixture, el, cards };
}

describe('SectorPage', () => {
  it('shows the active sprint and only the sector activities in it, in the traditional columns', async () => {
    const { el, cards } = await open();
    expect(el.querySelector('.sector-page__sprint-name')!.textContent).toBe('Sprint 12');
    expect(el.textContent).toContain('de 7 úteis');
    // cada cartão mostra a sprint dele
    expect([...el.querySelectorAll('.backlog-card .backlog-card__sprint')].every((chip) => chip.textContent!.trim() === 'Sprint 12')).toBe(true);
    expect(el.querySelectorAll('.backlog-card .backlog-card__sprint').length).toBe(el.querySelectorAll('.backlog-card').length);
    expect([...el.querySelectorAll('.backlog__column-title h3')].map((h) => h.textContent)).toEqual(['Não iniciado', 'Andamento', 'Revisão', 'Bloqueado', 'Finalizado']);
    // admin vê todas as da sprint; as fora da sprint (Renovar licenças, Treinamento) não aparecem
    expect(cards()).toEqual(['Atualizar antivírus das máquinas', 'Automatizar convites da daily', 'Monitoramento dos servidores', 'Revisar acessos do Drive']);
  });

  it('a member sees only own, shared and team activities; shared ones count for both people', async () => {
    const carlos = await open('carlos.lima@stars.com'); // membro comum, fora da equipe Plataforma
    expect(carlos.cards()).toEqual(['Automatizar convites da daily', 'Revisar acessos do Drive']);
    expect(carlos.el.querySelector('.sector-page__shared-by')!.textContent).toContain('Ana Souza');
    const people = [...carlos.el.querySelectorAll('.sector-page__people li')].map((li) => li.textContent!.replace(/\s+/g, ''));
    expect(people).toContain('CLCarlosLima·2(1⇄)');
    expect(people).toContain('ASAnaSouza·1(1⇄)');

    // Diego é da equipe Plataforma: vê a atividade da equipe (Monitoramento dos servidores) e a própria
    TestBed.resetTestingModule();
    const diego = await open('diego.rocha@stars.com');
    expect(diego.cards()).toEqual(['Atualizar antivírus das máquinas', 'Monitoramento dos servidores']);
  });

  it('new activity enters the active sprint linked to the sector; moving changes the sprint column', async () => {
    const { fixture, el } = await open();
    const backlog = TestBed.inject(BacklogStore);
    el.querySelector<HTMLButtonElement>('.sector-page__kanban .backlog__new')!.click();
    fixture.detectChanges();
    const form = el.querySelector<HTMLFormElement>('.sector-page__new')!;
    form.querySelector<HTMLInputElement>('[name="name"]')!.value = 'Inventário de máquinas';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    const created = backlog.items().at(-1)!;
    expect(created).toMatchObject({ name: 'Inventário de máquinas', sectorId: 4, sprintId: 12, sprintStatus: 'todo', status: 'refinement-done' });

    const select = [...el.querySelectorAll<HTMLSelectElement>('.sector-page__move')].find((s) => s.closest('.backlog-card')!.textContent!.includes('Inventário'))!;
    select.value = 'doing';
    select.dispatchEvent(new Event('change'));
    expect(backlog.items().find((i) => i.id === created.id)!.sprintStatus).toBe('doing');
  });

  it('opens the card modal on the sector page itself (no redirect to the Backlog)', async () => {
    const { fixture, el } = await open();
    el.querySelector<HTMLButtonElement>('.backlog-card__open')!.click();
    fixture.detectChanges();
    const dialog = el.querySelector<HTMLDialogElement>('app-backlog-editor dialog.modal')!;
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector<HTMLInputElement>('input.modal__input')!.value).toBeTruthy();
  });

  it('blocking moves the card to Bloqueado (red) and unblocking returns it; the modal uses the sprint statuses', async () => {
    const { fixture, el } = await open();
    const backlog = TestBed.inject(BacklogStore);
    const item = backlog.items().find((i) => i.name === 'Monitoramento dos servidores')!; // Andamento
    const column = (title: string) => [...el.querySelectorAll('.backlog__column')].find((c) => c.querySelector('h3')!.textContent === title)!;
    const moveSelect = () => [...el.querySelectorAll<HTMLSelectElement>('.sector-page__move')].find((s) => s.closest('.backlog-card')!.textContent!.includes('Monitoramento'))!;

    moveSelect().value = 'blocked';
    moveSelect().dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(backlog.items().find((i) => i.id === item.id)!.locked).toBe(true);
    expect(column('Bloqueado').querySelector('.backlog-card.is-locked')!.textContent).toContain('Monitoramento');

    // o modal mostra os status da sprint, não os do Backlog
    column('Bloqueado').querySelector<HTMLButtonElement>('.backlog-card__open')!.click();
    fixture.detectChanges();
    const options = [...el.querySelectorAll<HTMLOptionElement>('app-backlog-editor .modal__side select option')].map((o) => o.textContent!.trim());
    expect(options.slice(0, 5)).toEqual(['Não iniciado', 'Andamento', 'Revisão', 'Bloqueado', 'Finalizado']);
    expect(el.textContent).toContain('Status na sprint');

    // tirar de Bloqueado desbloqueia e devolve para Andamento
    moveSelect().value = 'doing';
    moveSelect().dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(backlog.items().find((i) => i.id === item.id)).toMatchObject({ locked: false, sprintStatus: 'doing' });
  });

  it('only admins create sectors', async () => {
    await TestBed.configureTestingModule({ imports: [CompanyPage], providers: [provideRouter([])] }).compileComponents();
    TestBed.inject(AccountStore).account.update((a) => ({ ...a, email: 'carlos.lima@stars.com' }));
    const fixture = TestBed.createComponent(CompanyPage);
    fixture.componentRef.setInput('id', '1');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.company-page__sectors .backlog__new')).toBeNull();
    expect(TestBed.inject(SectorStore).create(1, 'Acme Ltda', { name: 'RH', description: '', manager: '', memberIds: [] })).toBeNull();
  });
});
