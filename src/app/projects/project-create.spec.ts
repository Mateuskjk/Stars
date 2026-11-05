import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import { ProjectCreate } from './project-create';
import { ProjectStore } from './project-store';

// jsdom não implementa showModal/close do <dialog>
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};

describe('ProjectCreate', () => {
  async function open() {
    await TestBed.configureTestingModule({ imports: [ProjectCreate], providers: [provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(ProjectCreate);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const click = (selector: string, text?: string) => {
      const buttons = [...el.querySelectorAll<HTMLElement>(selector)];
      (text ? buttons.find((b) => b.textContent!.trim() === text) : buttons[0])!.click();
      fixture.detectChanges();
    };
    const field = (name: string) => el.querySelector<HTMLInputElement | HTMLSelectElement>(`dialog [name="${name}"]`)!;
    const submit = () => {
      el.querySelector('dialog form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      fixture.detectChanges();
    };
    click('[aria-label="Ver em lista"]'); // abre no kanban; os testes usam a lista
    return { fixture, el, click, field, submit, store: TestBed.inject(ProjectStore) };
  }

  it('creates a project from the "+ Novo projeto" window', async () => {
    const { el, click, field, submit, store } = await open();
    const before = store.topLevel().length;

    click('.backlog__new', '+ Novo projeto');
    field('name').value = 'Portal B2B';
    field('status').value = 'review';
    field('costInitial').value = '1500.5';
    field('sector').value = 'Financeiro';
    submit();

    const created = store.projects().at(-1)!;
    expect(created).toMatchObject({ name: 'Portal B2B', status: 'review', costInitial: 1500.5, sector: 'Financeiro' });
    expect(store.topLevel()).toHaveLength(before + 1);
    expect(el.querySelectorAll('tbody tr')).toHaveLength(before + 1);
    expect(el.querySelector<HTMLDialogElement>('dialog')!.open).toBe(false);
  });

  it('opens a project with its data, edits and deletes it', async () => {
    const { el, click, field, submit, store } = await open();
    const project = store.visible()[0];

    click('.project-create__open');
    expect(el.querySelector('dialog .modal__title')!.textContent).toBe(project.name);
    expect(el.querySelector('table')!.textContent).not.toContain(project.description); // a descrição só aparece aqui dentro

    click('dialog button', 'Editar');
    field('name').value = 'Nome novo';
    submit();
    expect(store.projects().find((p) => p.id === project.id)!.name).toBe('Nome novo');
    expect(el.querySelector('dialog .modal__title')!.textContent).toBe('Nome novo'); // volta para os dados

    click('dialog button', 'Excluir');
    click('dialog button', 'Excluir'); // confirmação
    expect(store.projects().some((p) => p.id === project.id)).toBe(false);
  });

  it('shows the projects kanban (the old Geral) in kanban view', async () => {
    const { el, click } = await open();
    click('[aria-label="Ver em kanban"]');
    expect(el.querySelector('app-projects .kanban__column')).not.toBeNull();
    expect(el.querySelector('table')).toBeNull();
  });

  it('is the only Projects screen: the old addresses lead to it', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
    const harness = await RouterTestingHarness.create();
    for (const old of ['/projetos/visaoGeral', '/projetos/novo', '/projetos']) {
      await harness.navigateByUrl(old);
      expect(TestBed.inject(Router).url).toBe('/projetos');
      expect(harness.routeNativeElement!.querySelector('app-board-toolbar')).not.toBeNull();
    }
  });

  it('filters by name in the search', async () => {
    const { el, fixture, store } = await open();
    const name = store.visible()[1].name;
    const input = el.querySelector<HTMLInputElement>('.board-toolbar__search input')!;
    input.value = name;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect([...el.querySelectorAll('.project-create__open')].map((b) => b.textContent!.trim())).toContain(name);
    expect(el.querySelectorAll('tbody tr').length).toBeLessThan(store.visible().length);
  });
});
