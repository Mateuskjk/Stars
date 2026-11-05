import { TestBed } from '@angular/core/testing';
import { sprintWindow } from '../projects/project-tasks';
import { SprintStore, chosenSprints, sprintFilterField } from './sprint-store';

describe('SprintStore.nameOf', () => {
  it('usa o nome da sprint da Planning que cobre o período; sem nenhuma, mostra só as datas', () => {
    const store = TestBed.inject(SprintStore);
    const w = sprintWindow(40);
    // começa no meio do período do calendário (como a Sprint 31 de 04/11 contra o período 32)
    store.sprints.set([{ id: 1, name: 'Sprint 31', start: w.days[2], end: sprintWindow(41).days[1], goal: '', status: 'active' }]);
    expect(store.nameOf(40)).toBe('Sprint 31');
    expect(store.nameOf(39)).toMatch(/^\d\d\/\d\d – \d\d\/\d\d$/);
  });
});

describe('sprintFilterField', () => {
  it('sprints com o mesmo nome viram uma opção só, que vale para todas', () => {
    const sp = (id: number, name: string, start: string, status: 'active' | 'closed' = 'closed') => ({ id, name, start, end: start, goal: '', status });
    const field = sprintFilterField([sp(1, 'Sprint 30', '2026-10-21'), sp(2, 'Sprint 31', '2026-11-04', 'active'), sp(3, 'Sprint 31 ', '2026-11-03'), sp(4, 'SPRINT 06', '2026-07-01'), sp(5, 'sprint 06', '2026-07-01')]);
    expect(field.options.map((o) => o.label)).toEqual(['Sprint 31 (ativa)', 'Sprint 30', 'SPRINT 06']);
    expect(chosenSprints([{ key: 'sprint', value: field.options[0].value }])).toEqual(new Set([2, 3]));
  });
});
