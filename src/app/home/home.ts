import { Component, inject } from '@angular/core';
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
  protected readonly projects = inject(ProjectStore).carouselItems;

  protected readonly companies = inject(CompanyStore).carouselItems;
}

// Ex.: "Quarta-feira, 7 de outubro"
export function formatWeekDate(date: Date, timeZone?: string) {
  const text = date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone });
  return text.charAt(0).toUpperCase() + text.slice(1);
}
