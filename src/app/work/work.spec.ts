import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Work } from './work';
import { BacklogStore } from '../backlog/backlog-store';
import { MembersStore } from '../members/members-store';
import { ProjectTaskStore, sprintOf } from '../projects/project-tasks';
import { SprintStore } from '../planning/sprint-store';

// jsdom não implementa showModal/close do <dialog>
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};

describe('Work', () => {
  it('shows only my current-sprint general and project activities and moves them in the origin kanban through the pop-up', async () => {
    await TestBed.configureTestingModule({ imports: [Work], providers: [provideRouter([])] }).compileComponents();
    const me = TestBed.inject(MembersStore).current()!.name;
    const backlog = TestBed.inject(BacklogStore);
    const tasks = TestBed.inject(ProjectTaskStore);
    // Uma atividade geral minha em "Para refinar", uma de outra pessoa e uma de projeto minha em "A fazer"
    const active = TestBed.inject(SprintStore).active()!;
    const base = { ...backlog.items()[0], sprintId: active.id };
    backlog.items.set([
      { ...base, id: 1, name: 'Geral minha', assignee: me, status: 'to-refine', locked: false, companyId: undefined },
      { ...base, id: 3, name: 'Geral fora da sprint', assignee: me, sprintId: undefined, status: 'to-refine', locked: false, companyId: undefined },
      { ...base, id: 2, name: 'Geral de outro', assignee: 'Outra Pessoa', sharedWith: [], status: 'to-refine', companyId: undefined },
    ]);
    const task = tasks.tasks()[0];
    const n = sprintOf(active.start);
    tasks.tasks.set([
      { ...task, id: 7, title: 'Projeto minha', assignee: me, status: 'todo', sprint: n },
      { ...task, id: 8, title: 'Projeto sprint passada', assignee: me, status: 'todo', sprint: n - 1 },
    ]);

    const fixture = TestBed.createComponent(Work);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const titles = [...el.querySelectorAll('.kanban__card-title')].map((a) => a.textContent?.trim());
    expect(titles).toContain('Geral minha');
    expect(titles).not.toContain('Geral de outro');
    expect(titles).toContain('Projeto minha');
    expect(titles).not.toContain('Geral fora da sprint');
    expect(titles).not.toContain('Projeto sprint passada');
    expect(el.querySelector('a')).toBeNull(); // não leva para outros kanbans

    // Mover a geral para "Em andamento" abre o pop-up sugerindo "Refinado" no Backlog; confirmar move lá
    const select = el.querySelector<HTMLSelectElement>('.kanban__move')!;
    select.value = 'doing';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const dialog = el.querySelector('dialog')!;
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain('As colunas são diferentes');
    expect(dialog.querySelector<HTMLSelectElement>('.modal__input')!.value).toBe('refined');
    dialog.querySelector<HTMLButtonElement>('.confirm-dialog__button--primary')!.click();
    fixture.detectChanges();
    expect(dialog.open).toBe(false);
    expect(backlog.items().find((i) => i.id === 1)!.status).toBe('refined');

    // Cancelar não muda nada
    const again = el.querySelector<HTMLSelectElement>('.kanban__move')!;
    again.value = 'done';
    again.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    dialog.querySelector<HTMLButtonElement>('.confirm-dialog__button')!.click();
    expect(backlog.items().find((i) => i.id === 1)!.status).toBe('refined');
  });
});
