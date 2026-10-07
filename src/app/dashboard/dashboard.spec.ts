import { TestBed } from '@angular/core/testing';
import { Dashboard } from './dashboard';

describe('Dashboard', () => {
  it('renders every chart with its marks', async () => {
    await TestBed.configureTestingModule({ imports: [Dashboard] }).compileComponents();
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelectorAll('.stat')).toHaveLength(4);
    expect(el.querySelectorAll('.chart__column')).toHaveLength(8);
    expect(el.querySelectorAll('.chart__line')).toHaveLength(4); // burn-up + burn-down, 2 linhas cada
    expect(el.querySelectorAll('.pie__slice')).toHaveLength(5);

    // As fatias da pizza somam 100% (com arredondamento)
    const percents = [...el.querySelectorAll('.pie .legend__value')].map((v) => parseInt(v.textContent!.split('·')[1]));
    expect(Math.abs(percents.reduce((a, b) => a + b, 0) - 100)).toBeLessThanOrEqual(2);
  });
});
