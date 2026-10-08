import { Component, computed, inject, signal } from '@angular/core';
import { H, PAD, SERIES, Tip, TipState, groupedColumns, lineChart, plotH, tipAt, watchChartWidth } from '../charts/charts';
import { SprintStore } from '../planning/sprint-store';
import { METRICS, MetricKey, ReportSprint, SAMPLE_METRICS, average, change, formatValue, isGood, lastSprints, toCsv, valueOf } from './report-data';

// Planejado em cinza (contexto) e entregue na cor de destaque: o que importa é o entregue
const PLANNED_COLOR = '#b6b9c0';
const DELIVERED_COLOR = SERIES[0];

@Component({
  selector: 'app-reports',
  templateUrl: './reports.html',
  host: { class: 'reports' },
})
export class Reports {
  private readonly sprintStore = inject(SprintStore);
  protected readonly metrics = METRICS;
  protected readonly formatValue = formatValue;
  protected readonly valueOf = valueOf;
  protected readonly colors = { planned: PLANNED_COLOR, delivered: DELIVERED_COLOR };

  protected readonly sprints = computed(() => lastSprints(this.sprintStore.sprints(), SAMPLE_METRICS));
  protected readonly latest = computed(() => this.sprints().at(-1) ?? null);
  protected readonly previous = computed(() => this.sprints().at(-2) ?? null);
  protected readonly activeSprint = this.sprintStore.active;

  protected readonly period = computed(() => {
    const list = this.sprints();
    return list.length ? `${this.day(list[0].start)} a ${this.day(list.at(-1)!.end)}` : '';
  });

  protected day(iso: string) {
    const [, month, day] = iso.split('-');
    return `${day}/${month}`;
  }

  // ---------- Indicadores: última sprint vs anterior e vs média ----------
  protected readonly highlights: { key: MetricKey; label: string }[] = [
    { key: 'delivered', label: 'Velocidade' },
    { key: 'completion', label: 'Taxa de conclusão' },
    { key: 'cycleDays', label: 'Tempo de ciclo' },
    { key: 'carryOver', label: 'Levadas p/ próxima' },
  ];

  protected stat(key: MetricKey) {
    const latest = this.latest();
    const previous = this.previous();
    if (!latest) return null;
    const value = valueOf(latest, key);
    const prev = previous ? valueOf(previous, key) : value;
    const avg = average(this.sprints(), key);
    return {
      value: formatValue(key, value),
      diff: value - prev,
      diffText: this.signed(key, value - prev),
      good: isGood(key, value - prev),
      vsAverage: change(value, avg),
      avgGood: isGood(key, value - avg),
    };
  }

  // Diferença de uma porcentagem é em pontos percentuais (84% → 91% = +7 p.p.)
  private signed(key: MetricKey, delta: number) {
    const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
    return key === 'completion' ? `${sign}${Math.abs(delta)} p.p.` : sign + formatValue(key, Math.abs(delta));
  }

  protected percent(value: number) {
    return `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(Math.round(value))}%`;
  }

  // ---------- Comparativo (tabela) ----------
  protected average(key: MetricKey) {
    return formatValue(key, average(this.sprints(), key));
  }

  protected lastChange(key: MetricKey) {
    const latest = this.latest();
    const previous = this.previous();
    if (!latest || !previous) return null;
    const delta = valueOf(latest, key) - valueOf(previous, key);
    return { text: this.signed(key, delta), good: isGood(key, delta) };
  }

  // Melhor e pior sprint em cada métrica (para marcar na tabela)
  protected best(key: MetricKey, sprint: ReportSprint) {
    const values = this.sprints().map((s) => valueOf(s, key));
    const better = METRICS.find((m) => m.key === key)!.better;
    const target = better === 'up' ? Math.max(...values) : Math.min(...values);
    return valueOf(sprint, key) === target && new Set(values).size > 1;
  }

  // ---------- Destaques escritos ----------
  protected readonly insights = computed(() => {
    const list = this.sprints();
    if (list.length < 2) return [];
    const first = list[0];
    const last = list.at(-1)!;
    const best = [...list].sort((a, b) => b.metrics.completion - a.metrics.completion)[0];
    const velocity = change(last.metrics.delivered, first.metrics.delivered);
    const cycle = change(last.metrics.cycleDays, first.metrics.cycleDays);
    return [
      `Velocidade ${velocity >= 0 ? 'subiu' : 'caiu'} ${Math.abs(Math.round(velocity))}% no período (${first.metrics.delivered} → ${last.metrics.delivered} pts).`,
      `Melhor taxa de conclusão: ${best.name}, com ${best.metrics.completion}%.`,
      `Tempo de ciclo ${cycle <= 0 ? 'melhorou' : 'piorou'} ${Math.abs(Math.round(cycle))}% (${formatValue('cycleDays', first.metrics.cycleDays)} → ${formatValue('cycleDays', last.metrics.cycleDays)}).`,
      `Média de ${formatValue('carryOver', average(list, 'carryOver'))} atividades levadas para a sprint seguinte.`,
    ];
  });

  // ---------- Gráficos ----------
  private readonly chartWidth = signal(320);
  protected readonly viewBox = computed(() => `0 0 ${this.chartWidth()} ${H}`);
  protected readonly plot = computed(() => ({ left: PAD.left, right: this.chartWidth() - PAD.right, bottom: PAD.top + plotH, labelY: H - 6 }));

  protected readonly pointsChart = computed(() => {
    const list = this.sprints();
    return groupedColumns(
      list.map((s) => s.name),
      [
        { name: 'Planejado', color: PLANNED_COLOR, values: list.map((s) => s.metrics.planned) },
        { name: 'Entregue', color: DELIVERED_COLOR, values: list.map((s) => s.metrics.delivered) },
      ],
      50,
      10,
      this.chartWidth(),
      ' pts',
    );
  });

  protected readonly completionChart = computed(() => {
    const list = this.sprints();
    return lineChart(list.map((s) => s.name), [{ name: 'Conclusão (%)', color: DELIVERED_COLOR, values: list.map((s) => s.metrics.completion) }], 100, 25, this.chartWidth());
  });

  constructor() {
    watchChartWidth('.reports__charts .dash-card', this.chartWidth);
  }

  protected readonly tip = signal<TipState | null>(null);

  protected showTip(event: Event, data: Tip) {
    this.tip.set(tipAt(event, data));
  }

  // ---------- Exportar ----------
  protected print() {
    window.print(); // o navegador oferece "Salvar como PDF"
  }

  protected exportCsv() {
    // BOM no início para o Excel reconhecer os acentos
    const blob = new Blob(['﻿' + toCsv(this.sprints())], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), { href: url, download: `relatorio-sprints-${new Date().toISOString().slice(0, 10)}.csv` });
    link.click();
    URL.revokeObjectURL(url);
  }
}
