import { Sprint } from '../planning/sprint-store';
import { SAMPLE_METRICS, average, change, formatValue, isGood, lastSprints, toCsv } from './report-data';

const sprint = (id: number, end: string, status: Sprint['status'] = 'closed'): Sprint => ({ id, name: `Sprint ${id}`, start: end, end, goal: '', status });

describe('report data', () => {
  const sprints = [sprint(11, '2026-10-04'), sprint(8, '2026-09-13', 'archived'), sprint(12, '2026-10-11', 'active'), sprint(10, '2026-09-27'), sprint(9, '2026-09-20'), sprint(7, '2026-09-06')];

  it('takes the last 4 finished sprints in order, ignoring the active one', () => {
    const report = lastSprints(sprints, SAMPLE_METRICS);
    expect(report.map((s) => s.id)).toEqual([8, 9, 10, 11]); // 7 não tem métricas; 12 está ativa
    expect(report[0].metrics.completion).toBe(78); // 31/40
  });

  it('compares with the right direction of "good"', () => {
    const report = lastSprints(sprints, SAMPLE_METRICS);
    expect(average(report, 'delivered')).toBe(36);
    expect(change(38, 40)).toBe(-5);
    expect(isGood('delivered', -2)).toBe(false);
    expect(isGood('cycleDays', -0.4)).toBe(true); // ciclo menor é melhor
    expect(isGood('blockers', 0)).toBeNull();
    expect(formatValue('cycleDays', 3.7)).toBe('3,7 dias');
  });

  it('exports the comparison as CSV for Excel', () => {
    const csv = toCsv(lastSprints(sprints, SAMPLE_METRICS)).split('\n');
    expect(csv[0]).toBe('"Métrica";"Sprint 8";"Sprint 9";"Sprint 10";"Sprint 11";"Média"');
    expect(csv[1]).toBe('"Pontos entregues (velocidade)";"31 pts";"35 pts";"40 pts";"38 pts";"36 pts"');
  });
});
