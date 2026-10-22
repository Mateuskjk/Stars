import { Component, DestroyRef, afterNextRender, computed, inject, input, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MembersStore } from '../members/members-store';
import { BacklogStore } from '../backlog/backlog-store';
import { ProjectStore, cssImage } from '../projects/project-store';
import { ProjectTaskStore } from '../projects/project-tasks';
import { initials } from '../projects/projects';
import { CompanyStore } from './company-store';
import { SectorEditor } from './sector-editor';
import { SectorStore } from './sector-store';

const LOCALES = { 'pt-BR': 'Português (Brasil)', 'en-US': 'Inglês (EUA)', 'es-ES': 'Espanhol' } as const;

// /empresas/:id — cabeçalho com os dados da empresa e os perfis dos setores dela
@Component({
  imports: [RouterLink, SectorEditor],
  selector: 'app-company-page',
  templateUrl: './company-page.html',
  host: { class: 'company-page' },
})
export class CompanyPage {
  readonly id = input.required<string>(); // vem da rota

  private readonly companyStore = inject(CompanyStore);
  private readonly membersStore = inject(MembersStore);
  private readonly sectorStore = inject(SectorStore);
  private readonly projectStore = inject(ProjectStore);
  private readonly taskStore = inject(ProjectTaskStore);
  private readonly backlog = inject(BacklogStore);

  protected readonly initials = initials;
  protected readonly cssImage = cssImage;
  protected readonly locales = LOCALES;
  protected readonly now = signal(new Date());
  protected readonly isAdmin = this.membersStore.isAdmin; // só admin cria setores

  protected readonly company = computed(() => this.companyStore.companies().find((c) => c.id === Number(this.id())) ?? null);
  protected readonly members = computed(() => {
    const name = this.company()?.name;
    return this.membersStore.members().filter((m) => m.company === name && m.status === 'active');
  });
  protected readonly projects = computed(() => {
    const name = this.company()?.name;
    return this.projectStore.projects().filter((p) => p.company === name);
  });

  // Perfil de cada setor: gestor, projetos do setor e o andamento das atividades deles
  protected readonly sectors = computed(() => {
    const company = this.company();
    if (!company) return [];
    const statuses = this.projectStore.statuses();
    const tasks = this.taskStore.tasks();
    return this.sectorStore.ofCompany(company.id).map((sector) => {
      const projects = this.projects()
        .filter((p) => p.sector.toLowerCase() === sector.name.toLowerCase())
        .map((p) => ({ ...p, statusInfo: statuses.find((s) => s.id === p.status) }));
      const ids = new Set(projects.map((p) => p.id));
      const sectorTasks = tasks.filter((t) => ids.has(t.projectId));
      const points = sectorTasks.reduce((n, t) => n + t.points, 0);
      const done = sectorTasks.filter((t) => t.status === 'done').reduce((n, t) => n + t.points, 0);
      return {
        ...sector,
        projects,
        open: sectorTasks.filter((t) => t.status !== 'done').length,
        general: this.backlog.items().filter((item) => item.sectorId === sector.id && !['archived', 'canceled'].includes(item.status)).length,
        progress: points ? Math.round((done / points) * 100) : null,
      };
    });
  });

  // Projetos com um setor que ainda não tem perfil nesta empresa
  protected readonly withoutSector = computed(() => {
    const names = new Set(this.sectors().map((s) => s.name.toLowerCase()));
    return this.projects().filter((p) => !p.sector || !names.has(p.sector.toLowerCase()));
  });

  constructor() {
    // Hora local da empresa, atualizada a cada minuto
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const timer = setInterval(() => this.now.set(new Date()), 60_000);
      destroyRef.onDestroy(() => clearInterval(timer));
    });
  }

  protected localTime(timeZone: string) {
    return this.now().toLocaleTimeString('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' });
  }

  protected readonly editor = viewChild(SectorEditor); // só existe para admin

  protected sectorOf(id: number) {
    return this.sectorStore.byId(id)!;
  }
}
