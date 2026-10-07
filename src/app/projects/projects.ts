import { Component, computed, inject, signal } from '@angular/core';
import { Carousel } from '../carousel/carousel';
import { ProjectStore } from './project-store';

export type Status = 'active' | 'paused' | 'archived' | 'canceled';

export interface Activity {
  id: number;
  title: string;
  project: string;
  assignee: string;
  status: Status;
}

export const COLUMNS: { id: Status; label: string }[] = [
  { id: 'active', label: 'Ativos' },
  { id: 'paused', label: 'Pausados' },
  { id: 'archived', label: 'Arquivados' },
  { id: 'canceled', label: 'Cancelados' },
];

// ponytail: atividades fixas de exemplo; trocar por um service/API quando o backend existir
const ACTIVITIES: Activity[] = [
  { id: 1, title: 'Nova home com carrossel', project: 'Redesign do site', assignee: 'Bruna Alves', status: 'active' },
  { id: 2, title: 'Login com biometria', project: 'App mobile', assignee: 'Carlos Lima', status: 'active' },
  { id: 3, title: 'Integração de pagamento', project: 'Portal do cliente', assignee: 'Diego Rocha', status: 'active' },
  { id: 4, title: 'Relatório de funil', project: 'CRM interno', assignee: 'Gabriela Nunes', status: 'active' },
  { id: 5, title: 'Testes end-to-end', project: 'Portal do cliente', assignee: 'Eva Martins', status: 'active' },
  { id: 6, title: 'Peças para redes sociais', project: 'Campanha Q4', assignee: 'Bruna Alves', status: 'paused' },
  { id: 7, title: 'Migração do banco', project: 'Data Lake', assignee: 'Felipe Costa', status: 'paused' },
  { id: 8, title: 'Modo offline', project: 'App mobile', assignee: 'Carlos Lima', status: 'paused' },
  { id: 9, title: 'Trilha de boas-vindas', project: 'Onboarding', assignee: 'Ana Souza', status: 'archived' },
  { id: 10, title: 'Landing page antiga', project: 'Redesign do site', assignee: 'Bruna Alves', status: 'archived' },
  { id: 11, title: 'Chat com IA no CRM', project: 'CRM interno', assignee: 'Felipe Costa', status: 'canceled' },
  { id: 12, title: 'Versão para tablet', project: 'App mobile', assignee: 'Diego Rocha', status: 'canceled' },
];

export function initials(name: string) {
  return name
    .split(' ')
    .map((word) => word[0])
    .slice(0, 2)
    .join('');
}

@Component({
  imports: [Carousel],
  selector: 'app-projects',
  templateUrl: './projects.html',
  host: { class: 'projects' },
})
export class Projects {
  protected readonly projects = inject(ProjectStore).carouselItems;
  protected readonly columns = COLUMNS;
  protected readonly initials = initials;

  protected readonly activities = signal(ACTIVITIES);
  protected readonly dragging = signal<number | null>(null);
  protected readonly dropTarget = signal<Status | null>(null);

  protected readonly board = computed(() =>
    COLUMNS.map((column) => ({
      ...column,
      cards: this.activities().filter((activity) => activity.status === column.id),
    })),
  );

  protected move(id: number, status: Status) {
    this.activities.update((list) => list.map((activity) => (activity.id === id ? { ...activity, status } : activity)));
  }

  // Arrastar e soltar (mouse). No toque e no teclado, o seletor "Mover para" do card faz o mesmo.
  protected onDragOver(event: DragEvent, status: Status) {
    if (this.dragging() === null) return;
    event.preventDefault(); // permite soltar aqui
    this.dropTarget.set(status);
  }

  protected onDrop(event: DragEvent, status: Status) {
    event.preventDefault();
    const id = this.dragging();
    if (id !== null) this.move(id, status);
    this.endDrag();
  }

  protected endDrag() {
    this.dragging.set(null);
    this.dropTarget.set(null);
  }
}
