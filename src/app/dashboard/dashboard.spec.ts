import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AccountStore } from '../account/account-store';
import { AiStore } from '../ai/ai-store';
import { BacklogStore } from '../backlog/backlog-store';
import { Dashboard } from './dashboard';

// jsdom não tem ResizeObserver (os gráficos medem a largura do card)
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

async function render(email = '') {
  await TestBed.configureTestingModule({ imports: [Dashboard], providers: [provideRouter([])] }).compileComponents();
  TestBed.inject(AccountStore).account.update((a) => ({ ...a, email }));
  const fixture = TestBed.createComponent(Dashboard);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const select = (label: string, value: string) => {
    const field = [...el.querySelectorAll('.project-dash__filter')].find((f) => f.textContent!.includes(label))!;
    const input = field.querySelector('select')!;
    input.value = value;
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };
  return { fixture, el, select };
}

describe('Dashboard (atividades gerais dos setores)', () => {
  it('uses the sector sprint activities: stats, burn-down, burn-up, workload and Gantt by sector', async () => {
    const { el } = await render();
    // Sprint 12 (ativa): 4 atividades gerais com setor (todas do TI); 1 finalizada (antivírus)
    expect(el.querySelector('.stat .stat__value')!.textContent!.trim()).toBe('1');
    expect(el.querySelector('.stat .reports__vs-average')!.textContent).toContain('de 4 na sprint');
    expect(el.querySelectorAll('.chart__line').length).toBeGreaterThanOrEqual(5); // burn-down (2) + burn-up (3 ou 4)
    expect(el.querySelectorAll('.pie__slice').length).toBeGreaterThan(0);
    // Gantt geral: um setor por linha
    const rows = [...el.querySelectorAll('.gantt__name')].map((n) => n.textContent);
    expect(rows).toContain('TI · Acme Ltda');
    // o burn-up usa os nomes das sprints da Planning
    expect([...el.querySelectorAll('.chart text')].some((t) => t.textContent === 'S12')).toBe(true);
  });

  it('filters by sector (Gantt per activity) and by person (shared counts for both)', async () => {
    const { el, select } = await render();
    select('Setor', '4'); // TI
    expect([...el.querySelectorAll('.gantt__name')].map((n) => n.textContent).sort()).toEqual([
      'Atualizar antivírus das máquinas',
      'Automatizar convites da daily',
      'Monitoramento dos servidores',
      'Revisar acessos do Drive',
    ]);
    select('Pessoa', 'Carlos Lima'); // dele + compartilhada com ele
    expect(el.querySelector('.stat .reports__vs-average')!.textContent).toContain('de 2 na sprint');
  });

  it('applies the same visibility rule as the sector kanban', async () => {
    const { el } = await render('carlos.lima@stars.com'); // membro comum
    expect(el.querySelector('.sector-page__notice')).not.toBeNull();
    expect(el.querySelector('.stat .reports__vs-average')!.textContent).toContain('de 2 na sprint');
  });

  it('finishing an activity in the sector kanban updates the dashboard', async () => {
    const { fixture, el } = await render();
    const backlog = TestBed.inject(BacklogStore);
    const item = backlog.items().find((i) => i.name === 'Monitoramento dos servidores')!;
    backlog.setSprintStatus(item.id, 'done', { from: 'Andamento', to: 'Finalizado' });
    fixture.detectChanges();
    expect(backlog.items().find((i) => i.id === item.id)!.doneAt).toBeTruthy();
    expect(el.querySelector('.stat .stat__value')!.textContent!.trim()).toBe('2');
  });

  it('sends the visible dashboard data to the AI and shows the analysis', async () => {
    const { fixture, el, select } = await render('carlos.lima@stars.com'); // membro comum: só vê o que é dele
    const ai = TestBed.inject(AiStore);
    ai.configs.set([{ id: 'x', name: 'Teste', provider: 'anthropic', model: 'm', temperature: 0.5, maxTokens: 800, systemPrompt: '', keyHint: '1234', lastTest: null }]);
    ai.assistantId.set('x');
    const chat = vi.spyOn(ai, 'chat').mockResolvedValue('Diagnóstico: sprint no ritmo.');
    fixture.detectChanges();

    el.querySelector<HTMLButtonElement>('.project-dash__ai-button')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    const prompt = chat.mock.calls[0][0][0].content;
    expect(prompt).toContain('Sprint 12');
    expect(prompt).not.toContain('Monitoramento dos servidores'); // não é visível para o Carlos
    expect(el.querySelector('.project-dash__ai-text')!.textContent).toContain('Diagnóstico: sprint no ritmo.');

    // mudou o filtro: avisa que a análise é de outro recorte
    select('Pessoa', 'Ana Souza');
    expect(el.querySelector('.project-dash__ai-stale')).not.toBeNull();
  });
});
