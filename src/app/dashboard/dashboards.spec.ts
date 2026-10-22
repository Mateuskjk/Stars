import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';

describe('Dashboards (abas)', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter(routes)] }));

  it('abre em Sprints e setores e troca para Projetos pela aba (fica na URL)', async () => {
    const harness = await RouterTestingHarness.create('/dashboards');
    const el = harness.routeNativeElement!;
    expect(el.querySelector('app-dashboard')).not.toBeNull();
    expect(el.querySelector('app-project-dashboard')).toBeNull();

    [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent?.trim() === 'Projetos')!.click();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(TestBed.inject(Router).url).toBe('/dashboards?aba=projetos');
    expect(el.querySelector('app-project-dashboard')).not.toBeNull();
    expect(el.querySelector('app-dashboard')).toBeNull();
  });

  it('o endereço antigo do Dash de Projetos leva para a aba Projetos, mantendo o projeto escolhido', async () => {
    await RouterTestingHarness.create('/projetos?projeto=3');
    expect(TestBed.inject(Router).url).toBe('/dashboards?projeto=3&aba=projetos');
  });
});
