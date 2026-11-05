import { Component, input, signal } from '@angular/core';
import { Tip, TipState, tipAt } from '../charts/charts';
import { gantt } from '../projects/project-metrics';

// Gantt das atividades (Dashboards): barra cheia = período com o atraso; contorno tracejado = o planejado.
// Usado nas duas abas (por pessoa nas atividades gerais, por projeto nos projetos).
@Component({
  selector: 'app-gantt-chart',
  template: `
    @let g = chart();
    <ul class="legend">
      @for (item of legend(); track item.label) {
        <li class="legend__item"><span class="legend__swatch" [style.background]="item.color"></span>{{ item.label }}</li>
      }
      <li class="legend__item"><span class="gantt__planned-key"></span>Planejado (antes do atraso)</li>
      <li class="legend__item"><span class="gantt__today-key"></span>Hoje</li>
    </ul>
    <div class="gantt">
      <div class="gantt__inner">
        <div class="gantt__head">
          <span class="gantt__label">Atividade</span>
          <div class="gantt__timeline">
            @for (band of g.sprints; track band.number) {
              <span class="gantt__sprint" [class.is-current]="band.current" [style.left.%]="band.left" [style.width.%]="band.width">{{ sprintLabel()(band.number) }}</span>
            }
          </div>
        </div>
        <div class="gantt__body">
          <div class="gantt__grid" aria-hidden="true">
            @for (band of g.sprints; track band.number) {
              <span class="gantt__band" [class.is-current]="band.current" [style.left.%]="band.left" [style.width.%]="band.width"></span>
            }
            <span class="gantt__today" [style.left.%]="g.today"></span>
          </div>
          @for (row of g.rows; track row.id) {
            <div class="gantt__row">
              <div class="gantt__label">
                <span class="gantt__name" [title]="row.label">{{ row.label }}</span>
                <span class="gantt__detail">{{ row.detail }}</span>
              </div>
              <div class="gantt__track">
                @if (row.plannedLeft !== null) {
                  <span class="gantt__planned" [style.left.%]="row.plannedLeft" [style.width.%]="row.plannedWidth" aria-hidden="true"></span>
                }
                <span
                  class="gantt__bar"
                  tabindex="0"
                  [class.is-late]="row.late"
                  [class.is-done]="row.progress === 1"
                  [style.left.%]="row.left"
                  [style.width.%]="row.width"
                  [style.--bar-color]="row.color"
                  [attr.aria-label]="row.label + ': ' + row.tip.rows[0].value + (row.delay ? ', ' + row.delay + ' dias úteis de atraso' : '')"
                  (pointermove)="show($event, row.tip)"
                  (pointerleave)="tip.set(null)"
                  (focus)="show($event, row.tip)"
                  (blur)="tip.set(null)"
                >
                  <span class="gantt__fill" [style.width.%]="row.progress * 100"></span>
                </span>
                @if (row.delay) {
                  <span class="gantt__delay" [style.left.%]="row.left + row.width">+{{ row.delay }}d</span>
                }
              </div>
            </div>
          }
        </div>
      </div>
    </div>
    @if (tip(); as t) {
      <div class="chart-tip" [class.is-flipped]="t.flip" [class.is-above]="t.above" [style.left.px]="t.x" [style.top.px]="t.y" role="tooltip">
        <p class="chart-tip__heading">{{ t.data.heading }}</p>
        @for (r of t.data.rows; track r.name) {
          <p class="chart-tip__row">
            <span class="chart-tip__key" [style.background]="r.color"></span>
            <strong class="chart-tip__value">{{ r.value }}</strong>
            <span class="chart-tip__name">{{ r.name }}</span>
          </p>
        }
      </div>
    }
  `,
})
export class GanttChart {
  readonly chart = input.required<NonNullable<ReturnType<typeof gantt>>>();
  readonly legend = input<{ label: string; color: string }[]>([]);
  readonly sprintLabel = input<(n: number) => string>((n) => `S${n}`);
  protected readonly tip = signal<TipState | null>(null);

  protected show(event: Event, data: Tip) {
    this.tip.set(tipAt(event, data));
  }
}
