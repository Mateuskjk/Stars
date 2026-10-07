import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, signal } from '@angular/core';

// Cores da paleta de gráficos (validada contra o fundo #faf9f6)
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];
const MUTED = '#898781';

// Área de desenho dos gráficos de linha e coluna. A largura vem do card (em px reais),
// então o SVG não é esticado e o texto fica sempre do mesmo tamanho em qualquer tela.
const H = 200;
const PAD = { left: 28, right: 72, top: 12, bottom: 24 };
const plotH = H - PAD.top - PAD.bottom;
const yOf = (value: number, max: number) => PAD.top + plotH - (value / max) * plotH;

// Conteúdo da dica do hover: título (dia, semana, pessoa) e um valor por série
interface Tip {
  heading: string;
  rows: { name: string; value: string; color: string }[];
}

interface Series {
  name: string;
  color: string;
  values: number[];
}

function lineChart(labels: string[], series: Series[], max: number, step: number, w: number) {
  const plotW = w - PAD.left - PAD.right;
  const xOf = (i: number) => PAD.left + (i * plotW) / (labels.length - 1);
  const band = plotW / (labels.length - 1);
  return {
    ticks: ticks(max, step),
    xLabels: labels.map((text, i) => ({ text, x: xOf(i) })),
    lines: series.map((s) => {
      const last = s.values.length - 1;
      return {
        ...s,
        path: s.values.map((v, i) => `${i ? 'L' : 'M'}${xOf(i)},${yOf(v, max)}`).join(''),
        end: { x: xOf(last), y: yOf(s.values[last], max), value: s.values[last] },
      };
    }),
    // Faixa vertical por dia: passar o mouse em qualquer altura mostra todos os valores daquele dia
    hits: labels.map((label, i) => ({
      x: xOf(i),
      band: { x: xOf(i) - band / 2, width: band },
      tip: { heading: label, rows: series.map((s) => ({ name: s.name, value: String(s.values[i]), color: s.color })) } as Tip,
    })),
  };
}

function columnChart(labels: string[], values: number[], max: number, step: number, w: number) {
  const plotW = w - PAD.left - PAD.right;
  const band = plotW / labels.length;
  const width = Math.min(24, band * 0.6);
  const base = PAD.top + plotH;
  return {
    ticks: ticks(max, step),
    columns: values.map((v, i) => {
      const x = PAD.left + i * band + (band - width) / 2;
      const y = yOf(v, max);
      const r = Math.min(4, base - y);
      return {
        label: labels[i],
        value: v,
        x: x + width / 2,
        y,
        // Ponta de cima arredondada em 4px, base reta
        path: `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${base}Z`,
        hit: { x: PAD.left + i * band, width: band },
        tip: { heading: `Semana ${labels[i].slice(1)}`, rows: [{ name: 'entregues', value: String(v), color: SERIES[0] }] } as Tip,
        isLast: i === values.length - 1,
      };
    }),
  };
}

function ticks(max: number, step: number) {
  return Array.from({ length: max / step + 1 }, (_, i) => ({ value: i * step, y: yOf(i * step, max) }));
}

function pieChart(slices: { name: string; value: number }[]) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  let angle = -Math.PI / 2;
  const point = (a: number) => `${90 + 80 * Math.cos(a)},${90 + 80 * Math.sin(a)}`;
  return slices.map((s, i) => {
    const start = angle;
    angle += (s.value / total) * Math.PI * 2;
    const large = angle - start > Math.PI ? 1 : 0;
    return {
      ...s,
      color: SERIES[i],
      percent: Math.round((s.value / total) * 100),
      path: `M90,90L${point(start)}A80,80 0 ${large} 1 ${point(angle)}Z`,
      tip: { heading: s.name, rows: [{ name: 'atividades', value: `${s.value} (${Math.round((s.value / total) * 100)}%)`, color: SERIES[i] }] } as Tip,
    };
  });
}

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
    const host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const card = host.querySelector('.dashboard__charts .dash-card');
      if (!card) return;
      // Largura sem o padding do card
      const measure = () => {
        const style = getComputedStyle(card);
        const width = card.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        this.chartWidth.set(Math.max(240, Math.round(width)));
      };
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(card);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  // Dica única da página, posicionada junto ao ponteiro (ou ao elemento, quando vem do teclado)
  protected readonly tip = signal<{ x: number; y: number; flip: boolean; data: Tip } | null>(null);

  protected showTip(event: Event, data: Tip) {
    let x: number, y: number;
    if (event instanceof MouseEvent) {
      ({ clientX: x, clientY: y } = event);
    } else {
      const rect = (event.target as Element).getBoundingClientRect();
      x = rect.left + rect.width / 2;
      y = rect.top;
    }
    // Perto da borda direita, a dica abre para a esquerda
    this.tip.set({ x, y, flip: x > innerWidth - 220, data });
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
    columnChart(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'], [12, 15, 9, 18, 14, 20, 17, 22], 30, 10, this.chartWidth()),
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
