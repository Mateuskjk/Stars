import { Sprint } from '../planning/sprint-store';

export interface SprintMetrics {
  planned: number; // pontos planejados
  delivered: number; // pontos entregues (velocidade)
  done: number; // atividades concluídas
  carryOver: number; // atividades levadas para a sprint seguinte
  cycleDays: number; // tempo médio de ciclo (dias, do início ao fim de uma atividade)
  blockers: number; // impedimentos registrados
}

// ponytail: métricas de exemplo por sprint (id → números); com backend, calcular a partir do histórico dos cartões
export const SAMPLE_METRICS: Record<number, SprintMetrics> = {
  8: { planned: 40, delivered: 31, done: 16, carryOver: 5, cycleDays: 4.6, blockers: 4 },
  9: { planned: 42, delivered: 35, done: 18, carryOver: 4, cycleDays: 4.1, blockers: 3 },
  10: { planned: 44, delivered: 40, done: 20, carryOver: 3, cycleDays: 3.7, blockers: 2 },
  11: { planned: 45, delivered: 38, done: 19, carryOver: 4, cycleDays: 3.9, blockers: 3 },
};

export type MetricKey = keyof SprintMetrics | 'completion';

// Linhas do comparativo. better = qual direção é boa (para colorir a variação com o sentido certo)
export const METRICS: { key: MetricKey; label: string; unit: string; better: 'up' | 'down'; decimals: number }[] = [
  { key: 'delivered', label: 'Pontos entregues (velocidade)', unit: ' pts', better: 'up', decimals: 0 },
  { key: 'planned', label: 'Pontos planejados', unit: ' pts', better: 'up', decimals: 0 },
  { key: 'completion', label: 'Taxa de conclusão', unit: '%', better: 'up', decimals: 0 },
  { key: 'done', label: 'Atividades concluídas', unit: '', better: 'up', decimals: 0 },
  { key: 'carryOver', label: 'Levadas para a próxima sprint', unit: '', better: 'down', decimals: 0 },
  { key: 'cycleDays', label: 'Tempo médio de ciclo', unit: ' dias', better: 'down', decimals: 1 },
  { key: 'blockers', label: 'Impedimentos', unit: '', better: 'down', decimals: 0 },
];

export interface ReportSprint extends Sprint {
  metrics: SprintMetrics & { completion: number };
}

// As últimas N sprints encerradas (fechadas ou arquivadas) que têm métricas, da mais antiga para a mais recente
export function lastSprints(sprints: Sprint[], metrics: Record<number, SprintMetrics>, count = 4): ReportSprint[] {
  return sprints
    .filter((sprint) => (sprint.status === 'closed' || sprint.status === 'archived') && metrics[sprint.id])
    .sort((a, b) => a.end.localeCompare(b.end))
    .slice(-count)
    .map((sprint) => {
      const m = metrics[sprint.id];
      return { ...sprint, metrics: { ...m, completion: Math.round((m.delivered / m.planned) * 100) } };
    });
}

export const valueOf = (sprint: ReportSprint, key: MetricKey) => sprint.metrics[key];

export function average(sprints: ReportSprint[], key: MetricKey) {
  return sprints.length ? sprints.reduce((sum, s) => sum + valueOf(s, key), 0) / sprints.length : 0;
}

// Variação em % (base 0 vira 0 para não dividir por zero)
export function change(current: number, previous: number) {
  return previous ? ((current - previous) / previous) * 100 : 0;
}

// A variação é boa? (subir é bom para velocidade; descer é bom para ciclo, impedimentos…)
export function isGood(key: MetricKey, delta: number) {
  const metric = METRICS.find((m) => m.key === key)!;
  return delta === 0 ? null : metric.better === 'up' ? delta > 0 : delta < 0;
}

export function formatValue(key: MetricKey, value: number) {
  const metric = METRICS.find((m) => m.key === key)!;
  return value.toLocaleString('pt-BR', { maximumFractionDigits: metric.decimals, minimumFractionDigits: metric.decimals }) + metric.unit;
}

// Comparativo em CSV (separador ";" para abrir direto no Excel em português)
export function toCsv(sprints: ReportSprint[]) {
  const cell = (text: string) => `"${text.replaceAll('"', '""')}"`;
  const header = ['Métrica', ...sprints.map((s) => s.name), 'Média'].map(cell).join(';');
  const rows = METRICS.map((metric) =>
    [
      metric.label,
      ...sprints.map((s) => formatValue(metric.key, valueOf(s, metric.key))),
      formatValue(metric.key, average(sprints, metric.key)),
    ]
      .map(cell)
      .join(';'),
  );
  return [header, ...rows].join('\n');
}
