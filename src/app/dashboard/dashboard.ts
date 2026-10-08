import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { H, MUTED, PAD, SERIES, Tip, TipState, columnChart, lineChart, pieChart, plotH, tipAt, watchChartWidth } from '../charts/charts';

@Component({
  imports: [NgTemplateOutlet],
  selector: 'app-dashboard',
  templateUrl: './dashboard.html',
  host: { class: 'dashboard' },
})
export class Dashboard {
  // Largura útil dos cards de gráfico, medida no navegador (320 é só o valor inicial do SSR)
  private readonly chartWidth = signal(320);
  protected readonly viewBox = computed(() => `0 0 ${this.chartWidth()} ${H}`);
  protected readonly plot = computed(() => ({
    left: PAD.left,
    right: this.chartWidth() - PAD.right,
    bottom: PAD.top + plotH,
    labelY: H - 6,
  }));

  constructor() {
    watchChartWidth('.dashboard__charts .dash-card', this.chartWidth);
  }

  // Dica única da página, posicionada junto ao ponteiro (ou ao elemento, quando vem do teclado)
  protected readonly tip = signal<TipState | null>(null);

  protected showTip(event: Event, data: Tip) {
    this.tip.set(tipAt(event, data));
  }

  protected hideTip() {
    this.tip.set(null);
  }

  // ponytail: números fixos de exemplo; trocar por um service/API quando o backend existir
  protected readonly stats = [
    { label: 'Entregues na sprint', value: 40, delta: 6, upIsGood: true },
    { label: 'Atividades represadas', value: 7, delta: 2, upIsGood: false },
    { label: 'Atividades aguardando', value: 12, delta: -3, upIsGood: false },
    { label: 'Atividades na fila', value: 23, delta: 5, upIsGood: false },
  ];

  protected readonly completion = {
    total: 71,
    projects: [
      { name: 'CRM interno', value: 91 },
      { name: 'Redesign do site', value: 82 },
      { name: 'App mobile', value: 64 },
      { name: 'Portal do cliente', value: 45 },
    ],
  };

  protected readonly deliveries = computed(() =>
    columnChart(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'], [12, 15, 9, 18, 14, 20, 17, 22], 30, 10, this.chartWidth(), (label, value) => ({
      heading: `Semana ${label.slice(1)}`,
      rows: [{ name: 'entregues', value: String(value), color: SERIES[0] }],
    })),
  );

  private readonly days = Array.from({ length: 10 }, (_, i) => `D${i + 1}`);

  protected readonly burnUp = computed(() =>
    lineChart(
      this.days,
      [
        { name: 'Escopo', color: SERIES[1], values: [40, 40, 44, 44, 46, 46, 48, 48, 48, 48] },
        { name: 'Concluído', color: SERIES[0], values: [0, 4, 9, 13, 18, 22, 27, 31, 36, 40] },
      ],
      50,
      10,
      this.chartWidth(),
    ),
  );

  protected readonly burnDown = computed(() =>
    lineChart(
      this.days,
      [
        { name: 'Ideal', color: MUTED, values: [48, 43, 37, 32, 27, 21, 16, 11, 5, 0] },
        { name: 'Real', color: SERIES[0], values: [48, 46, 42, 40, 35, 33, 28, 24, 20, 12] },
      ],
      50,
      10,
      this.chartWidth(),
    ),
  );

  protected readonly workload = pieChart([
    { name: 'Ana', value: 14 },
    { name: 'Carlos', value: 11 },
    { name: 'Bruna', value: 9 },
    { name: 'Diego', value: 7 },
    { name: 'Eva', value: 5 },
  ]);

  protected readonly secondSprint = [
    { name: 'Integração de pagamento', value: 60 },
    { name: 'Migração do banco', value: 50 },
    { name: 'Tela de relatórios', value: 35 },
    { name: 'Testes end-to-end', value: 20 },
  ];
}
