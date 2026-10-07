import { Component, DestroyRef, afterNextRender, inject, signal } from '@angular/core';
import { Carousel } from '../carousel/carousel';
import { COMPANIES, ProjectStore } from '../projects/project-store';

@Component({
  imports: [Carousel],
  selector: 'app-home',
  templateUrl: './home.html',
  host: { class: 'home' },
})
export class Home {
  protected readonly weekDate = signal(formatWeekDate(new Date()));

  constructor() {
    // Confere a data a cada minuto, para virar o dia sem recarregar a página
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const id = setInterval(() => this.weekDate.set(formatWeekDate(new Date())), 60_000);
      destroyRef.onDestroy(() => clearInterval(id));
    });
  }

  protected readonly projects = inject(ProjectStore).carouselItems;

  protected readonly companies = COMPANIES;
}

// Ex.: "Quarta-feira, 7 de outubro"
function formatWeekDate(date: Date) {
  const text = date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return text.charAt(0).toUpperCase() + text.slice(1);
}
