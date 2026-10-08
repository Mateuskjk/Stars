import { burnDown, burnUp, health } from './project-metrics';
import { ProjectTask, businessIndex, seedTasks, sprintOf, sprintWindow } from './project-tasks';

const task = (over: Partial<ProjectTask>): ProjectTask => ({
  id: 1,
  projectId: 1,
  title: 'x',
  assignee: 'Ana Souza',
  points: 5,
  status: 'todo',
  sprint: 1,
  start: '',
  end: '',
  createdAt: '2026-01-05',
  doneAt: null,
  ...over,
});

describe('project metrics', () => {
  it('sprints have 7 business days and skip weekends', () => {
    const s1 = sprintWindow(1);
    expect(s1.days).toEqual(['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-12', '2026-01-13']);
    expect(sprintWindow(2).start).toBe('2026-01-14');
    expect(businessIndex('2026-01-10')).toBe(businessIndex('2026-01-09')); // sábado conta como sexta
    expect(sprintOf('2026-01-13')).toBe(1);
    expect(sprintOf('2026-01-14')).toBe(2);
  });

  it('burn-down: remaining points per day, ideal line and pace', () => {
    const s = sprintWindow(1);
    const tasks = [
      task({ id: 1, points: 5, doneAt: s.days[1], status: 'done' }),
      task({ id: 2, points: 5 }),
      task({ id: 3, points: 3, createdAt: s.days[2] }), // entrou no meio da sprint
    ];
    const bd = burnDown(tasks, s, s.days[3]); // hoje = 4º dia
    expect(bd.series[1].values).toEqual([10, 5, 8, 8, null, null, null]);
    expect(bd.series[0].values[0]).toBe(10);
    expect(bd.series[0].values[6]).toBe(0);
    expect(bd).toMatchObject({ committed: 10, added: 3, done: 5, left: 8, lived: 4, daysLeft: 3, pace: 1.3 });
    expect(bd.leftover).toBe(4); // 8 - 1.25*3 ≈ 4 pts devem sobrar
  });

  it('burn-up: velocity, forecast and health', () => {
    // 4 sprints de 10 pts entregues; escopo de 80 pts; hoje no 1º dia da sprint 5
    const tasks: ProjectTask[] = [];
    for (let n = 1; n <= 8; n++) {
      tasks.push(task({ id: n, sprint: n, points: 10, end: sprintWindow(n).end, ...(n <= 4 ? { status: 'done', doneAt: sprintWindow(n).days[5] } : {}) }));
    }
    const bu = burnUp(tasks, sprintWindow(5).start)!;
    expect(bu).toMatchObject({ total: 80, doneNow: 40, velocity: 10, plannedEnd: 8, forecast: 8, delay: 0 });
    expect(health(bu)).toBe('on-track');

    const undo = (id: number) => tasks.map((t) => (t.id === id ? { ...t, status: 'todo' as const, doneAt: null } : t));
    const slow = burnUp(undo(3), sprintWindow(5).start)!;
    expect(slow.velocity).toBe(6.7); // (10 + 0 + 10) / 3
    expect(slow.delay).toBeGreaterThan(0);
    expect(health(burnUp(undo(4), sprintWindow(5).start))).toBe('stalled'); // última sprint sem entrega
  });

  it('seed data is consistent', () => {
    for (const t of seedTasks('2026-10-08')) {
      if (t.doneAt) expect(t.doneAt >= t.createdAt && t.doneAt <= '2026-10-08').toBe(true);
      expect(t.createdAt <= '2026-10-08').toBe(true);
      expect(t.status === 'done').toBe(!!t.doneAt);
    }
  });
});
