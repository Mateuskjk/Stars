import { Injectable, computed, signal } from '@angular/core';
import { CarouselItem } from '../carousel/carousel';

export type ProjectStatus =
  | 'idea'
  | 'not-started'
  | 'started'
  | 'in-progress'
  | 'review'
  | 'done'
  | 'paused'
  | 'archived'
  | 'canceled';

// Situações fixas, cada uma com sua cor (a cor sempre vem junto do nome, nunca sozinha)
export const PROJECT_STATUSES: { id: ProjectStatus; label: string; color: string }[] = [
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
  team: string;
  cover: string;
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

// ponytail: projetos de exemplo, só em memória (somem ao recarregar); trocar por API quando o backend existir
const SEED: NewProject[] = [
  { name: 'Redesign do site', description: 'Nova identidade visual e home', owner: 'Bruna Alves', status: 'in-progress', requester: 'Diretoria de Marketing', costInitial: 40000, costDev: 28000, costFinal: 0, docs: ['briefing.pdf'], company: 'Acme Ltda', team: 'Design' },
  { name: 'App mobile', description: 'App iOS e Android para clientes', owner: 'Carlos Lima', status: 'in-progress', requester: 'Produto', costInitial: 120000, costDev: 85000, costFinal: 0, docs: ['escopo.pdf', 'wireframes.fig'], company: 'Nova Tech', team: 'Engenharia' },
  { name: 'Portal do cliente', description: 'Área logada com faturas e suporte', owner: 'Diego Rocha', status: 'review', requester: 'Atendimento', costInitial: 65000, costDev: 61000, costFinal: 0, docs: [], company: 'Grupo Horizonte', team: 'Engenharia' },
  { name: 'CRM interno', description: 'Funil de vendas e relatórios', owner: 'Gabriela Nunes', status: 'done', requester: 'Comercial', costInitial: 50000, costDev: 47000, costFinal: 52000, docs: ['manual.pdf'], company: 'Acme Ltda', team: 'Dados' },
  { name: 'Campanha Q4', description: 'Campanha de fim de ano', owner: 'Bruna Alves', status: 'paused', requester: 'Marketing', costInitial: 30000, costDev: 9000, costFinal: 0, docs: [], company: 'Verde Alimentos', team: 'Marketing' },
  { name: 'Data Lake', description: 'Centralizar dados das áreas', owner: 'Felipe Costa', status: 'started', requester: 'Diretoria de TI', costInitial: 200000, costDev: 35000, costFinal: 0, docs: ['arquitetura.pdf'], company: 'Lumen Saúde', team: 'Dados' },
  { name: 'Onboarding', description: 'Trilha de boas-vindas para novos clientes', owner: 'Ana Souza', status: 'archived', requester: 'Sucesso do cliente', costInitial: 15000, costDev: 14000, costFinal: 14500, docs: [], company: 'Órbita Logística', team: 'Produto' },
];

// Lista única de projetos: a tabela de criação e os carrosséis (Home e Projetos) leem daqui
@Injectable({ providedIn: 'root' })
export class ProjectStore {
  private nextId = 1;
  readonly projects = signal<Project[]>(SEED.map((project) => this.build(project)));

  readonly carouselItems = computed<CarouselItem[]>(() =>
    this.projects().map((project) => ({ name: project.name, cover: project.cover, link: '/projetos' })),
  );

  add(project: NewProject) {
    this.projects.update((list) => [...list, this.build(project)]);
  }

  private build(project: NewProject): Project {
    const id = this.nextId++;
    return { ...project, id, cover: COVERS[(id - 1) % COVERS.length] };
  }
}
