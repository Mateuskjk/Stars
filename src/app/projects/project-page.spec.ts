import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ProjectPage } from './project-page';
import { ProjectTaskStore } from './project-tasks';

describe('ProjectPage', () => {
  it('shows the project header and a kanban with only its activities', async () => {
    await TestBed.configureTestingModule({ imports: [ProjectPage], providers: [provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(ProjectPage);
    fixture.componentRef.setInput('id', '2'); // App mobile
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const store = TestBed.inject(ProjectTaskStore);
    const mine = () => store.tasks().filter((t) => t.projectId === 2);
    const cards = () => el.querySelectorAll('.kanban__card').length;

    expect(el.querySelector('.project-page__title')!.textContent).toBe('App mobile');
    expect(el.textContent).toContain('Setor');
    expect(cards()).toBe(mine().length);

    // mover para Concluída marca a data de entrega
    const task = mine().find((t) => t.status !== 'done')!;
    store.setStatus(task.id, 'done');
    expect(store.tasks().find((t) => t.id === task.id)!.doneAt).not.toBeNull();

    // nova atividade entra só neste projeto
    el.querySelector<HTMLButtonElement>('.project-page__kanban-head .backlog__new')!.click();
    fixture.detectChanges();
    const form = el.querySelector<HTMLFormElement>('.project-page__new')!;
    form.querySelector<HTMLInputElement>('[name="title"]')!.value = 'Tela de pedidos';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    expect(mine().at(-1)).toMatchObject({ title: 'Tela de pedidos', projectId: 2, status: 'todo', points: 3 });
    expect(cards()).toBe(mine().length);
  });

  it('shows a message for an unknown project', async () => {
    await TestBed.configureTestingModule({ imports: [ProjectPage], providers: [provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(ProjectPage);
    fixture.componentRef.setInput('id', '999');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Projeto não encontrado');
  });
});
