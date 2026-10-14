import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Archive } from './archive';
import { ProjectTaskEditor } from '../projects/project-task-editor';
import { ProjectTaskStore } from '../projects/project-tasks';
import { ProjectStore } from '../projects/project-store';
import { SessionStore } from '../api/session';

// jsdom não implementa showModal/close do <dialog>
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};

const tick = () => new Promise((resolve) => setTimeout(resolve));

describe('Arquivo', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows archived activities, archived projects and suspended companies in tabs', async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body as string | undefined });
      if (init.method) return Response.json({ ok: true });
      return Response.json(
        url.includes('suspensas')
          ? [{ id: 't1', nome: 'Empresa Suspensa', sigla: 'ES', membros: 3 }]
          : [{ id: 'a1', titulo: 'Atividade velha', projetoId: null, arquivadoTipo: 'CANCELADO', arquivadoEm: '2026-09-01T12:00:00Z' }],
      );
    });
    await TestBed.configureTestingModule({ imports: [Archive], providers: [provideRouter([])] }).compileComponents();
    const archived = TestBed.inject(ProjectStore).projects().find((p) => p.status === 'archived')!;
    const reload = vi.spyOn(TestBed.inject(SessionStore), 'check').mockResolvedValue(); // recarregar tudo do banco: fora deste teste
    const fixture = TestBed.createComponent(Archive);
    await tick();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const tabs = el.querySelectorAll<HTMLButtonElement>('[role="tab"]');

    expect(el.querySelector('.archive__list')!.textContent).toContain('Atividade velha');
    expect(el.querySelector('.archive__list')!.textContent).toContain('Cancelada');
    el.querySelector<HTMLButtonElement>('.archive__action')!.click(); // Restaurar a atividade
    await tick();
    expect(calls.find((c) => c.method === 'PATCH')).toEqual({ url: '/api/data/atividades/a1', method: 'PATCH', body: JSON.stringify({ arquivado: null }) });

    tabs[1].click();
    fixture.detectChanges();
    expect(el.querySelector('.archive__list')!.textContent).toContain(archived.name);
    const row = [...el.querySelectorAll('.archive__item')].find((r) => r.textContent?.includes(archived.name))!;
    row.querySelector<HTMLButtonElement>('.archive__action')!.click();
    fixture.detectChanges();
    expect(TestBed.inject(ProjectStore).projects().find((p) => p.id === archived.id)!.status).toBe('not-started');

    tabs[2].click();
    fixture.detectChanges();
    expect(el.querySelector('.archive__list')!.textContent).toContain('Empresa Suspensa');
    expect(el.querySelector('.archive__list')!.textContent).toContain('3 membros');
    // espera o restaurar anterior terminar (os botões ficam travados enquanto isso)
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector<HTMLButtonElement>('.archive__action')!.disabled).toBe(false);
    });
    el.querySelector<HTMLButtonElement>('.archive__action')!.click(); // Reativar
    await vi.waitFor(() => expect(calls.some((c) => c.url === '/api/data/empresas/t1/reativar' && c.method === 'POST')).toBe(true));
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(2)); // depois de restaurar e de reativar, os dados recarregam
  });

  it('project activity modal archives instead of deleting and has no step buttons', async () => {
    const fixture = TestBed.createComponent(ProjectTaskEditor);
    fixture.detectChanges();
    const tasks = TestBed.inject(ProjectTaskStore);
    const task = tasks.tasks()[0];
    (fixture.componentInstance as ProjectTaskEditor).open(task);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const buttons = [...el.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(buttons).not.toContain('← Recuar');
    expect(buttons).not.toContain('Excluir');
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Arquivar')!.click();
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('.confirm-dialog__button--primary')!.click();
    expect(tasks.tasks().some((t) => t.id === task.id)).toBe(false);
  });
});
