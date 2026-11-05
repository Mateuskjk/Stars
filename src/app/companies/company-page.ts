import { Component, computed, inject, input, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MembersStore } from '../members/members-store';
import { initials } from '../projects/projects';
import { CompanyStore } from './company-store';
import { SectorEditor } from './sector-editor';
import { SectorStore } from './sector-store';

// /empresas/:id — os perfis dos setores da empresa (o nome dela fica na barra do topo)
@Component({
  imports: [RouterLink, SectorEditor],
  selector: 'app-company-page',
  templateUrl: './company-page.html',
  host: { class: 'company-page' },
})
export class CompanyPage {
  readonly id = input.required<string>(); // vem da rota

  private readonly companyStore = inject(CompanyStore);
  private readonly membersStore = inject(MembersStore);
  private readonly sectorStore = inject(SectorStore);

  protected readonly initials = initials;
  protected readonly isAdmin = this.membersStore.isAdmin; // só admin cria setores

  protected readonly company = computed(() => this.companyStore.companies().find((c) => c.id === Number(this.id())) ?? null);
  // Os setores da empresa (o cartão mostra só o setor; os projetos e números ficam na página dele)
  protected readonly sectors = computed(() => {
    const company = this.company();
    return company ? this.sectorStore.ofCompany(company.id) : [];
  });

  protected readonly editor = viewChild(SectorEditor); // só existe para admin
}
