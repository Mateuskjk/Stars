import { Injectable, computed, inject, signal } from '@angular/core';
import { MembersStore } from '../members/members-store';
import { CustomColumnId, KanbanColumn, customColumn } from '../kanban/add-column';

export type ProjectStatus =
  | 'idea'
  | 'not-started'
  | 'started'
  | 'in-progress'
  | 'review'
  | 'done'
  | 'paused'
  | 'archived'
  | 'canceled'
  | CustomColumnId; // colunas criadas no kanban da Visão Geral

// Situações fixas, cada uma com sua cor (a cor sempre vem junto do nome, nunca sozinha)
export const PROJECT_STATUSES: KanbanColumn<ProjectStatus>[] = [
  { id: 'idea', label: 'Ideia', color: '#9b7be0' },
  { id: 'not-started', label: 'Não iniciado', color: '#898781' },
  { id: 'started', label: 'Iniciado', color: '#5598e7' },
  { id: 'in-progress', label: 'Em andamento', color: '#2a78d6' },
  { id: 'review', label: 'Revisão', color: '#eda100' },
  { id: 'done', label: 'Finalizado', color: '#0ca30c' },
  { id: 'paused', label: 'Pausado', color: '#eb6834' },
  { id: 'archived', label: 'Arquivado', color: '#52514e' },
  { id: 'canceled', label: 'Cancelado', color: '#d03b3b' },
];

export const TEAMS = ['Produto', 'Engenharia', 'Design', 'Dados', 'Marketing', 'QA'];

// Sugestões de setor (área onde o projeto vai ser aplicado); dá para digitar outro
export const SECTORS = ['Comercial', 'Financeiro', 'Marketing', 'Operações', 'RH', 'Jurídico', 'TI', 'Atendimento', 'Logística', 'Diretoria'];

export interface Project {
  id: number;
  name: string;
  description: string;
  owner: string;
  status: ProjectStatus;
  requester: string;
  costInitial: number;
  costDev: number;
  costFinal: number;
  docs: string[];
  company: string;
  sector: string; // setor onde o projeto vai ser aplicado
  team: string;
  cover: string;
  image?: string | null; // foto do projeto (data URL comprimida); vira a capa no lugar do gradiente
  parentId?: number | null; // projeto agregado: aparece dentro do projeto principal
}

export type NewProject = Omit<Project, 'id' | 'cover'>;

// Gradientes para a "imagem" do card: cada projeto novo pega o próximo da lista
const COVERS = [
  'linear-gradient(135deg, #222b44, #5b6b9a)',
  'linear-gradient(135deg, #3e4352, #92979d)',
  'linear-gradient(135deg, #2f5d62, #a7c4bc)',
  'linear-gradient(135deg, #5c3d6e, #c8a2c8)',
  'linear-gradient(135deg, #8a4b3c, #e0b39a)',
  'linear-gradient(135deg, #1f4e79, #8fb8de)',
  'linear-gradient(135deg, #4d5b2f, #c2cf9a)',
];

// Capa do projeto (cards, carrosséis, cabeçalho): a foto, se houver; senão o gradiente do projeto
// Imagem de fundo: o endereço vai entre aspas e escapado (JSON.stringify), nunca cru dentro de url(...)
export const cssImage = (src: string) => `center / cover no-repeat url(${JSON.stringify(src)})`;
const coverFor = (id: number, image?: string | null) => (image ? cssImage(image) : COVERS[(id - 1) % COVERS.length]);

// ponytail: projetos de exemplo, só em memória (somem ao recarregar); trocar por API quando o backend existir
const SEED: NewProject[] = [
  { name: 'Redesign do site', description: 'Nova identidade visual e home', owner: 'Bruna Alves', status: 'in-progress', requester: 'Diretoria de Marketing', costInitial: 40000, costDev: 28000, costFinal: 0, docs: ['briefing.pdf'], company: 'Acme Ltda', sector: 'Marketing', team: 'Design' },
  { name: 'App mobile', description: 'App iOS e Android para clientes', owner: 'Carlos Lima', status: 'in-progress', requester: 'Produto', costInitial: 120000, costDev: 85000, costFinal: 0, docs: ['escopo.pdf', 'wireframes.fig'], company: 'Nova Tech', sector: 'Atendimento', team: 'Engenharia' },
  { name: 'Portal do cliente', description: 'Área logada com faturas e suporte', owner: 'Diego Rocha', status: 'review', requester: 'Atendimento', costInitial: 65000, costDev: 61000, costFinal: 0, docs: [], company: 'Grupo Horizonte', sector: 'Atendimento', team: 'Engenharia' },
  { name: 'CRM interno', description: 'Funil de vendas e relatórios', owner: 'Gabriela Nunes', status: 'done', requester: 'Comercial', costInitial: 50000, costDev: 47000, costFinal: 52000, docs: ['manual.pdf'], company: 'Acme Ltda', sector: 'Comercial', team: 'Dados' },
  { name: 'Campanha Q4', description: 'Campanha de fim de ano', owner: 'Bruna Alves', status: 'paused', requester: 'Marketing', costInitial: 30000, costDev: 9000, costFinal: 0, docs: [], company: 'Verde Alimentos', sector: 'Marketing', team: 'Marketing' },
  { name: 'Data Lake', description: 'Centralizar dados das áreas', owner: 'Felipe Costa', status: 'started', requester: 'Diretoria de TI', costInitial: 200000, costDev: 35000, costFinal: 0, docs: ['arquitetura.pdf'], company: 'Lumen Saúde', sector: 'TI', team: 'Dados' },
  { name: 'Onboarding', description: 'Trilha de boas-vindas para novos clientes', owner: 'Ana Souza', status: 'archived', requester: 'Sucesso do cliente', costInitial: 15000, costDev: 14000, costFinal: 14500, docs: [], company: 'Órbita Logística', sector: 'Operações', team: 'Produto' },
];

// Lista única de projetos: a tabela de criação e os carrosséis (Home e Projetos) leem daqui
@Injectable({ providedIn: 'root' })
export class ProjectStore {
  private nextId = 1;
  readonly projects = signal<Project[]>(SEED.map((project) => this.build(project)));

  // Empresas ativas (o CompanyStore mantém atualizado); null = sem filtro (exemplos e testes)
  readonly activeCompanies = signal<Set<string> | null>(null);
  // Só aparecem projetos de empresas ativas (projeto sem empresa sempre aparece)
  readonly visible = computed(() => {
    const active = this.activeCompanies();
    return this.projects().filter((p) => !active || !p.company || active.has(p.company));
  });
  // Projetos principais: os agregados só aparecem dentro do principal
  readonly topLevel = computed(() => {
    const ids = new Set(this.visible().map((p) => p.id));
    return this.visible().filter((p) => !p.parentId || !ids.has(p.parentId));
  });

  childrenOf(id: number) {
    return this.visible().filter((p) => p.parentId === id);
  }

  // Situações fixas + colunas criadas no kanban (ponytail: só em memória, como os projetos)
  readonly statuses = signal(PROJECT_STATUSES);

  private readonly members = inject(MembersStore);

  // Troca os exemplos pelos projetos do banco (ids 1, 2, 3… na ordem recebida)
  load(projects: NewProject[]) {
    this.nextId = 1;
    this.projects.set(projects.map((project) => this.build(project)));
  }

  label(status: ProjectStatus) {
    return this.statuses().find((s) => s.id === status)?.label ?? status;
  }

  addStatus(label: string) {
    if (!this.members.isAdmin()) return; // só admin mexe nas colunas
    this.statuses.update((list) => [...list, customColumn(label, list.length)]);
  }

  renameStatus(id: ProjectStatus, label: string) {
    if (!this.members.isAdmin()) return; // só admin mexe nas colunas
    this.statuses.update((list) => list.map((s) => (s.id === id ? { ...s, label } : s)));
  }

  // Os projetos da coluna excluída vão para a primeira coluna
  removeStatus(id: ProjectStatus) {
    if (!this.members.isAdmin()) return; // só admin mexe nas colunas
    const fallback = this.statuses()[0];
    this.projects.update((list) => list.map((project) => (project.status === id ? { ...project, status: fallback.id } : project)));
    this.statuses.update((list) => list.filter((s) => s.id !== id));
  }

  setStatus(id: number, status: ProjectStatus) {
    const before = this.projects().find((project) => project.id === id);
    if (!before || before.status === status) return;
    this.projects.update((list) => list.map((project) => (project.id === id ? { ...project, status } : project)));
  }

  private change(id: number, changes: Partial<Project>) {
    this.projects.update((list) => list.map((p) => (p.id === id ? { ...p, ...changes } : p)));
  }

  setImage(id: number, image: string | null) {
    const project = this.projects().find((p) => p.id === id);
    if (!project) return;
    this.change(id, { image, cover: coverFor(id, image) });
  }

  // Agregar: o projeto vira secundário de outro (só um nível: um principal não vira secundário)
  setParent(id: number, parentId: number | null) {
    const project = this.projects().find((p) => p.id === id);
    const parent = parentId ? this.projects().find((p) => p.id === parentId) : null;
    if (!project || id === parentId || (parentId && (!parent || parent.parentId || this.childrenOf(id).length))) return;
    this.change(id, { parentId });
  }

  // Excluir: some das telas (no banco fica arquivado e marcado como excluído); os agregados viram independentes
  remove(id: number) {
    const project = this.projects().find((p) => p.id === id);
    if (!project) return;
    this.projects.update((list) => list.filter((p) => p.id !== id).map((p) => (p.parentId === id ? { ...p, parentId: null } : p)));
  }

  add(project: NewProject) {
    this.projects.update((list) => [...list, this.build(project)]);
  }

  private build(project: NewProject): Project {
    const id = this.nextId++;
    return { ...project, id, cover: coverFor(id, project.image) };
  }
}
