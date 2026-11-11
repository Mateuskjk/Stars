import { TestBed } from '@angular/core/testing';
import { AccountStore } from '../account/account-store';
import { NewsBanner } from './news-banner';
import NOVIDADES from './novidades.json';

describe('NewsBanner (carrossel de novidades da Home)', () => {
  it('fica sempre na tela, começa na mais nova e as setas/bolinhas trocam a novidade', () => {
    TestBed.inject(AccountStore).account.update((a) => ({ ...a, seasonalThemes: false, reduceMotion: true }));
    const fixture = TestBed.createComponent(NewsBanner);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const title = () => el.querySelector('.news-banner__title')!.textContent;
    expect(title()).toBe(NOVIDADES[0].title);
    expect(el.querySelector('.news-banner__ok')).toBeNull(); // não tem como dispensar

    el.querySelector<HTMLButtonElement>('[aria-label="Próxima novidade"]')!.click();
    fixture.detectChanges();
    expect(title()).toBe(NOVIDADES[1].title);

    el.querySelector<HTMLButtonElement>('[aria-label="Novidade anterior"]')!.click();
    el.querySelector<HTMLButtonElement>('[aria-label="Novidade anterior"]')!.click();
    fixture.detectChanges();
    expect(title()).toBe(NOVIDADES[Math.min(NOVIDADES.length, 6) - 1].title); // dá a volta

    el.querySelectorAll<HTMLButtonElement>('.news-banner__dot')[2].click();
    fixture.detectChanges();
    expect(title()).toBe(NOVIDADES[2].title);
  });
});
