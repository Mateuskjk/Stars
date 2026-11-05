import { Component, inject } from '@angular/core';
import { CompanyPage } from './company-page';
import { CompanyStore } from './company-store';

// /setores — os setores da empresa escolhida no topo da sidebar (troca junto com ela).
// É a mesma tela de /empresas/:id, só que sempre na empresa atual.
@Component({
  imports: [CompanyPage],
  selector: 'app-sectors',
  template: `
    @if (companyStore.current(); as c) {
      <app-company-page [id]="'' + c.id" />
    } @else {
      <p class="planning__empty">Escolha uma empresa no topo do menu para ver os setores dela.</p>
    }
  `,
})
export class Sectors {
  protected readonly companyStore = inject(CompanyStore);
}
