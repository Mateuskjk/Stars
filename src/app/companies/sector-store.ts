import { Injectable, inject, signal } from '@angular/core';
import { AuditStore } from '../audit/audit-store';
import { MembersStore } from '../members/members-store';

// Setor de uma empresa (Marketing, Financeiro…). Os projetos apontam para o setor pelo nome.
export interface Sector {
  id: number;
  companyId: number;
  name: string;
  description: string;
  manager: string; // gestor do setor (membro ligado à empresa) ou ''
  color: string;
}

export type SectorData = Pick<Sector, 'name' | 'description' | 'manager'>;

// Cores dos setores (a cor sempre vem junto do nome, nunca sozinha)
const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#9b7be0', '#eda100', '#e87ba4', '#4a3aa7', '#008300'];

// ponytail: setores de exemplo, só em memória (como as empresas); trocar pela API quando o backend existir.
// Batem com o setor dos projetos de exemplo, para cada perfil de setor já mostrar seus projetos.
const SEED: Omit<Sector, 'id' | 'color'>[] = [
  { companyId: 1, name: 'Marketing', description: 'Marca, site e campanhas', manager: 'Ana Souza' },
  { companyId: 1, name: 'Comercial', description: 'Vendas e relacionamento com clientes', manager: 'Carlos Lima' },
  { companyId: 1, name: 'Financeiro', description: 'Contas, orçamento e faturamento', manager: 'Diego Rocha' },
  { companyId: 1, name: 'TI', description: 'Infraestrutura e sistemas internos', manager: 'Felipe Costa' },
  { companyId: 2, name: 'Atendimento', description: 'Suporte e sucesso do cliente', manager: 'Eva Martins' },
  { companyId: 2, name: 'Produto', description: 'Descoberta e evolução do produto', manager: 'Bruna Alves' },
  { companyId: 3, name: 'Atendimento', description: 'Central de relacionamento', manager: '' },
  { companyId: 4, name: 'Marketing', description: 'Campanhas sazonais e redes sociais', manager: '' },
  { companyId: 5, name: 'TI', description: 'Dados e sistemas das clínicas', manager: '' },
  { companyId: 6, name: 'Operações', description: 'Armazéns e transporte', manager: '' },
];

@Injectable({ providedIn: 'root' })
export class SectorStore {
  private readonly audit = inject(AuditStore);
  private readonly members = inject(MembersStore);
  readonly sectors = signal<Sector[]>(SEED.map((sector, i) => ({ ...sector, id: i + 1, color: COLORS[i % COLORS.length] })));

  byId(id: number) {
    return this.sectors().find((sector) => sector.id === id) ?? null;
  }

  ofCompany(companyId: number) {
    return this.sectors().filter((sector) => sector.companyId === companyId);
  }

  isNameTaken(companyId: number, name: string) {
    const target = name.trim().toLowerCase();
    return this.ofCompany(companyId).some((sector) => sector.name.toLowerCase() === target);
  }

  create(companyId: number, companyName: string, data: SectorData) {
    if (!this.members.isAdmin()) return null; // só admin cria setores
    const name = data.name.trim();
    if (!name || this.isNameTaken(companyId, name)) return null;
    const id = Math.max(0, ...this.sectors().map((s) => s.id)) + 1;
    const sector: Sector = { ...data, name, description: data.description.trim(), id, companyId, color: COLORS[(id - 1) % COLORS.length] };
    this.sectors.update((list) => [...list, sector]);
    this.audit.log({ action: 'create', entity: 'Setor', name, details: `Empresa: ${companyName}${data.manager ? ` · Gestor: ${data.manager}` : ''}` });
    return sector;
  }
}
