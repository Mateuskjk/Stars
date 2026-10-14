import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiSync } from '../api/api-sync';
import { api } from '../api/http';
import { SessionStore } from '../api/session';
import { CompanyStore } from '../companies/company-store';
import { PROJECT_STATUSES, ProjectStore } from '../projects/project-store';

interface ArchivedActivity {
  id: string;
  titulo: string;
  projetoId: string | null;
  arquivadoTipo: string | null;
  arquivadoEm: string;
}

interface SuspendedCompany {
  id: string;
  nome: string;
  sigla: string;
  membros: number;
}

// Arquivo: o que saiu das telas sem ser apagado — atividades (gerais e de projeto) e projetos arquivados ou
// cancelados, e empresas suspensas. Daqui dá para restaurar e reativar.
@Component({
  selector: 'app-archive',
  imports: [RouterLink],
  templateUrl: './archive.html',
  host: { class: 'archive' },
})
export class Archive {
  private readonly projectStore = inject(ProjectStore);
  private readonly companyStore = inject(CompanyStore);
  private readonly ids = inject(ApiSync).ids;
  private readonly session = inject(SessionStore);
  protected readonly busy = signal<string | null>(null); // id do item sendo restaurado
  protected readonly message = signal('');

  protected readonly tab = signal<'atividades' | 'projetos' | 'empresas'>('atividades');
  protected readonly search = signal('');
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  private readonly activitiesData = signal<ArchivedActivity[]>([]);
  private readonly companiesData = signal<SuspendedCompany[]>([]);

  constructor() {
    void this.load();
  }

  private async load() {
    this.error.set('');
    try {
      const [activities, companies] = await Promise.all([
        api<ArchivedActivity[]>('/data/atividades?arquivadas=somente'),
        api<SuspendedCompany[]>('/data/empresas/suspensas'),
      ]);
      this.activitiesData.set(activities);
      this.companiesData.set(companies);
    } catch (error) {
      this.error.set((error as Error).message);
    } finally {
      this.loading.set(false);
    }
  }

  private matches = (text: string) => text.toLowerCase().includes(this.search().trim().toLowerCase());

  protected readonly activities = computed(() =>
    this.activitiesData()
      .map((a) => ({ ...a, origem: this.projectName(a.projetoId) }))
      .filter((a) => this.matches(`${a.titulo} ${a.origem}`)),
  );

  protected readonly projects = computed(() =>
    this.projectStore
      .projects()
      .filter((p) => (p.status === 'archived' || p.status === 'canceled') && this.matches(`${p.name} ${p.company}`)),
  );

  // As do banco + as suspensas agora há pouco (ainda na sessão até ela se atualizar)
  protected readonly companies = computed(() => {
    const fromDb = this.companiesData();
    const names = new Set(fromDb.map((c) => c.nome));
    const recent = this.companyStore
      .companies()
      .filter((c) => !c.active && !names.has(c.name))
      .map((c) => ({ id: `local-${c.id}`, nome: c.name, sigla: '', membros: null as number | null }));
    return [...fromDb, ...recent].filter((c) => this.matches(c.nome));
  });

  protected readonly counts = computed(() => ({
    atividades: this.activities().length,
    projetos: this.projects().length,
    empresas: this.companies().length,
  }));

  // Atividade volta para o Backlog (geral) ou para o kanban do projeto. Recarrega os dados para ela aparecer lá.
  protected async restoreActivity(a: ArchivedActivity) {
    await this.run(a.id, async () => {
      await api(`/data/atividades/${encodeURIComponent(a.id)}`, { method: 'PATCH', body: JSON.stringify({ arquivado: null }) });
      await this.session.check();
      return `"${a.titulo}" foi restaurada.`;
    });
  }

  // Projeto volta como "Não iniciado" (a mesma regra do desarquivar da página do projeto)
  protected restoreProject(id: number, name: string) {
    this.projectStore.setStatus(id, 'not-started');
    this.message.set(`"${name}" foi restaurado como Não iniciado.`);
  }

  // Empresa volta a ficar ativa; a sessão ganha a empresa de novo e os dados são recarregados
  protected async reactivate(c: { id: string; nome: string }) {
    if (c.id.startsWith('local-')) {
      const local = this.companyStore.companies().find((x) => `local-${x.id}` === c.id);
      if (local) this.companyStore.setActive(local.id, true);
      return this.message.set(`"${c.nome}" foi reativada.`);
    }
    await this.run(c.id, async () => {
      await api(`/data/empresas/${encodeURIComponent(c.id)}/reativar`, { method: 'POST' });
      await this.session.check();
      return `"${c.nome}" foi reativada.`;
    });
  }

  private async run(id: string, action: () => Promise<string>) {
    this.busy.set(id);
    this.message.set('');
    try {
      this.message.set(await action());
      await this.load();
    } catch (error) {
      this.error.set((error as Error).message);
    } finally {
      this.busy.set(null);
    }
  }

  private projectName(projetoId: string | null) {
    if (!projetoId) return 'Atividade geral';
    if (!this.ids.projeto.has(projetoId)) return 'Projeto';
    const n = this.ids.projeto.num(projetoId);
    return this.projectStore.projects().find((p) => p.id === n)?.name ?? 'Projeto';
  }

  protected statusLabel(id: string) {
    return PROJECT_STATUSES.find((s) => s.id === id)?.label ?? id;
  }

  protected date(iso: string) {
    return iso ? new Date(iso).toLocaleDateString('pt-BR') : '';
  }
}
