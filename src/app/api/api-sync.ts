import { Injectable, inject } from '@angular/core';
import { api } from './http';
import { datesFromName } from './sprint-dates';
import { BacklogItem, BacklogStatus, BacklogStore, emptyItem } from '../backlog/backlog-store';
import { Company, CompanyStore, DEFAULT_VIEW } from '../companies/company-store';
import { SPRINT_COLUMNS, SectorStore } from '../companies/sector-store';
import { MembersStore, Member, Role, defaultPermissions } from '../members/members-store';
import { SprintStatus, SprintStore, Sprint } from '../planning/sprint-store';
import { NewProject, ProjectStatus, ProjectStore } from '../projects/project-store';
import { ProjectTask, ProjectTaskStore, TaskStatus, sprintOf, sprintWindow, today } from '../projects/project-tasks';
import { TeamsStore } from '../teams/teams-store';

// ---------- Formato que vem da API (/api/data/...) ----------
interface DbEmpresa { id: string; nome: string; sigla: string; avatarUrl: string | null; ativo: boolean; fusoHorario: string }
interface DbSetor { id: string; nome: string; cor: string; tenantId: string; membros: { usuarioId: string; gestor: boolean }[] }
interface DbUsuario { id: string; nome: string; email: string | null; papel: string; situacao: string; tenantId: string }
interface DbEquipe { id: string; nome: string; tenantId: string; membros: string[] }
interface DbProjeto {
  id: string; nome: string; descricao: string; situacao: string; arquivado: boolean; responsavelId: string;
  equipeId: string | null; setorId: string | null; tenantId: string; orcamento: number; custoPrevisto: number; custoRealizado: number;
}
interface DbSprint { id: string; nome: string; situacao: string; tenantId: string; inicio: string | null; fim: string | null }
interface DbAtividade {
  id: string; titulo: string; descricao: string; status: string; prazo: string | null; tags: string[]; compartilhadoCom: string[];
  responsavelId: string | null; sprintId: string | null; projetoId: string | null; setorGeral: string | null; bloqueioMotivo: string | null;
  estimativa: number | null; arquivadoTipo: string | null; criadoEm: string; atualizadoEm: string;
}
export interface Me { nome: string; email: string; memberships: { usuarioId: string; tenantId: string; papel: string; role: Role; readOnly: boolean }[] }

// Ids do banco (texto) ↔ ids das telas (números 1, 2, 3…), por tipo de registro
class IdMap {
  private readonly toNum = new Map<string, number>();
  private readonly toDb = new Map<number, string>();
  num(id: string) {
    let n = this.toNum.get(id);
    if (n === undefined) {
      n = this.toNum.size + 1;
      this.toNum.set(id, n);
      this.toDb.set(n, id);
    }
    return n;
  }
  has(id: string | null | undefined): id is string {
    return !!id && this.toNum.has(id);
  }
  db(n: number) {
    return this.toDb.get(n) ?? null;
  }
}

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');
const ROLE_RANK: Record<Role, number> = { admin: 3, supervisor: 2, member: 1 };
const roleOf = (papel: string): Role => (papel === 'DONO' ? 'admin' : papel === 'GESTOR' ? 'supervisor' : 'member');
const SECTOR_COLORS: Record<string, string> = { sky: '#2a78d6', emerald: '#1baf7a', amber: '#eda100', rose: '#e87ba4', violet: '#9b7be0' };
const COMPANY_COVERS = [
  'linear-gradient(135deg, #222b44, #8a93b8)',
  'linear-gradient(135deg, #1f4e79, #a7c4e0)',
  'linear-gradient(135deg, #8a4b3c, #f0c9a8)',
  'linear-gradient(135deg, #2f5d3a, #b5d6a7)',
  'linear-gradient(135deg, #2f5d62, #bfe0dc)',
  'linear-gradient(135deg, #5c3d6e, #d9c2e6)',
];

// Situação do projeto no banco → coluna do kanban de projetos
function projectStatus(p: DbProjeto): ProjectStatus {
  if (p.arquivado) return 'archived';
  return ({ NAO_INICIADO: 'not-started', EM_ANDAMENTO: 'in-progress', PARADO: 'paused', CONCLUIDO: 'done' } as Record<string, ProjectStatus>)[p.situacao] ?? 'not-started';
}

function sprintStatus(situacao: string): SprintStatus {
  return situacao === 'ATIVA' ? 'active' : 'closed'; // FECHADA e PREPARACAO (ainda não começou)
}

// Status da atividade no banco → coluna do kanban da sprint (setor) e do projeto
const SPRINT_COLUMN: Record<string, string> = { RASCUNHO: 'todo', PRONTO: 'todo', EM_EXECUCAO: 'doing', EM_REVISAO: 'review', CONCLUIDO: 'done' };

// Atividade sem projeto → cartão do Backlog / Planning / kanban geral do setor
export function backlogStatus(a: Pick<DbAtividade, 'status' | 'arquivadoTipo' | 'sprintId'>): BacklogStatus {
  if (a.arquivadoTipo === 'CANCELADO') return 'canceled';
  if (a.arquivadoTipo) return 'archived';
  if (a.status === 'RASCUNHO' && !a.sprintId) return 'to-refine';
  return 'refinement-done'; // pronta para a sprint ou já em andamento nela
}

// Carrega os dados do banco e troca os exemplos das telas por eles.
// ponytail: por enquanto só leitura; o que for criado/editado nas telas fica só nesta sessão (até a API de escrita)
@Injectable({ providedIn: 'root' })
export class ApiSync {
  private readonly companies = inject(CompanyStore);
  private readonly sectors = inject(SectorStore);
  private readonly members = inject(MembersStore);
  private readonly teams = inject(TeamsStore);
  private readonly projects = inject(ProjectStore);
  private readonly sprints = inject(SprintStore);
  private readonly backlog = inject(BacklogStore);
  private readonly tasks = inject(ProjectTaskStore);

  readonly ids = {
    empresa: new IdMap(),
    setor: new IdMap(),
    pessoa: new IdMap(), // uma pessoa (e-mail) pode ter um usuário em cada empresa
    equipe: new IdMap(),
    projeto: new IdMap(),
    sprint: new IdMap(),
    atividade: new IdMap(),
    tarefa: new IdMap(),
  };

  async load(me: Me) {
    const [empresas, setores, usuarios, equipes, projetos, sprints, atividades] = await Promise.all([
      api<DbEmpresa[]>('/data/empresas'),
      api<DbSetor[]>('/data/setores'),
      api<DbUsuario[]>('/data/usuarios'),
      api<DbEquipe[]>('/data/equipes'),
      api<DbProjeto[]>('/data/projetos'),
      api<DbSprint[]>('/data/sprints'),
      api<DbAtividade[]>('/data/atividades'),
    ]);
    const ids = this.ids;

    // ---------- Empresas ----------
    const empresaNome = new Map(empresas.map((e) => [e.id, e.nome]));
    this.companies.companies.set(
      empresas.map<Company>((e) => {
        const id = ids.empresa.num(e.id);
        return {
          id,
          name: e.nome,
          description: e.sigla,
          site: '',
          active: e.ativo,
          image: e.avatarUrl,
          cover: COMPANY_COVERS[(id - 1) % COMPANY_COVERS.length],
          timeZone: e.fusoHorario || 'America/Sao_Paulo',
          view: { ...DEFAULT_VIEW },
        };
      }),
    );

    // ---------- Pessoas (membros): agrupa os usuários pelo e-mail ----------
    const keyOf = (u: DbUsuario) => u.email?.trim().toLowerCase() || u.id;
    const byPerson = new Map<string, DbUsuario[]>();
    for (const u of usuarios) byPerson.set(keyOf(u), [...(byPerson.get(keyOf(u)) ?? []), u]);
    const personOf = new Map<string, number>(); // usuarioId → pessoa
    const personName = new Map<number, string>();
    const people: Member[] = [];
    for (const [key, rows] of byPerson) {
      const id = ids.pessoa.num(key);
      for (const r of rows) personOf.set(r.id, id);
      personName.set(id, rows[0].nome);
      const active = rows.filter((r) => r.situacao === 'ATIVO');
      if (!active.length && !rows.some((r) => r.situacao === 'CONVIDADO')) continue; // desativados não aparecem
      const role = (active.length ? active : rows).map((r) => roleOf(r.papel)).sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a])[0];
      people.push({
        id,
        name: rows[0].nome,
        email: rows[0].email ?? '',
        role,
        status: active.length ? 'active' : 'pending',
        permissions: defaultPermissions(role),
        company: empresaNome.get((active[0] ?? rows[0]).tenantId) ?? null,
        tokenHint: null,
        invite: null,
      });
    }
    this.members.members.set(people);
    this.members.sessionEmail.set(me.email);
    const nameOf = (usuarioId: string | null) => (usuarioId && personOf.has(usuarioId) ? personName.get(personOf.get(usuarioId)!)! : '');
    const peopleIds = (usuarioIds: string[]) => [...new Set(usuarioIds.filter((u) => personOf.has(u)).map((u) => personOf.get(u)!))];

    // ---------- Setores ----------
    const setorNome = new Map(setores.map((s) => [s.id, s.nome]));
    this.sectors.sectors.set(
      setores.map((s) => ({
        id: ids.setor.num(s.id),
        companyId: ids.empresa.num(s.tenantId),
        name: s.nome,
        description: '',
        manager: nameOf(s.membros.find((m) => m.gestor)?.usuarioId ?? null),
        memberIds: peopleIds(s.membros.map((m) => m.usuarioId)),
        color: SECTOR_COLORS[s.cor] ?? SECTOR_COLORS['sky'],
        columns: SPRINT_COLUMNS,
      })),
    );

    // ---------- Projetos (ids na mesma ordem do ProjectStore.load) ----------
    const equipeNome = new Map(equipes.map((e) => [e.id, e.nome]));
    projetos.forEach((p) => ids.projeto.num(p.id));
    this.projects.load(
      projetos.map<NewProject>((p) => ({
        name: p.nome,
        description: p.descricao,
        owner: nameOf(p.responsavelId),
        status: projectStatus(p),
        requester: '',
        costInitial: p.orcamento,
        costDev: p.custoPrevisto,
        costFinal: p.custoRealizado,
        docs: [],
        company: empresaNome.get(p.tenantId) ?? '',
        sector: (p.setorId && setorNome.get(p.setorId)) || '',
        team: (p.equipeId && equipeNome.get(p.equipeId)) || '',
      })),
    );

    // ---------- Equipes ----------
    this.teams.teams.set(
      equipes.map((e) => ({
        id: ids.equipe.num(e.id),
        name: e.nome,
        focus: '',
        memberIds: peopleIds(e.membros),
        projectIds: projetos.filter((p) => p.equipeId === e.id).map((p) => ids.projeto.num(p.id)),
        activityIds: [],
      })),
    );

    // ---------- Sprints: período da migração, ou datas do nome, ou (a ativa) a janela de 7 dias úteis de hoje ----------
    const sprintById = new Map<string, Sprint>();
    for (const s of sprints) {
      const fromName = datesFromName(s.nome);
      const current = s.situacao === 'ATIVA' ? sprintWindow(sprintOf(today())) : null;
      const start = s.inicio ?? fromName?.inicio ?? current?.start;
      const end = s.fim ?? fromName?.fim ?? current?.end;
      if (!start || !end) continue; // sem como saber o período: fica fora dos gráficos
      sprintById.set(s.id, {
        id: ids.sprint.num(s.id),
        name: s.nome,
        start,
        end,
        goal: s.situacao === 'PREPARACAO' ? 'Em preparação' : '',
        status: sprintStatus(s.situacao),
      });
    }
    this.sprints.sprints.set([...sprintById.values()]);

    // ---------- Atividades: com projeto → kanban do projeto; sem projeto → Backlog / Planning / setor ----------
    const items: BacklogItem[] = [];
    const tasks: ProjectTask[] = [];
    for (const a of atividades) {
      const sprint = a.sprintId ? sprintById.get(a.sprintId) : undefined;
      const done = a.status === 'CONCLUIDO';
      const doneAt = done ? day(a.atualizadoEm) : undefined;
      if (a.projetoId && ids.projeto.has(a.projetoId)) {
        const start = sprint?.start ?? day(a.criadoEm);
        tasks.push({
          id: ids.tarefa.num(a.id),
          projectId: ids.projeto.num(a.projetoId),
          title: a.titulo,
          description: a.descricao,
          assignee: nameOf(a.responsavelId),
          points: a.estimativa ?? 1,
          status: (SPRINT_COLUMN[a.status] ?? 'todo') as TaskStatus,
          sprint: sprintOf(start),
          start,
          end: day(a.prazo) || sprint?.end || start,
          createdAt: day(a.criadoEm),
          doneAt: doneAt ?? null,
        });
        continue;
      }
      items.push({
        ...emptyItem(backlogStatus(a)),
        id: ids.atividade.num(a.id),
        name: a.titulo,
        description: a.descricao,
        due: day(a.prazo),
        tags: a.tags,
        assignee: nameOf(a.responsavelId),
        sharedWith: a.compartilhadoCom.map(nameOf).filter(Boolean),
        locked: !!a.bloqueioMotivo,
        sprintId: sprint?.id,
        sectorId: a.setorGeral && ids.setor.has(a.setorGeral) ? ids.setor.num(a.setorGeral) : undefined,
        sprintStatus: sprint ? SPRINT_COLUMN[a.status] : undefined,
        addedAt: sprint ? sprint.start : undefined,
        doneAt: sprint ? doneAt : undefined,
      });
    }
    this.backlog.items.set(items);
    this.tasks.tasks.set(tasks);
  }
}
