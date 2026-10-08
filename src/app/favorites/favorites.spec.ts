import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BacklogStore } from '../backlog/backlog-store';
import { Favorites } from './favorites';

describe('Favorites', () => {
  it('lists only favorite cards, links to the card and unfavorites in place', async () => {
    await TestBed.configureTestingModule({ imports: [Favorites], providers: [provideRouter([])] }).compileComponents();
    const store = TestBed.inject(BacklogStore);
    const fixture = TestBed.createComponent(Favorites);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const names = () => [...el.querySelectorAll('.backlog-card__name')].map((n) => n.textContent);

    const favorites = store.items().filter((item) => item.favorite);
    expect(names()).toEqual(favorites.map((item) => item.name));
    expect(el.querySelector('a.favorites__open')!.getAttribute('href')).toBe(`/workspace/backlog?cartao=${favorites[0].id}`);

    // Favoritar outro cartão no backlog faz ele aparecer aqui
    const other = store.items().find((item) => !item.favorite)!;
    store.patch(other.id, { favorite: true });
    fixture.detectChanges();
    expect(names()).toContain(other.name);

    // Tirar a estrela remove da lista
    el.querySelectorAll<HTMLElement>('.favorites__star').forEach((star) => star.click());
    fixture.detectChanges();
    expect(names()).toEqual([]);
    expect(el.querySelector('.favorites__empty')).not.toBeNull();
  });
});
