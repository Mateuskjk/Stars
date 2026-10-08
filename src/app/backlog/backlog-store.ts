import { Injectable, signal } from '@angular/core';

export type BacklogStatus = 'to-refine' | 'refined' | 'waiting' | 'refinement-done' | 'archived' | 'canceled';

// Ordem das colunas = ordem de "Avançar" e "Recuar"
export const BACKLOG_COLUMNS: { id: BacklogStatus; label: string; color: string }[] = [
  { id: 'to-refine', label: 'Para refinar', color: '#9b7be0' },
  { id: 'refined', label: 'Refinado', color: '#2a78d6' },
  { id: 'waiting', label: 'Aguardando', color: '#eda100' },
  { id: 'refinement-done', label: 'Finalizado refinamento', color: '#0ca30c' },
  { id: 'archived', label: 'Arquivado', color: '#898781' },
  { id: 'canceled', label: 'Cancelados', color: '#d03b3b' },
];

export interface Subtask {
  id: number;
  title: string;
  done: boolean;
}

export interface BacklogComment {
  id: number;
  author: string;
  text: string;
  time: Date;
}

export interface Attachment {
  id: number;
  name: string;
  type: string;
  size: number;
  url: string; // object URL do arquivo, criado no navegador
}

export interface BacklogItem {
  id: number;
  name: string;
  description: string;
  status: BacklogStatus;
  due: string; // AAAA-MM-DD ou ''
  tags: string[];
  assignee: string;
  comments: BacklogComment[];
  subtasks: Subtask[];
  attachments: Attachment[];
  locked: boolean;
  favorite: boolean;
  // Planning: só vale para atividades em "Finalizado refinamento"
  planning?: 'ready' | 'waiting'; // padrão: 'ready' (pronta para a sprint)
  sprintId?: number; // definida quando a atividade entra numa sprint
}

// Cores das tags: cada tag pega sempre a mesma cor (pelo texto), sem precisar configurar
const TAG_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#9b7be0', '#e87ba4', '#008300', '#4a3aa7', '#d03b3b'];

export function tagColor(tag: string) {
  let hash = 0;
  for (const char of tag) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}

let nextId = 1;
export const newId = () => nextId++;

export function emptyItem(status: BacklogStatus = 'to-refine'): BacklogItem {
  return {
    id: 0,
    name: '',
    description: '',
    status,
    due: '',
    tags: [],
    assignee: '',
    comments: [],
    subtasks: [],
    attachments: [],
    locked: false,
    favorite: false,
  };
}

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);

// ponytail: atividades de exemplo, só em memória (somem ao recarregar; anexos usam object URL da sessão)
const SEED: Omit<BacklogItem, 'id'>[] = [
  { ...emptyItem('to-refine'), name: 'Padronizar e-mails de boas-vindas', description: 'Revisar textos e layout dos e-mails automáticos.', due: inDays(5), tags: ['comunicação'], assignee: 'Ana Souza', favorite: true },
  { ...emptyItem('to-refine'), name: 'Levantar ferramentas de BI', description: 'Comparar opções para os relatórios internos.', tags: ['pesquisa', 'dados'], assignee: 'Gabriela Nunes' },
  { ...emptyItem('refined'), name: 'Política de férias 2027', description: 'Definir janelas e regras de aprovação.', due: inDays(-2), tags: ['RH'], assignee: 'Felipe Costa', comments: [{ id: 1, author: 'Ana Souza', text: 'Falta validar com o jurídico.', time: hoursAgo(20) }] },
  {
    ...emptyItem('refined'),
    name: 'Organizar o onboarding de novos devs',
    tags: ['time', 'documentação'],
    assignee: 'Carlos Lima',
    subtasks: [
      { id: 1, title: 'Checklist do primeiro dia', done: true },
      { id: 2, title: 'Acessos e contas', done: true },
      { id: 3, title: 'Guia do repositório', done: false },
    ],
  },
  { ...emptyItem('waiting'), name: 'Renovar licenças de software', description: 'Aguardando orçamento do fornecedor.', due: inDays(10), tags: ['financeiro'], assignee: 'Diego Rocha', locked: true },
  { ...emptyItem('refinement-done'), name: 'Rotina de backup dos arquivos', tags: ['infra'], assignee: 'Felipe Costa', due: inDays(12) },
  { ...emptyItem('refinement-done'), name: 'Template de relatório mensal', tags: ['documentação'], assignee: 'Gabriela Nunes', due: inDays(8) },
  { ...emptyItem('refinement-done'), name: 'Treinamento de segurança', tags: ['time', 'infra'], assignee: 'Eva Martins', planning: 'waiting' },
  { ...emptyItem('refinement-done'), name: 'Automatizar convites da daily', tags: ['time'], assignee: 'Ana Souza', sprintId: 12 },
  { ...emptyItem('archived'), name: 'Pesquisa de clima Q2', tags: ['RH'], assignee: 'Ana Souza' },
  { ...emptyItem('canceled'), name: 'Migrar wiki para nova plataforma', tags: ['documentação'], assignee: 'Eva Martins' },
];

// Atividades gerais do backlog (não são atividades de projeto)
@Injectable({ providedIn: 'root' })
export class BacklogStore {
  readonly items = signal<BacklogItem[]>(SEED.map((item) => ({ ...item, id: newId() })));

  save(item: BacklogItem) {
    if (item.id) {
      this.items.update((list) => list.map((current) => (current.id === item.id ? item : current)));
    } else {
      this.items.update((list) => [...list, { ...item, id: newId() }]);
    }
  }

  patch(id: number, changes: Partial<BacklogItem>) {
    this.items.update((list) => list.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }

  move(id: number, status: BacklogStatus) {
    this.items.update((list) => list.map((item) => (item.id === id && !item.locked ? { ...item, status } : item)));
  }

  remove(id: number) {
    const item = this.items().find((current) => current.id === id);
    item?.attachments.forEach((file) => URL.revokeObjectURL(file.url));
    this.items.update((list) => list.filter((current) => current.id !== id));
  }
}
