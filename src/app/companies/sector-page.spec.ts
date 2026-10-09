import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AccountStore } from '../account/account-store';
import { BacklogStore } from '../backlog/backlog-store';
import { CompanyPage } from './company-page';
import { SectorPage } from './sector-page';
import { SectorStore } from './sector-store';

describe('SectorPage', () => {
  it('shows the sector header, linked projects and a kanban with its backlog/planning activities', async () => {
    await TestBed.configureTestingModule({ imports: [SectorPage], providers: [provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(SectorPage);
    fixture.componentRef.setInput('id', '1'); // Acme Ltda
    fixture.componentRef.setInput('sectorId', '4'); // TI
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const backlog = TestBed.inject(BacklogStore);
    const mine = () => backlog.items().filter((i) => i.sectorId === 4);

    expect(el.querySelector('.project-page__title')!.textContent).toBe('TI');
    expect(el.querySelectorAll('.backlog-card')).toHaveLength(mine().length);
    expect(el.textContent).toContain('Planning: aguardando'); // Treinamento de segurança

    // nova atividade criada aqui já vai para o Backlog ligada ao setor
    el.querySelector<HTMLButtonElement>('.sector-page__kanban .backlog__new')!.click();
    fixture.detectChanges();
    const form = el.querySelector<HTMLFormElement>('.sector-page__new')!;
    form.querySelector<HTMLInputElement>('[name="name"]')!.value = 'Inventário de máquinas';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    expect(backlog.items().at(-1)).toMatchObject({ name: 'Inventário de máquinas', sectorId: 4, status: 'to-refine' });
    expect(el.querySelectorAll('.backlog-card')).toHaveLength(mine().length);
  });

  it('a sector from another company is not found', async () => {
    await TestBed.configureTestingModule({ imports: [SectorPage], providers: [provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(SectorPage);
    fixture.componentRef.setInput('id', '2');
    fixture.componentRef.setInput('sectorId', '4'); // TI é da Acme
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Setor não encontrado');
  });

  it('only admins create sectors', async () => {
    await TestBed.configureTestingModule({ imports: [CompanyPage], providers: [provideRouter([])] }).compileComponents();
    TestBed.inject(AccountStore).account.update((a) => ({ ...a, email: 'carlos.lima@stars.com' })); // membro comum
    const fixture = TestBed.createComponent(CompanyPage);
    fixture.componentRef.setInput('id', '1');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.company-page__sectors .backlog__new')).toBeNull();
    expect(TestBed.inject(SectorStore).create(1, 'Acme Ltda', { name: 'RH', description: '', manager: '' })).toBeNull();
  });
});
