import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { USERS } from '../chat/chat';
import { CompanyStore } from '../companies/company-store';
import { PROJECT_STATUSES, ProjectStatus, ProjectStore, TEAMS } from './project-store';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

@Component({
  imports: [RouterLink],
  selector: 'app-project-create',
  templateUrl: './project-create.html',
  host: { class: 'project-create' },
})
export class ProjectCreate {
  private readonly store = inject(ProjectStore);

  protected readonly projects = this.store.projects;
  protected readonly statuses = PROJECT_STATUSES;
  protected readonly people = USERS.map((user) => user.name);
  protected readonly companies = inject(CompanyStore).activeNames;
  protected readonly teams = TEAMS;

  // Status escolhido na linha de criação (para a bolinha de cor acompanhar o select)
  protected readonly draftStatus = signal<ProjectStatus>('idea');
  protected readonly created = signal<string | null>(null);

  protected status(id: ProjectStatus) {
    return PROJECT_STATUSES.find((status) => status.id === id)!;
  }

  protected money(value: number) {
    return value ? currency.format(value) : '—';
  }

  // Os campos da última linha pertencem ao <form> pelo atributo form="new-project",
  // então o FormData já traz tudo, inclusive os anexos
  protected create(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    const text = (field: string) => String(data.get(field) ?? '').trim();
    const number = (field: string) => Number(data.get(field)) || 0;

    const name = text('name');
    if (!name) return;

    this.store.add({
      name,
      description: text('description'),
      owner: text('owner'),
      status: text('status') as ProjectStatus,
      requester: text('requester'),
      costInitial: number('costInitial'),
      costDev: number('costDev'),
      costFinal: number('costFinal'),
      // ponytail: guarda só o nome dos arquivos; o envio de verdade depende do backend
      docs: data
        .getAll('docs')
        .filter((file): file is File => file instanceof File && file.size > 0)
        .map((file) => file.name),
      company: text('company'),
      team: text('team'),
    });

    form.reset();
    this.draftStatus.set('idea');
    this.created.set(name);
  }
}
