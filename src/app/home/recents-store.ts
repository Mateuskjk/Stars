import { Injectable, computed, inject, signal } from '@angular/core';
import { BacklogStore } from '../backlog/backlog-store';
import { CompanyStore } from '../companies/company-store';
import { SectorStore } from '../companies/sector-store';
import { MembersStore } from '../members/members-store';
import { TeamsStore } from '../teams/teams-store';
import { NotesStore } from '../notes/notes-store';
import { ProjectStore } from '../projects/project-store';

export type RecentKind = 'project' | 'note' | 'card' | 'chat' | 'dashboard' | ProfileKind;
export type ProfileKind = 'member' | 'team' | 'company' | 'sector'; // "Perfis acessados"

const PROFILE_KINDS: RecentKind[] = ['member', 'team', 'company', 'sector'];

interface Visit {
  kind: RecentKind;
  id: string | number;
}

export interface RecentItem {
  type: string;
  title: string;
  link: string;
  query?: Record<string, number>; // ?nota=, ?cartao=, ?com=, ?membro=…
  initials?: string;
}

const KEY = 'stars.recents';
const LIMIT = 40;

const initialsOf = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

const DASHBOARDS: Record<string, { title: string; link: string }> = {
  dashboards: { title: 'Dashboards', link: '/dashboards' },
  projects: { title: 'Dash de Projetos', link: '/projetos' },
};

// "Recentes" da lateral: o que a pessoa realmente abriu, guardado neste navegador.
// Só referências (tipo + id): o nome vem dos dados atuais e o que foi apagado some da lista.
@Injectable({ providedIn: 'root' })
export class RecentsStore {
  private readonly projects = inject(ProjectStore);
  private readonly notes = inject(NotesStore);
  private readonly backlog = inject(BacklogStore);
  private readonly members = inject(MembersStore);
  private readonly teams = inject(TeamsStore);
  private readonly companies = inject(CompanyStore);
  private readonly sectors = inject(SectorStore);

  private readonly visits = signal<Visit[]>([]);
  private loaded = false;

  readonly items = computed(() => this.list(false));
  readonly profiles = computed(() => this.list(true));

  // 5 mais recentes de cada lista; o que não existe mais fica de fora
  private list(profiles: boolean) {
    return this.visits()
      .filter((visit) => PROFILE_KINDS.includes(visit.kind) === profiles)
      .map((visit) => this.resolve(visit))
      .filter((item): item is RecentItem => !!item)
      .slice(0, 5);
  }

  // Chamado no navegador (no SSR não existe localStorage)
  load() {
    if (this.loaded || typeof localStorage === 'undefined') return;
    this.loaded = true;
    this.notes.load(); // as notas ficam no localStorage; sem isso não dá para conferir se existem
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? '[]');
      if (Array.isArray(saved)) this.visits.set(saved.filter((v) => v && typeof v.kind === 'string').slice(0, LIMIT));
    } catch {
      // dado corrompido: começa vazio
    }
  }

  visit(kind: RecentKind, id: string | number) {
    this.load();
    this.visits.update((list) => [{ kind, id }, ...list.filter((v) => !(v.kind === kind && v.id === id))].slice(0, LIMIT));
    try {
      localStorage.setItem(KEY, JSON.stringify(this.visits()));
    } catch {
      // sem espaço ou sem permissão: a lista vale só nesta sessão
    }
  }

  private resolve({ kind, id }: Visit): RecentItem | null | undefined {
    switch (kind) {
      case 'project': {
        const project = this.projects.projects().find((p) => p.id === id);
        return project && { type: 'Projeto', title: project.name, link: `/projetos/${project.id}` };
      }
      case 'note': {
        const note = this.notes.notes().find((n) => n.id === id);
        return note && { type: 'Nota', title: note.title, link: '/workspace/notes', query: { nota: note.id } };
      }
      case 'card': {
        const card = this.backlog.items().find((item) => item.id === id);
        return card && { type: 'Cartão', title: card.name, link: '/workspace/backlog', query: { cartao: card.id } };
      }
      case 'chat': {
        const user = this.members.members().find((m) => m.id === id);
        return user && { type: 'Conversa', title: user.name, link: '/conversas', query: { com: user.id } };
      }
      case 'member': {
        const member = this.members.members().find((m) => m.id === id);
        return member && { type: 'Perfil', title: member.name, link: '/configuracoes/membros', query: { membro: member.id }, initials: initialsOf(member.name) };
      }
      case 'team': {
        const team = this.teams.teams().find((t) => t.id === id);
        return team && { type: 'Equipe', title: team.name, link: '/configuracoes/equipes', query: { equipe: team.id }, initials: initialsOf(team.name) };
      }
      case 'company': {
        const company = this.companies.companies().find((c) => c.id === id);
        return company && { type: 'Empresa', title: company.name, link: `/empresas/${company.id}`, initials: initialsOf(company.name) };
      }
      case 'sector': {
        const sector = this.sectors.byId(Number(id));
        const company = sector && this.companies.companies().find((c) => c.id === sector.companyId);
        return sector && company && { type: `Setor · ${company.name}`, title: sector.name, link: `/empresas/${company.id}/setores/${sector.id}`, initials: initialsOf(sector.name) };
      }
      case 'dashboard': {
        const dash = DASHBOARDS[id];
        return dash && { type: 'Dashboard', ...dash };
      }
    }
    return null;
  }
}
