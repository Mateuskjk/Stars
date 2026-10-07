import { Component, DestroyRef, afterNextRender, inject, signal } from '@angular/core';
import { Carousel, CarouselItem } from '../carousel/carousel';

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

  // ponytail: listas fixas de exemplo; trocar por um service/API quando o backend existir
  protected readonly projects: CarouselItem[] = [
    { name: 'Redesign do site', cover: 'linear-gradient(135deg, #222b44, #5b6b9a)', link: '/projetos' },
    { name: 'App mobile', cover: 'linear-gradient(135deg, #3e4352, #92979d)', link: '/projetos' },
    { name: 'Portal do cliente', cover: 'linear-gradient(135deg, #2f5d62, #a7c4bc)', link: '/projetos' },
    { name: 'CRM interno', cover: 'linear-gradient(135deg, #5c3d6e, #c8a2c8)', link: '/projetos' },
    { name: 'Campanha Q4', cover: 'linear-gradient(135deg, #8a4b3c, #e0b39a)', link: '/projetos' },
    { name: 'Data Lake', cover: 'linear-gradient(135deg, #1f4e79, #8fb8de)', link: '/projetos' },
    { name: 'Onboarding', cover: 'linear-gradient(135deg, #4d5b2f, #c2cf9a)', link: '/projetos' },
  ];

  protected readonly companies: CarouselItem[] = [
    { name: 'Acme Ltda', cover: 'linear-gradient(135deg, #222b44, #8a93b8)', link: '/perfis' },
    { name: 'Nova Tech', cover: 'linear-gradient(135deg, #1f4e79, #a7c4e0)', link: '/perfis' },
    { name: 'Grupo Horizonte', cover: 'linear-gradient(135deg, #8a4b3c, #f0c9a8)', link: '/perfis' },
    { name: 'Verde Alimentos', cover: 'linear-gradient(135deg, #2f5d3a, #b5d6a7)', link: '/perfis' },
    { name: 'Lumen Saúde', cover: 'linear-gradient(135deg, #2f5d62, #bfe0dc)', link: '/perfis' },
    { name: 'Órbita Logística', cover: 'linear-gradient(135deg, #5c3d6e, #d9c2e6)', link: '/perfis' },
  ];
}

// Ex.: "Quarta-feira, 7 de outubro"
function formatWeekDate(date: Date) {
  const text = date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return text.charAt(0).toUpperCase() + text.slice(1);
}
