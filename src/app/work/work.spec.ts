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
    // Entra como Membro comum (Admin e Supervisor veem os de todos: teste abaixo)
    const members = TestBed.inject(MembersStore);
    members.sessionEmail.set(members.members().find((m) => m.role === 'member')!.email);
    const me = members.current()!.name;
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

    // A geral já concluída na sprint do setor aparece em "Concluída", mesmo com o Backlog em outra coluna
    backlog.items.update((list) => [...list, { ...base, id: 4, name: 'Geral concluída', assignee: me, status: 'refined', sprintStatus: 'done', locked: false, companyId: undefined }]);
    fixture.detectChanges();
    const doneColumn = [...el.querySelectorAll('.kanban__column')].find((c) => c.querySelector('.kanban__column-title')?.textContent === 'Concluída')!;
    expect(doneColumn.textContent).toContain('Geral concluída');

    // Mover a geral para "Em andamento" abre o pop-up sugerindo "Andamento" na sprint do setor; confirmar move lá
    const select = el.querySelector<HTMLSelectElement>('.kanban__move')!;
    select.value = 'doing';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const dialog = el.querySelector('dialog')!;
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain('As colunas são diferentes');
    expect(dialog.querySelector<HTMLSelectElement>('.modal__input')!.value).toBe('doing');
    dialog.querySelector<HTMLButtonElement>('.confirm-dialog__button--primary')!.click();
    fixture.detectChanges();
    expect(dialog.open).toBe(false);
    expect(backlog.items().find((i) => i.id === 1)!.sprintStatus).toBe('doing');

    // Cancelar não muda nada
    const again = el.querySelector<HTMLSelectElement>('.kanban__move')!;
    again.value = 'done';
    again.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    dialog.querySelector<HTMLButtonElement>('.confirm-dialog__button')!.click();
    expect(backlog.items().find((i) => i.id === 1)!.sprintStatus).toBe('doing');

    // Clicar no cartão abre o modal certo aqui mesmo: geral → modal do Backlog; projeto → modal do projeto
    const backlogModal = el.querySelector<HTMLDialogElement>('dialog[aria-labelledby="editor-title"]')!;
    const taskModal = el.querySelector<HTMLDialogElement>('dialog[aria-labelledby="task-editor-title"]')!;
    const card = (title: string) => [...el.querySelectorAll<HTMLElement>('.kanban__card-title')].find((b) => b.textContent?.trim() === title)!;
    card('Geral minha').click();
    fixture.detectChanges();
    expect(backlogModal.open).toBe(true);
    expect(taskModal.open).toBe(false);
    backlogModal.close();
    card('Projeto minha').click();
    fixture.detectChanges();
    expect(taskModal.open).toBe(true);
    taskModal.close();

    // O seletor "Mover" do cartão não abre o modal
    el.querySelector<HTMLSelectElement>('.kanban__move')!.click();
    expect(backlogModal.open || taskModal.open).toBe(false);
  });

  it('Admin vê as atividades de todos da empresa e filtra por pessoa e por origem', async () => {
    await TestBed.configureTestingModule({ imports: [Work], providers: [provideRouter([])] }).compileComponents();
    const members = TestBed.inject(MembersStore);
    const admin = members.current()!; // sem login, o Admin de exemplo
    expect(admin.role).toBe('admin');
    const backlog = TestBed.inject(BacklogStore);
    const tasks = TestBed.inject(ProjectTaskStore);
    const active = TestBed.inject(SprintStore).active()!;
    const base = { ...backlog.items()[0], sprintId: active.id, status: 'refinement-done' as const, locked: false, companyId: undefined, sharedWith: [] };
    backlog.items.set([
      { ...base, id: 1, name: 'Geral do Admin', assignee: admin.name },
      { ...base, id: 2, name: 'Geral da Outra', assignee: 'Outra Pessoa' },
    ]);
    const task = tasks.tasks()[0];
    tasks.tasks.set([{ ...task, id: 7, title: 'Projeto da Outra', assignee: 'Outra Pessoa', status: 'todo', sprint: sprintOf(active.start) }]);

    const fixture = TestBed.createComponent(Work);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const titles = () => [...el.querySelectorAll('.kanban__card-title')].map((a) => a.textContent?.trim()).sort();
    expect(titles()).toEqual(['Geral da Outra', 'Geral do Admin', 'Projeto da Outra']);
    expect(el.querySelector('.work__assignee')).not.toBeNull(); // mostra de quem é cada cartão

    const [person, origin] = [...el.querySelectorAll<HTMLSelectElement>('.work__filters select')];
    person.innerHTML += '<option value="Outra Pessoa">Outra Pessoa</option>'; // a pessoa de exemplo não está na lista da empresa
    person.value = 'Outra Pessoa';
    person.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(titles()).toEqual(['Geral da Outra', 'Projeto da Outra']);

    origin.value = 'geral';
    origin.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(titles()).toEqual(['Geral da Outra']);
  });
});
