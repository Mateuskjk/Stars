import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { ProjectDashboard } from '../projects/project-dashboard';
import { Dashboard } from './dashboard';

type Tab = 'sprints' | 'projetos';

// Dashboards: uma tela com duas abas — atividades gerais dos setores (sprints) e projetos.
// A aba fica na URL (?aba=projetos), então dá para linkar direto e o voltar do navegador funciona.
@Component({
  selector: 'app-dashboards',
  imports: [Dashboard, ProjectDashboard],
  host: { class: 'dashboards' },
  template: `
    <header class="project-dash__header">
      <h2 class="backlog__title">Dashboards</h2>
    </header>
    <div class="tabs" role="tablist" aria-label="Dashboard">
      <button type="button" role="tab" [attr.aria-selected]="tab() === 'sprints'" [class.is-active]="tab() === 'sprints'" (click)="select('sprints')">
        Sprints e setores
      </button>
      <button type="button" role="tab" [attr.aria-selected]="tab() === 'projetos'" [class.is-active]="tab() === 'projetos'" (click)="select('projetos')">
        Projetos
      </button>
    </div>
    @if (tab() === 'projetos') {
      <app-project-dashboard />
    } @else {
      <app-dashboard />
    }
  `,
})
export class Dashboards {
  private readonly router = inject(Router);
  protected readonly tab = toSignal(inject(ActivatedRoute).queryParamMap.pipe(map((p): Tab => (p.get('aba') === 'projetos' ? 'projetos' : 'sprints'))), {
    initialValue: 'sprints' as Tab,
  });

  protected select(tab: Tab) {
    void this.router.navigate([], { queryParams: { aba: tab === 'projetos' ? 'projetos' : null, projeto: null } });
  }
}
