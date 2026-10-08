import { DestroyRef, ElementRef, WritableSignal, afterNextRender, inject } from '@angular/core';

// Cores da paleta de gráficos (validada contra o fundo #faf9f6)
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];
export const MUTED = '#898781';

// Área de desenho dos gráficos de linha e coluna. A largura vem do card (em px reais),
// então o SVG não é esticado e o texto fica sempre do mesmo tamanho em qualquer tela.
export const H = 200;
export const PAD = { left: 28, right: 72, top: 12, bottom: 24 };
export const plotH = H - PAD.top - PAD.bottom;
export const yOf = (value: number, max: number) => PAD.top + plotH - (value / max) * plotH;

// Conteúdo da dica do hover: título (dia, semana, pessoa) e um valor por série
export interface Tip {
  heading: string;
  rows: { name: string; value: string; color: string }[];
}

export interface Series {
  name: string;
  color: string;
  values: number[];
}

export function lineChart(labels: string[], series: Series[], max: number, step: number, w: number) {
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

export function columnChart(
  labels: string[],
  values: number[],
  max: number,
  step: number,
  w: number,
  tipFor: (label: string, value: number) => Tip = (label, value) => ({ heading: label, rows: [{ name: 'valor', value: String(value), color: SERIES[0] }] }),
) {
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
        tip: tipFor(labels[i], v),
        isLast: i === values.length - 1,
      };
    }),
  };
}

export function ticks(max: number, step: number) {
  return Array.from({ length: max / step + 1 }, (_, i) => ({ value: i * step, y: yOf(i * step, max) }));
}

export function pieChart(slices: { name: string; value: number }[]) {
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

// Colunas agrupadas: várias séries lado a lado em cada categoria (ex.: planejado × entregue por sprint)
export function groupedColumns(labels: string[], series: Series[], max: number, step: number, w: number, unit = '') {
  const plotW = w - PAD.left - PAD.right;
  const band = plotW / labels.length;
  const gap = 2; // espaço de 2px entre colunas vizinhas
  const width = Math.min(24, (band * 0.7 - gap * (series.length - 1)) / series.length);
  const groupW = width * series.length + gap * (series.length - 1);
  const base = PAD.top + plotH;
  return {
    ticks: ticks(max, step),
    groups: labels.map((label, i) => {
      const left = PAD.left + i * band + (band - groupW) / 2;
      return {
        label,
        x: PAD.left + i * band + band / 2,
        hit: { x: PAD.left + i * band, width: band },
        tip: { heading: label, rows: series.map((s) => ({ name: s.name, value: s.values[i] + unit, color: s.color })) } as Tip,
        bars: series.map((s, j) => {
          const x = left + j * (width + gap);
          const y = yOf(s.values[i], max);
          const r = Math.min(4, base - y);
          return {
            color: s.color,
            path: `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${base}Z`,
          };
        }),
      };
    }),
  };
}

// Posição da dica do hover: junto ao ponteiro, ou ao elemento quando vem do teclado
export function tipAt(event: Event, data: Tip) {
  let x: number, y: number;
  if (event instanceof MouseEvent) {
    ({ clientX: x, clientY: y } = event);
  } else {
    const rect = (event.target as Element).getBoundingClientRect();
    x = rect.left + rect.width / 2;
    y = rect.top;
  }
  // Perto da borda direita, a dica abre para a esquerda
  return { x, y, flip: x > innerWidth - 220, data };
}

export type TipState = ReturnType<typeof tipAt>;

// Mede a largura útil (sem padding) do primeiro elemento que casa com o seletor e acompanha mudanças.
// Os gráficos são desenhados nessa largura real, então o texto não estica. Chamar no construtor.
export function watchChartWidth(selector: string, target: WritableSignal<number>) {
  const host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
  const destroyRef = inject(DestroyRef);
  afterNextRender(() => {
    const card = host.querySelector(selector);
    if (!card) return;
    const measure = () => {
      const style = getComputedStyle(card);
      const width = card.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      target.set(Math.max(240, Math.round(width)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    destroyRef.onDestroy(() => observer.disconnect());
  });
}
