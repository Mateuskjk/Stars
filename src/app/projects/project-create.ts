import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { USERS } from '../chat/chat';
import { CompanyStore } from '../companies/company-store';
import { SectorStore } from '../companies/sector-store';
import { ProjectStatus, ProjectStore, SECTORS, TEAMS } from './project-store';
import { ResponsiveTable } from '../responsive-table';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

@Component({
  imports: [ResponsiveTable, RouterLink],
  selector: 'app-project-create',
  templateUrl: './project-create.html',
  host: { class: 'project-create' },
})
export class ProjectCreate {
  private readonly store = inject(ProjectStore);

  protected readonly projects = this.store.projects;
  protected readonly statuses = this.store.statuses; // inclui as colunas criadas no kanban
  protected readonly people = USERS.map((user) => user.name);
  protected readonly companies = inject(CompanyStore).activeNames;
  protected readonly teams = TEAMS;
  // Setor: sugere os setores cadastrados da empresa escolhida (sem empresa, a lista geral); aceita outro digitado
  private readonly companyStore = inject(CompanyStore);
  private readonly sectorStore = inject(SectorStore);
  protected readonly draftCompany = signal('');
  protected readonly sectors = computed(() => {
    const company = this.companyStore.companies().find((c) => c.name === this.draftCompany());
    if (!company) return SECTORS;
    const names = this.sectorStore.sectors().filter((s) => s.companyId === company.id).map((s) => s.name);
    return names.length ? names : SECTORS;
  });

  // Status escolhido na linha de criação (para a bolinha de cor acompanhar o select)
  protected readonly draftStatus = signal<ProjectStatus>('idea');
  protected readonly created = signal<string | null>(null);

  protected status(id: ProjectStatus) {
    return this.statuses().find((status) => status.id === id)!;
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
      sector: text('sector'),
      team: text('team'),
    });

    form.reset();
    this.draftStatus.set('idea');
    this.draftCompany.set('');
    this.created.set(name);
  }
}
