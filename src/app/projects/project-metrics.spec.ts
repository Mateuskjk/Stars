import { burnDown, burnUp, cascade, health } from './project-metrics';
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

  it('Gantt em cascata: a atrasada vai até hoje e empurra as seguintes; a finalizada fica onde terminou', () => {
    const d = sprintWindow(1).days; // seg 05/01 … ter 13/01
    const rows = cascade(
      [
        { id: 3, start: d[4], end: d[5], doneAt: null }, // depois da atrasada: anda o atraso dela
        { id: 1, start: d[0], end: d[1], doneAt: null }, // atrasada (hoje = d[3]): vai até hoje, +2
        { id: 2, start: d[2], end: d[3], doneAt: d[3] }, // finalizada: fica onde aconteceu e não segura o atraso
        { id: 4, start: d[6], end: d[6], doneAt: null },
      ],
      d[3],
    );
    expect(rows.map((r) => [r.item.id, r.start, r.end, r.delay])).toEqual([
      [1, d[0], d[3], 2],
      [2, d[2], d[3], 0],
      [3, d[6], '2026-01-14', 2], // empurrada 2 dias úteis
      [4, '2026-01-15', '2026-01-15', 2],
    ]);
    // a finalizada atrasou 1 dia: a próxima anda 1
    const late = cascade(
      [
        { id: 1, start: d[0], end: d[1], doneAt: d[2] },
        { id: 2, start: d[3], end: d[4], doneAt: null },
      ],
      d[0],
    );
    expect(late.map((r) => [r.start, r.end, r.pushed])).toEqual([
      [d[0], d[2], 0],
      [d[4], d[5], 1],
    ]);
  });
});
