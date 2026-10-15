import { Component } from '@angular/core';

// Animação de carregamento: um traço corre no ∞, o ∞ se recolhe e vira a estrela de 4 pontas do logo.
// Só SVG + CSS (_loader.scss): pega a cor do tema (--color-accent) e roda antes do JavaScript carregar (SSR).
const INFINITY = 'M60 60C72 42 100 42 100 60S72 78 60 60 20 42 20 60s28 18 40 0Z';

@Component({
  selector: 'app-loader',
  host: { class: 'loader', role: 'status', 'aria-label': 'Carregando' },
  template: `
    <svg class="loader__svg" viewBox="0 0 120 120" aria-hidden="true">
      <g class="loader__infinity" fill="none" stroke-width="7" stroke-linecap="round">
        <path class="loader__track" [attr.d]="infinity" />
        <path class="loader__trail" pathLength="100" [attr.d]="infinity" />
      </g>
      <g transform="translate(20.4 22.8) scale(2.4)">
        <path class="loader__star" d="M13 1Q13 12 24 12Q13 12 13 23Q13 12 2 12Q13 12 13 1Z" />
        <path class="loader__small" d="M25 18Q25 24 31 24Q25 24 25 30Q25 24 19 24Q25 24 25 18Z" />
      </g>
    </svg>
  `,
})
export class Loader {
  protected readonly infinity = INFINITY;
}
