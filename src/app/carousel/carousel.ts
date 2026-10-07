import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';

export interface CarouselItem {
  name: string;
  cover: string; // ponytail: gradiente no lugar da imagem; trocar por url(...) quando houver imagens
  link: string;
}

@Component({
  imports: [RouterLink],
  selector: 'app-carousel',
  templateUrl: './carousel.html',
  host: {
    class: 'carousel',
    '(mouseenter)': 'paused.set(true)',
    '(mouseleave)': 'paused.set(false)',
    '(focusin)': 'paused.set(true)',
    '(focusout)': 'paused.set(false)',
  },
})
export class Carousel {
  readonly title = input.required<string>();
  readonly items = input.required<CarouselItem[]>();

  protected readonly paused = signal(false);
  private readonly track = viewChild.required<ElementRef<HTMLElement>>('track');

  constructor() {
    const destroyRef = inject(DestroyRef);
    // Só no navegador: no SSR não há rolagem nem timer
    afterNextRender(() => {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const id = setInterval(() => !this.paused() && this.move(1), 4000);
      destroyRef.onDestroy(() => clearInterval(id));
    });
  }

  protected move(direction: 1 | -1) {
    const track = this.track().nativeElement;
    const card = track.firstElementChild as HTMLElement | null;
    if (!card) return;

    const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
    const atStart = track.scrollLeft <= 0;

    // Nas pontas, volta para o outro lado em vez de parar
    if (direction === 1 && atEnd) {
      track.scrollTo({ left: 0, behavior: 'smooth' });
    } else if (direction === -1 && atStart) {
      track.scrollTo({ left: track.scrollWidth, behavior: 'smooth' });
    } else {
      const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      track.scrollBy({ left: direction * (card.offsetWidth + gap), behavior: 'smooth' });
    }
  }
}
