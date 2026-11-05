import { dailySlot, updatedAt } from './daily-refresh';

describe('fotografia diária dos Dashboards (10h)', () => {
  it('antes das 10h ainda vale o dia anterior; a partir das 10h, o de hoje', () => {
    expect(dailySlot(new Date(2026, 10, 5, 9, 59))).toBe('2026-11-04');
    expect(dailySlot(new Date(2026, 10, 5, 10, 0))).toBe('2026-11-05');
    expect(dailySlot(new Date(2026, 10, 1, 8, 0))).toBe('2026-10-31'); // vira o mês
  });

  it('mostra quando foi atualizada', () => {
    const now = new Date(2026, 10, 5, 15, 0);
    expect(updatedAt(new Date(2026, 10, 5, 10, 2).toISOString(), now)).toBe('hoje às 10:02');
    expect(updatedAt(new Date(2026, 10, 4, 10, 0).toISOString(), now)).toBe('ontem às 10:00');
    expect(updatedAt(new Date(2026, 10, 2, 10, 0).toISOString(), now)).toBe('02/11 às 10:00');
  });
});
