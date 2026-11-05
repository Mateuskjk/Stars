import { NgTemplateOutlet } from '@angular/common';
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
  imports: [Dashboard, ProjectDashboard, NgTemplateOutlet],
  host: { class: 'dashboards' },
  template: `
    <!-- As abas vão para dentro da barra de cada painel (mesmo cabeçalho do Work) -->
    <ng-template #tabs>
      <div class="tabs dashboards__tabs" role="tablist" aria-label="Dashboard">
        <button type="button" role="tab" [attr.aria-selected]="tab() === 'sprints'" [class.is-active]="tab() === 'sprints'" (click)="select('sprints')">
          Sprints e setores
        </button>
        <button type="button" role="tab" [attr.aria-selected]="tab() === 'projetos'" [class.is-active]="tab() === 'projetos'" (click)="select('projetos')">
          Projetos
        </button>
      </div>
    </ng-template>
    @if (tab() === 'projetos') {
      <app-project-dashboard><ng-container *ngTemplateOutlet="tabs" /></app-project-dashboard>
    } @else {
      <app-dashboard><ng-container *ngTemplateOutlet="tabs" /></app-dashboard>
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
