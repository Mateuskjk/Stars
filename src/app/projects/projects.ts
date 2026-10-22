import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AddColumn } from '../kanban/add-column';
import { ColumnTitle, isCustomColumn } from '../kanban/column-title';
import { MembersStore } from '../members/members-store';
import { ProjectStatus, ProjectStore } from './project-store';

export function initials(name: string) {
  return name
    .split(' ')
    .map((word) => word[0])
    .slice(0, 2)
    .join('');
}

@Component({
  imports: [AddColumn, ColumnTitle, RouterLink],
  selector: 'app-projects',
  templateUrl: './projects.html',
  host: { class: 'projects' },
})
export class Projects {
  private readonly store = inject(ProjectStore);
  private readonly router = inject(Router);
  protected readonly columns = this.store.statuses;
  protected readonly initials = initials;
  // Criar, renomear e excluir colunas: só admin
  protected readonly isAdmin = inject(MembersStore).isAdmin;
  protected readonly isCustom = (id: string) => this.isAdmin() && isCustomColumn(id);

  protected readonly dragging = signal<number | null>(null);
  protected readonly dropTarget = signal<ProjectStatus | null>(null);

  // Uma coluna por situação do projeto; os cards são os projetos
  protected readonly board = computed(() =>
    this.columns().map((column) => ({
      ...column,
      cards: this.store.topLevel().filter((project) => project.status === column.id),
    })),
  );

  // Clicar em qualquer parte do card abre o projeto (o seletor "Mover para" e o link do nome cuidam de si)
  protected openProject(id: number, event: Event) {
    if ((event.target as HTMLElement).closest('select, a')) return;
    this.router.navigate(['/projetos', id]);
  }

  protected move(id: number, status: ProjectStatus) {
    this.store.setStatus(id, status);
  }

  protected addColumn(label: string) {
    this.store.addStatus(label);
  }

  protected renameColumn(id: ProjectStatus, label: string) {
    this.store.renameStatus(id, label);
  }

  protected removeColumn(id: ProjectStatus) {
    this.store.removeStatus(id);
  }

  // Arrastar e soltar (mouse). No toque e no teclado, o seletor "Mover para" do card faz o mesmo.
  protected onDragOver(event: DragEvent, status: ProjectStatus) {
    if (this.dragging() === null) return;
    event.preventDefault(); // permite soltar aqui
    this.dropTarget.set(status);
  }

  protected onDrop(event: DragEvent, status: ProjectStatus) {
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
