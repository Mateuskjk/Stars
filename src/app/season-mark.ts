import { Component, computed, input } from '@angular/core';
import { Season } from './season';

// Símbolo do tema: o lacinho nas campanhas de conscientização (Outubro Rosa, Novembro Azul) e o emoji nas demais datas.
// Fica ao lado da logo na barra do topo e na faixa do tema na Home.
@Component({
  selector: 'app-season-mark',
  host: { class: 'season-mark', '[attr.title]': 'season().label' },
  template: `
    @if (ribbon()) {
      <svg class="season-mark__ribbon" viewBox="0 0 24 32" role="img" [attr.aria-label]="'Laço do ' + season().label">
        <path
          d="M12 1.5c-3.6 0-6.3 2.7-6.3 6.3 0 2.7 1.5 5.3 3.5 8.1L2.6 27.6l4.3 2.4 5.1-9.1 5.1 9.1 4.3-2.4-6.6-11.7c2-2.8 3.5-5.4 3.5-8.1 0-3.6-2.7-6.3-6.3-6.3Zm0 4.4c1.3 0 2.1 1 2.1 2.3 0 1.4-.8 3-2.1 4.9-1.3-1.9-2.1-3.5-2.1-4.9 0-1.3.8-2.3 2.1-2.3Z"
        />
      </svg>
    } @else {
      <span class="season-mark__emoji" role="img" [attr.aria-label]="season().label">{{ season().emoji }}</span>
    }
  `,
})
export class SeasonMark {
  readonly season = input.required<Season>();
  protected readonly ribbon = computed(() => ['outubro-rosa', 'novembro-azul'].includes(this.season().id));
}
