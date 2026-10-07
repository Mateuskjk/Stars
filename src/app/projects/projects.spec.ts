import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Projects } from './projects';

describe('Projects kanban', () => {
  it('moves a card to another column through the "Mover para" select', async () => {
    await TestBed.configureTestingModule({ imports: [Projects], providers: [provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(Projects);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const counts = () => [...el.querySelectorAll('.kanban__count')].map((c) => Number(c.textContent));

    expect(counts()).toEqual([5, 3, 2, 2]);

    const select = el.querySelector<HTMLSelectElement>('.kanban__column .kanban__move')!;
    select.value = 'canceled';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(counts()).toEqual([4, 3, 2, 3]);
  });
});
