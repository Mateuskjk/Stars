import { Component, DestroyRef, afterNextRender, computed, inject, signal } from '@angular/core';
import { AccountStore } from '../account/account-store';
import { Carousel } from '../carousel/carousel';
import { CompanyStore } from '../companies/company-store';
import { ProjectStore } from '../projects/project-store';

@Component({
  imports: [Carousel],
  selector: 'app-home',
  templateUrl: './home.html',
  host: { class: 'home' },
})
export class Home {
  private readonly account = inject(AccountStore);
  private readonly now = signal(new Date());
  protected readonly weekDate = computed(() => formatWeekDate(this.now(), this.account.timeZone()));

  constructor() {
    // Confere a data a cada minuto, para virar o dia sem recarregar a página
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const id = setInterval(() => this.now.set(new Date()), 60_000);
      destroyRef.onDestroy(() => clearInterval(id));
    });
  }

  protected readonly projects = inject(ProjectStore).carouselItems;

  protected readonly companies = inject(CompanyStore).carouselItems;
}

// Ex.: "Quarta-feira, 7 de outubro"
export function formatWeekDate(date: Date, timeZone?: string) {
  const text = date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone });
  return text.charAt(0).toUpperCase() + text.slice(1);
}
