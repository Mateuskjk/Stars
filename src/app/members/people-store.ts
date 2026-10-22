import { Injectable, computed, inject } from '@angular/core';
import { CompanyStore } from '../companies/company-store';
import { MembersStore, ROLES } from './members-store';

export interface Person {
  id: number;
  name: string;
  role: string; // cargo para exibir (Admin, Supervisor, Membro)
}

// Pessoas do sistema para Daily e os seletores de responsável: os membros reais (do banco),
// ativos, da empresa escolhida. Sem login (exemplos e testes), todos os membros de exemplo.
@Injectable({ providedIn: 'root' })
export class PeopleStore {
  private readonly members = inject(MembersStore);
  private readonly companies = inject(CompanyStore);

  readonly team = computed<Person[]>(() => {
    const company = this.companies.current()?.name;
    return this.members
      .members()
      .filter((m) => m.status === 'active' && (!company || (m.companies ?? [m.company]).includes(company)))
      .map((m) => ({ id: m.id, name: m.name, role: ROLES.find((r) => r.id === m.role)?.label ?? '' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  });

  readonly names = computed(() => this.team().map((p) => p.name));
}
