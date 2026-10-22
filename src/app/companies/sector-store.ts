import { Injectable, inject, signal } from '@angular/core';
import { BacklogStore } from '../backlog/backlog-store';
import { CustomColumnId, KanbanColumn, customColumn } from '../kanban/add-column';
import { MembersStore } from '../members/members-store';

// Setor de uma empresa (Marketing, Financeiro…). Os projetos apontam para o setor pelo nome.
export interface Sector {
  id: number;
  companyId: number;
  name: string;
  description: string;
  manager: string; // gestor do setor (membro ligado à empresa) ou ''
  memberIds: number[]; // membros do setor (MembersStore)
  color: string;
  columns: KanbanColumn<SprintColumnId>[]; // kanban da sprint do setor
}

export type SprintColumnId = 'todo' | 'doing' | 'review' | 'blocked' | 'done' | CustomColumnId;

// Status da atividade depois que ela entra na sprint (kanban de atividades gerais); o admin pode criar outras colunas.
// "Bloqueado" é o cadeado do cartão: bloquear leva para essa coluna e desbloquear devolve para onde estava.
export const SPRINT_COLUMNS: KanbanColumn<SprintColumnId>[] = [
  { id: 'todo', label: 'Não iniciado', color: '#898781' },
  { id: 'doing', label: 'Andamento', color: '#2a78d6' },
  { id: 'review', label: 'Revisão', color: '#eda100' },
  { id: 'blocked', label: 'Bloqueado', color: '#d03b3b' },
  { id: 'done', label: 'Finalizado', color: '#0ca30c' },
];

// Coluna em que a atividade aparece no kanban da sprint
export function sprintColumnOf(columns: KanbanColumn<SprintColumnId>[], item: { locked: boolean; sprintStatus?: string }) {
  if (item.locked) return columns.find((c) => c.id === 'blocked') ?? columns[0];
  return columns.find((c) => c.id === item.sprintStatus && c.id !== 'blocked') ?? columns[0];
}

export type SectorData = Pick<Sector, 'name' | 'description' | 'manager' | 'memberIds'>;

// Cores dos setores (a cor sempre vem junto do nome, nunca sozinha)
const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#9b7be0', '#eda100', '#e87ba4', '#4a3aa7', '#008300'];

// ponytail: setores de exemplo, só em memória (como as empresas); trocar pela API quando o backend existir.
// Batem com o setor dos projetos de exemplo, para cada perfil de setor já mostrar seus projetos.
const SEED: Omit<Sector, 'id' | 'color' | 'columns'>[] = [
  { companyId: 1, name: 'Marketing', description: 'Marca, site e campanhas', manager: 'Ana Souza', memberIds: [1] },
  { companyId: 1, name: 'Comercial', description: 'Vendas e relacionamento com clientes', manager: 'Carlos Lima', memberIds: [2] },
  { companyId: 1, name: 'Financeiro', description: 'Contas, orçamento e faturamento', manager: 'Diego Rocha', memberIds: [4] },
  { companyId: 1, name: 'TI', description: 'Infraestrutura e sistemas internos', manager: 'Felipe Costa', memberIds: [2, 4, 6] },
  { companyId: 2, name: 'Atendimento', description: 'Suporte e sucesso do cliente', manager: 'Eva Martins', memberIds: [5] },
  { companyId: 2, name: 'Produto', description: 'Descoberta e evolução do produto', manager: 'Bruna Alves', memberIds: [3] },
  { companyId: 3, name: 'Atendimento', description: 'Central de relacionamento', manager: '', memberIds: [] },
  { companyId: 4, name: 'Marketing', description: 'Campanhas sazonais e redes sociais', manager: '', memberIds: [] },
  { companyId: 5, name: 'TI', description: 'Dados e sistemas das clínicas', manager: '', memberIds: [] },
  { companyId: 6, name: 'Operações', description: 'Armazéns e transporte', manager: '', memberIds: [] },
];

@Injectable({ providedIn: 'root' })
export class SectorStore {
  private readonly members = inject(MembersStore);
  private readonly backlog = inject(BacklogStore);
  readonly sectors = signal<Sector[]>(SEED.map((sector, i) => ({ ...sector, id: i + 1, color: COLORS[i % COLORS.length], columns: SPRINT_COLUMNS })));

  byId(id: number) {
    return this.sectors().find((sector) => sector.id === id) ?? null;
  }

  // Atividades do Backlog ligadas ao setor
  sectorItems(id: number) {
    return this.backlog.items().filter((item) => item.sectorId === id).length;
  }

  ofCompany(companyId: number) {
    return this.sectors().filter((sector) => sector.companyId === companyId);
  }

  isNameTaken(companyId: number, name: string, exceptId: number | null = null) {
    const target = name.trim().toLowerCase();
    return this.ofCompany(companyId).some((sector) => sector.id !== exceptId && sector.name.toLowerCase() === target);
  }

  create(companyId: number, data: SectorData) {
    if (!this.members.isAdmin()) return null; // só admin cria setores
    const name = data.name.trim();
    if (!name || this.isNameTaken(companyId, name)) return null;
    const id = Math.max(0, ...this.sectors().map((s) => s.id)) + 1;
    const sector: Sector = { ...data, name, description: data.description.trim(), id, companyId, color: COLORS[(id - 1) % COLORS.length], columns: SPRINT_COLUMNS };
    this.sectors.update((list) => [...list, sector]);
    return sector;
  }

  update(id: number, data: SectorData) {
    const before = this.byId(id);
    if (!this.members.isAdmin() || !before) return false;
    const name = data.name.trim();
    if (!name || this.isNameTaken(before.companyId, name, id)) return false;
    this.sectors.update((list) => list.map((s) => (s.id === id ? { ...s, ...data, name, description: data.description.trim() } : s)));
    return true;
  }

  // Excluir: as atividades do setor continuam no Backlog, só perdem o vínculo
  remove(id: number) {
    const sector = this.byId(id);
    if (!this.members.isAdmin() || !sector) return;
    this.backlog.items.update((list) => list.map((item) => (item.sectorId === id ? { ...item, sectorId: undefined } : item)));
    this.sectors.update((list) => list.filter((s) => s.id !== id));
  }

  // ---------- Colunas do kanban da sprint (só admin) ----------
  addColumn(id: number, label: string) {
    this.editColumns(id, (columns) => [...columns, customColumn(label, columns.length)]);
  }

  renameColumn(id: number, columnId: SprintColumnId, label: string) {
    this.editColumns(id, (columns) => columns.map((c) => (c.id === columnId ? { ...c, label } : c)));
  }

  // As atividades da coluna excluída voltam para a primeira coluna
  removeColumn(id: number, columnId: SprintColumnId) {
    this.editColumns(id, (columns) => columns.filter((c) => c.id !== columnId));
    this.backlog.items.update((list) => list.map((item) => (item.sectorId === id && item.sprintStatus === columnId ? { ...item, sprintStatus: undefined } : item)));
  }

  private editColumns(id: number, change: (columns: Sector['columns']) => Sector['columns']) {
    if (!this.members.isAdmin()) return; // só admin mexe nas colunas
    this.sectors.update((list) => list.map((s) => (s.id === id ? { ...s, columns: change(s.columns) } : s)));
  }
}
