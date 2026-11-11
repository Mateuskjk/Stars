import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { AccountStore } from '../account/account-store';
import { seasonOf } from '../season';
import { SeasonMark } from '../season-mark';
import NOVIDADES from './novidades.json';

export interface News {
  id: string;
  date: string; // AAAA-MM-DD
  title: string;
  items: string[];
}

const ALL = (NOVIDADES as News[]).slice(0, 6); // as últimas novidades (geradas a cada deploy: scripts/novidades.mjs)
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const shortDate = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const INTERVAL_MS = 2 * 60 * 1000; // troca a novidade a cada 2 minutos

// Banner fixo da Home: carrossel com as últimas novidades do sistema e, nas datas comemorativas, a faixa do tema.
// Passa sozinho a cada 2 minutos (para no hover/foco e com "Reduzir animações" ligado).
@Component({
  imports: [SeasonMark],
  selector: 'app-news-banner',
  host: { class: 'news-banner' },
  template: `
    @if (season(); as s) {
      <p class="news-banner__season">
        <app-season-mark [season]="s" />
        <span><strong>{{ s.label }}</strong> {{ s.message }}</span>
      </p>
    }
    @if (slides.length) {
      @let n = slides[index()];
      <section
        class="news-banner__card"
        aria-roledescription="carrossel"
        aria-label="Novidades do LexÁgile"
        (mouseenter)="paused.set(true)"
        (mouseleave)="paused.set(false)"
        (focusin)="paused.set(true)"
        (focusout)="paused.set(false)"
      >
        <div class="news-banner__head">
          <span class="news-banner__badge">✦ Novidades</span>
          <span class="news-banner__date">{{ shortDate(n.date) }}</span>
          <span class="news-banner__count">{{ index() + 1 }} de {{ slides.length }}</span>
        </div>
        <div class="news-banner__slide" aria-live="polite">
          @for (s of [n]; track s.id) {
            <div class="news-banner__content">
              <h2 class="news-banner__title">{{ s.title }}</h2>
              @if (s.items.length) {
                <ul class="news-banner__items">
                  @for (item of s.items.slice(0, 4); track $index) {
                    <li>{{ item }}</li>
                  }
                </ul>
              }
            </div>
          }
        </div>
        <div class="news-banner__nav">
          <button class="news-banner__arrow" type="button" aria-label="Novidade anterior" (click)="go(-1)">‹</button>
          <div class="news-banner__dots" role="tablist" aria-label="Escolher novidade">
            @for (s of slides; track s.id; let i = $index) {
              <button
                type="button"
                role="tab"
                class="news-banner__dot"
                [class.is-active]="i === index()"
                [attr.aria-selected]="i === index()"
                [attr.aria-label]="'Novidade ' + (i + 1) + ': ' + s.title"
                (click)="index.set(i)"
              ></button>
            }
          </div>
          <button class="news-banner__arrow" type="button" aria-label="Próxima novidade" (click)="go(1)">›</button>
        </div>
        @if (!paused() && !reduceMotion()) {
          @for (k of [index()]; track k) {
            <span class="news-banner__progress" [style.animation-duration.ms]="interval" aria-hidden="true"></span>
          }
        }
      </section>
    }
  `,
})
export class NewsBanner {
  private readonly account = inject(AccountStore);
  protected readonly slides = ALL;
  protected readonly shortDate = shortDate;
  protected readonly interval = INTERVAL_MS;
  protected readonly index = signal(0);
  protected readonly paused = signal(false);
  protected readonly reduceMotion = computed(() => this.account.account().reduceMotion);
  protected readonly season = computed(() => (this.account.account().seasonalThemes ? seasonOf(new Date()) : null));

  constructor() {
    const timer = setInterval(() => {
      if (!this.paused() && !this.reduceMotion()) this.go(1);
    }, INTERVAL_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected go(step: number) {
    this.index.update((i) => (i + step + this.slides.length) % this.slides.length);
  }
}
