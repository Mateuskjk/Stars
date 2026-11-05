import { SprintStore } from '../planning/sprint-store';
import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { PeopleStore } from '../members/people-store';
import { RouterLink } from '@angular/router';
import { CompanyStore } from '../companies/company-store';
import { SectorStore } from '../companies/sector-store';
import { BoardToolbar, BoardView, FilterField, FilterRule, matchesQuery, optionsOf, passesFilters } from '../kanban/board-toolbar';
import { Project, ProjectStatus, ProjectStore, SECTORS, TEAMS } from './project-store';
import { ProjectTaskStore } from './project-tasks';
import { ResponsiveTable } from '../responsive-table';
import { Projects } from './projects';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// Janela do projeto: ver os dados, editar, criar um novo ou confirmar a exclusão
type Dialog = { kind: 'view' | 'edit' | 'delete'; project: Project } | { kind: 'new' };

// /projetos — os projetos em kanban (o de Geral) ou em lista, com busca e filtros; na lista, clicar abre os dados,
// com editar e excluir
@Component({
  imports: [ResponsiveTable, RouterLink, BoardToolbar, Projects],
  selector: 'app-project-create',
  templateUrl: './project-create.html',
  host: { class: 'project-create' },
})
export class ProjectCreate {
  private readonly store = inject(ProjectStore);
  private readonly tasks = inject(ProjectTaskStore);
  protected readonly sprintName = (n: number) => this.sprintStore.nameOf(n); // nome da sprint da Planning
  private readonly sprintStore = inject(SprintStore);

  protected readonly projects = this.store.visible; // só empresas ativas
  protected readonly statuses = this.store.statuses; // inclui as colunas criadas no kanban
  protected readonly people = inject(PeopleStore).names; // membros reais da empresa escolhida
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

  // ---------- Barra: busca, filtros e lista/grade ----------
  protected readonly query = signal('');
  protected readonly view = signal<BoardView>('board');
  protected readonly filters = signal<FilterRule[]>([]);
  // Sprint de um projeto = as sprints das atividades dele
  private readonly sprintsOf = computed(() => {
    const map = new Map<number, string[]>();
    for (const t of this.tasks.tasks()) map.set(t.projectId, [...(map.get(t.projectId) ?? []), this.sprintName(t.sprint)]);
    return map;
  });
  protected readonly filterFields = computed<FilterField[]>(() => {
    const all = this.projects();
    // por nome (mais recentes primeiro): períodos que caem na mesma sprint da Planning viram uma opção só
    const latest = new Map<string, number>();
    for (const t of this.tasks.tasks()) latest.set(this.sprintName(t.sprint), Math.max(latest.get(this.sprintName(t.sprint)) ?? 0, t.sprint));
    const sprints = [...latest.keys()].sort((a, b) => latest.get(b)! - latest.get(a)!);
    return [
      { key: 'sprint', label: 'Sprint', options: sprints.map((n) => ({ value: n, label: n })) },
      { key: 'status', label: 'Status', options: this.statuses().map((s) => ({ value: s.id, label: s.label })) },
      { key: 'empresa', label: 'Empresa', options: optionsOf(all.map((p) => p.company)) },
      { key: 'setor', label: 'Setor', options: optionsOf(all.map((p) => p.sector)) },
      { key: 'responsavel', label: 'Responsável', options: optionsOf(all.map((p) => p.owner)) },
    ];
  });
  private readonly field = (p: Project, key: string) =>
    key === 'sprint' ? (this.sprintsOf().get(p.id) ?? []) : key === 'status' ? p.status : key === 'empresa' ? p.company : key === 'setor' ? p.sector : p.owner;
  // Mesma regra para a lista e para o kanban
  protected readonly shown = computed(() => {
    const query = this.query();
    const filters = this.filters();
    return (p: Project) => matchesQuery(p.name, query) && passesFilters(filters, (key) => this.field(p, key));
  });
  protected readonly list = computed(() => this.projects().filter(this.shown()));

  protected readonly created = signal<{ id: number; name: string } | null>(null);

  protected status(id: ProjectStatus) {
    return this.statuses().find((status) => status.id === id)!;
  }

  protected money(value: number) {
    return value ? currency.format(value) : '—';
  }

  // ---------- Janela do projeto ----------
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('projectDialog');
  protected readonly open = signal<Dialog | null>(null);
  // Status escolhido no formulário (para a bolinha de cor acompanhar o select)
  protected readonly draftStatus = signal<ProjectStatus>('idea');

  // Também volta para os dados a partir do formulário ou da confirmação (a janela já está aberta)
  protected show(project: Project) {
    this.open.set({ kind: 'view', project });
    if (!this.dialog().nativeElement.open) this.dialog().nativeElement.showModal();
  }

  protected openNew() {
    this.draftStatus.set('idea');
    this.draftCompany.set('');
    this.open.set({ kind: 'new' });
    this.dialog().nativeElement.showModal();
  }

  // Também chamados pelos botões dos cartões do kanban (com a janela ainda fechada)
  protected startEdit(project: Project) {
    this.draftStatus.set(project.status);
    this.draftCompany.set(project.company);
    this.open.set({ kind: 'edit', project });
    this.present();
  }

  protected askDelete(project: Project) {
    this.open.set({ kind: 'delete', project });
    this.present();
  }

  private present() {
    if (!this.dialog().nativeElement.open) this.dialog().nativeElement.showModal();
  }

  protected confirmDelete(project: Project) {
    this.store.remove(project.id);
    this.close();
  }

  protected close() {
    this.dialog().nativeElement.close();
  }

  protected closeOnBackdrop(event: MouseEvent) {
    if (event.target === this.dialog().nativeElement) this.close();
  }

  // O formulário serve para criar e para editar; os anexos novos se somam aos que o projeto já tem
  protected save(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    const text = (field: string) => String(data.get(field) ?? '').trim();
    const number = (field: string) => Number(data.get(field)) || 0;

    const name = text('name');
    if (!name) return;
    const fields = {
      name,
      description: text('description'),
      owner: text('owner'),
      status: text('status') as ProjectStatus,
      requester: text('requester'),
      costInitial: number('costInitial'),
      costDev: number('costDev'),
      costFinal: number('costFinal'),
      company: text('company'),
      sector: text('sector'),
      team: text('team'),
    };
    // ponytail: guarda só o nome dos arquivos; o envio de verdade depende do backend
    const docs = data
      .getAll('docs')
      .filter((file): file is File => file instanceof File && file.size > 0)
      .map((file) => file.name);

    const current = this.open();
    if (current?.kind === 'edit') {
      this.store.update(current.project.id, { ...fields, docs: [...current.project.docs, ...docs] });
      const saved = this.store.projects().find((p) => p.id === current.project.id);
      if (saved) this.open.set({ kind: 'view', project: saved });
      return;
    }
    this.store.add({ ...fields, docs });
    this.created.set({ id: this.store.projects().at(-1)!.id, name });
    this.close();
  }
}
