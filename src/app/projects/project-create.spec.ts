import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ProjectCreate } from './project-create';
import { ProjectStore } from './project-store';

describe('ProjectCreate', () => {
  it('creates a project from the last table row and feeds the carousel', async () => {
    await TestBed.configureTestingModule({ imports: [ProjectCreate], providers: [provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(ProjectCreate);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const store = TestBed.inject(ProjectStore);
    const before = store.carouselItems().length;

    const field = (name: string) => el.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!;
    field('name').value = 'Portal B2B';
    field('status').value = 'review';
    field('costInitial').value = '1500.5';
    field('sector').value = 'Financeiro';
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();

    const created = store.projects().at(-1)!;
    expect(created).toMatchObject({ name: 'Portal B2B', status: 'review', costInitial: 1500.5, sector: 'Financeiro' });
    expect(store.carouselItems()).toHaveLength(before + 1);
    expect(el.querySelectorAll('tbody tr')).toHaveLength(before + 1);
    expect(field('name').value).toBe(''); // linha de criação limpa para o próximo
  });
});
