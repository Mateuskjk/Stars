import { Injectable, effect, inject, untracked } from '@angular/core';
import { api } from './http';
import { SessionStore } from './session';
import { datesFromName } from './sprint-dates';
import { BACKLOG_COLUMNS, BacklogItem, BacklogStatus, BacklogStore, emptyItem } from '../backlog/backlog-store';
import { Company, CompanyStore, DEFAULT_VIEW } from '../companies/company-store';
import { SPRINT_COLUMNS, SectorStore } from '../companies/sector-store';
import { MembersStore, Member, Role, defaultPermissions } from '../members/members-store';
import { Team } from '../teams/teams-store';
import { Sector } from '../companies/sector-store';
import { PROJECT_STATUSES, Project } from '../projects/project-store';
import { SprintStatus, SprintStore, Sprint } from '../planning/sprint-store';
import { NewProject, ProjectStatus, ProjectStore } from '../projects/project-store';
import { ProjectTask, ProjectTaskStore, TASK_STATUSES, TaskStatus, sprintOf, sprintWindow, today } from '../projects/project-tasks';
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
interface DbExtra { tipo: string; registroId: string; dados: Record<string, unknown> }
interface DbSprint { id: string; nome: string; situacao: string; tenantId: string; inicio: string | null; fim: string | null }
interface DbAtividade {
  id: string; titulo: string; descricao: string; status: string; prazo: string | null; tags: string[]; compartilhadoCom: string[];
  responsavelId: string | null; sprintId: string | null; projetoId: string | null; setorGeral: string | null; bloqueioMotivo: string | null;
  estimativa: number | null; arquivadoTipo: string | null; criadoEm: string; atualizadoEm: string; tenantId: string;
  subtarefas?: { id: string; titulo: string; feito: boolean }[];
  comentarios?: { id: string; autor: string | null; texto: string; em: string }[];
  favorito?: boolean; colunaBacklog?: string | null; colunaSprint?: string | null; planning?: string | null;
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
      this.link(id, n);
    }
    return n;
  }
  // Registro criado na tela: liga o id que o banco devolveu ao número que a tela já usa
  link(id: string, n: number) {
    this.toNum.set(id, n);
    this.toDb.set(n, id);
  }
  has(id: string | null | undefined): id is string {
    return !!id && this.toNum.has(id);
  }
  db(n: number | undefined | null) {
    return n == null ? null : (this.toDb.get(n) ?? null);
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
const COMPANY_KEY = 'stars.company';

// Situação do projeto no banco → coluna do kanban de projetos
function projectStatus(p: DbProjeto): ProjectStatus {
  if (p.arquivado) return 'archived';
  return ({ NAO_INICIADO: 'not-started', EM_ANDAMENTO: 'in-progress', PARADO: 'paused', CONCLUIDO: 'done' } as Record<string, ProjectStatus>)[p.situacao] ?? 'not-started';
}

const SECTOR_COLOR_NAME = Object.fromEntries(Object.entries(SECTOR_COLORS).map(([name, hex]) => [hex, name]));
const PAPEL_OF: Record<Role, string> = { admin: 'DONO', supervisor: 'GESTOR', member: 'ATENDENTE' };
const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || 'EMP';

// Coluna do kanban de projetos → situação no banco (o status exato fica nos extras)
function projectSituacao(status: ProjectStatus) {
  if (status === 'idea' || status === 'not-started') return 'NAO_INICIADO';
  if (status === 'paused') return 'PARADO';
  if (status === 'done') return 'CONCLUIDO';
  return 'EM_ANDAMENTO';
}

const sprintStatus = (situacao: string): SprintStatus => (situacao === 'ATIVA' ? 'active' : 'closed'); // FECHADA e PREPARACAO
const sprintSituacao = (status: SprintStatus) => (status === 'active' ? 'ATIVA' : 'FECHADA');

// Status da atividade no banco ↔ coluna do kanban da sprint (setor) e do projeto
const SPRINT_COLUMN: Record<string, string> = { RASCUNHO: 'todo', PRONTO: 'todo', EM_EXECUCAO: 'doing', EM_REVISAO: 'review', CONCLUIDO: 'done' };
const DB_STATUS: Record<string, string> = { todo: 'PRONTO', doing: 'EM_EXECUCAO', review: 'EM_REVISAO', done: 'CONCLUIDO' };

// Atividade sem projeto → cartão do Backlog / Planning / kanban geral do setor
export function backlogStatus(a: Pick<DbAtividade, 'status' | 'arquivadoTipo' | 'sprintId'>): BacklogStatus {
  if (a.arquivadoTipo === 'CANCELADO') return 'canceled';
  if (a.arquivadoTipo) return 'archived';
  if (a.status === 'RASCUNHO' && !a.sprintId) return 'to-refine';
  return 'refinement-done'; // pronta para a sprint ou já em andamento nela
}

// Cartão do Backlog → status no banco (o que não cabe nos 5 status fica na coluna salva no schema lexagile)
export function dbStatusOf(item: Pick<BacklogItem, 'status' | 'sprintId' | 'sprintStatus'>) {
  if (item.sprintId) return DB_STATUS[item.sprintStatus ?? 'todo'] ?? 'EM_EXECUCAO';
  return item.status === 'to-refine' ? 'RASCUNHO' : 'PRONTO';
}

// Carrega os dados do banco, troca os exemplos das telas por eles e grava no banco o que as telas mudarem
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

  // Erro da última gravação (a faixa de aviso fica na sessão, que o app já carrega)
  private readonly saveError = inject(SessionStore).saveError;

  // Pessoa (nome) → usuário dela em cada empresa
  private readonly userByPersonTenant = new Map<string, string>(); // `${pessoa}|${tenant}` → usuarioId
  private readonly personByName = new Map<string, number>();
  private readonly projectTenant = new Map<number, string>();
  private readonly itemTenant = new Map<number, string>();
  private readonly taskTenant = new Map<number, string>();

  // Último estado gravado de cada registro (para mandar só o que mudou)
  private loaded = false;
  private readonly lastItems = new Map<number, BacklogItem>();
  private readonly lastTasks = new Map<number, ProjectTask>();
  private readonly lastSprints = new Map<number, Sprint>();
  private readonly lastCompanies = new Map<number, Company>();
  private readonly lastSectors = new Map<number, Sector>();
  private readonly lastMembers = new Map<number, Member>();
  private readonly lastTeams = new Map<number, Team>();
  private readonly lastProjects = new Map<number, Project>();
  private readonly teamTenant = new Map<number, string>();
  private queue = Promise.resolve();

  constructor() {
    effect(() => {
      const items = this.backlog.items();
      untracked(() => this.loaded && this.syncItems(items));
    });
    effect(() => {
      const tasks = this.tasks.tasks();
      untracked(() => this.loaded && this.syncTasks(tasks));
    });
    effect(() => {
      const sprints = this.sprints.sprints();
      untracked(() => this.loaded && this.syncSprints(sprints));
    });
    // Configurações: empresas, setores, membros, equipes e projetos
    effect(() => {
      const list = this.companies.companies();
      untracked(() => this.loaded && this.syncCompanies(list));
    });
    effect(() => {
      const list = this.sectors.sectors();
      untracked(() => this.loaded && this.syncSectors(list));
    });
    effect(() => {
      const list = this.members.members();
      untracked(() => this.loaded && this.syncMembers(list));
    });
    effect(() => {
      const list = this.teams.teams();
      untracked(() => this.loaded && this.syncTeams(list));
    });
    effect(() => {
      const list = this.projects.projects();
      untracked(() => this.loaded && this.syncProjects(list));
    });
  }

  selectCompany(id: number) {
    this.companies.currentId.set(id);
    try {
      localStorage.setItem(COMPANY_KEY, this.ids.empresa.db(id) ?? '');
    } catch {
      // sem localStorage: vale só nesta sessão
    }
  }

  async load(me: Me) {
    this.loaded = false;
    const [empresas, setores, usuarios, equipes, projetos, sprints, atividades, extras] = await Promise.all([
      api<DbEmpresa[]>('/data/empresas'),
      api<DbSetor[]>('/data/setores'),
      api<DbUsuario[]>('/data/usuarios'),
      api<DbEquipe[]>('/data/equipes'),
      api<DbProjeto[]>('/data/projetos'),
      api<DbSprint[]>('/data/sprints'),
      api<DbAtividade[]>('/data/atividades'),
      api<DbExtra[]>('/data/extras').catch(() => [] as DbExtra[]), // sem os extras, as telas abrem com os valores padrão
    ]);
    const ids = this.ids;
    // Dados das telas que o banco atual não tem (descrição, site, colunas, foco, status exato…)
    const extraMap = new Map(extras.map((x) => [`${x.tipo}|${x.registroId}`, x.dados]));
    const extra = <T>(tipo: string, id: string) => (extraMap.get(`${tipo}|${id}`) ?? {}) as Partial<T>;

    // ---------- Empresas (e a escolhida: a última usada ou a primeira de quem fez login) ----------
    const empresaNome = new Map(empresas.map((e) => [e.id, e.nome]));
    this.companies.companies.set(
      empresas.map<Company>((e) => {
        const id = ids.empresa.num(e.id);
        const x = extra<{ descricao: string; site: string; view: Company['view'] }>('empresa', e.id);
        return {
          id,
          name: e.nome,
          description: x.descricao ?? '',
          site: x.site ?? '',
          active: e.ativo,
          image: e.avatarUrl,
          cover: COMPANY_COVERS[(id - 1) % COMPANY_COVERS.length],
          timeZone: e.fusoHorario || 'America/Sao_Paulo',
          view: { ...DEFAULT_VIEW, ...x.view },
        };
      }),
    );
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(COMPANY_KEY);
    } catch {
      // sem localStorage
    }
    const mine = me.memberships.map((m) => m.tenantId).filter((t) => ids.empresa.has(t));
    const chosen = saved && mine.includes(saved) ? saved : mine[0];
    this.companies.currentId.set(chosen ? ids.empresa.num(chosen) : null);

    // ---------- Pessoas (membros): agrupa os usuários pelo e-mail ----------
    const keyOf = (u: DbUsuario) => u.email?.trim().toLowerCase() || u.id;
    const byPerson = new Map<string, DbUsuario[]>();
    for (const u of usuarios) byPerson.set(keyOf(u), [...(byPerson.get(keyOf(u)) ?? []), u]);
    const personOf = new Map<string, number>(); // usuarioId → pessoa
    const personName = new Map<number, string>();
    const people: Member[] = [];
    this.userByPersonTenant.clear();
    this.personByName.clear();
    for (const [key, rows] of byPerson) {
      const id = ids.pessoa.num(key);
      for (const r of rows) {
        personOf.set(r.id, id);
        this.userByPersonTenant.set(`${id}|${r.tenantId}`, r.id);
      }
      personName.set(id, rows[0].nome);
      this.personByName.set(rows[0].nome, id);
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

    // ---------- Setores (e o setor de cada usuário, pelos membros definidos na migração) ----------
    const setorNome = new Map(setores.map((s) => [s.id, s.nome]));
    const setorDoUsuario = new Map<string, string>();
    for (const s of setores) for (const m of s.membros) if (!setorDoUsuario.has(m.usuarioId)) setorDoUsuario.set(m.usuarioId, s.id);
    this.sectors.sectors.set(
      setores.map((s) => ({
        id: ids.setor.num(s.id),
        companyId: ids.empresa.num(s.tenantId),
        name: s.nome,
        description: extra<{ descricao: string }>('setor', s.id).descricao ?? '',
        manager: nameOf(s.membros.find((m) => m.gestor)?.usuarioId ?? null),
        memberIds: peopleIds(s.membros.map((m) => m.usuarioId)),
        color: SECTOR_COLORS[s.cor] ?? SECTOR_COLORS['sky'],
        columns: extra<Sector>('setor', s.id).columns ?? SPRINT_COLUMNS,
      })),
    );

    // ---------- Projetos (ids na mesma ordem do ProjectStore.load) ----------
    const equipeNome = new Map(equipes.map((e) => [e.id, e.nome]));
    this.projectTenant.clear();
    projetos.forEach((p) => this.projectTenant.set(ids.projeto.num(p.id), p.tenantId));
    this.projects.load(
      projetos.map<NewProject>((p) => {
        const x = extra<{ status: ProjectStatus; requester: string; docs: string[] }>('projeto', p.id);
        const savedStatus = x.status && PROJECT_STATUSES.some((st) => st.id === x.status) ? x.status : null;
        return {
        name: p.nome,
        description: p.descricao,
        owner: nameOf(p.responsavelId),
        status: p.arquivado ? (savedStatus === 'canceled' ? 'canceled' : 'archived') : (savedStatus ?? projectStatus(p)),
        requester: x.requester ?? '',
        costInitial: p.orcamento,
        costDev: p.custoPrevisto,
        costFinal: p.custoRealizado,
        docs: x.docs ?? [],
        company: empresaNome.get(p.tenantId) ?? '',
        sector: (p.setorId && setorNome.get(p.setorId)) || '',
        team: (p.equipeId && equipeNome.get(p.equipeId)) || '',
        };
      }),
    );

    // ---------- Equipes ----------
    this.teamTenant.clear();
    this.teams.teams.set(
      equipes.map((e) => ({
        id: (this.teamTenant.set(ids.equipe.num(e.id), e.tenantId), ids.equipe.num(e.id)),
        name: e.nome,
        focus: extra<{ focus: string }>('equipe', e.id).focus ?? '',
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
        companyId: ids.empresa.num(s.tenantId),
      });
    }

    // ---------- Atividades ----------
    // Com projeto → kanban do projeto. Sem projeto → Backlog / Planning / kanban do setor.
    // Setor da atividade: o marcado como "geral" na migração; sem marcação, o setor do responsável.
    // Marcada como geral e com projeto: aparece nos dois (no setor e no projeto).
    const items: BacklogItem[] = [];
    const tasks: ProjectTask[] = [];
    this.itemTenant.clear();
    this.taskTenant.clear();
    const backlogIds = new Set(BACKLOG_COLUMNS.map((c) => c.id as string));
    const sprintIds = new Set(SPRINT_COLUMNS.map((c) => c.id as string));
    let commentId = 1;
    for (const a of atividades) {
      const sprint = a.sprintId ? sprintById.get(a.sprintId) : undefined;
      const done = a.status === 'CONCLUIDO';
      const doneAt = done ? day(a.atualizadoEm) : undefined;
      const inProject = !!a.projetoId && ids.projeto.has(a.projetoId);
      if (inProject) {
        const start = sprint?.start ?? day(a.criadoEm);
        const id = ids.tarefa.num(a.id);
        this.taskTenant.set(id, a.tenantId);
        const saved = a.colunaSprint && a.colunaSprint in TASK_STATUSES ? (a.colunaSprint as TaskStatus) : null;
        tasks.push({
          id,
          projectId: ids.projeto.num(a.projetoId!),
          title: a.titulo,
          description: a.descricao,
          assignee: nameOf(a.responsavelId),
          points: a.estimativa ?? 1,
          status: saved ?? ((SPRINT_COLUMN[a.status] ?? 'todo') as TaskStatus),
          sprint: sprintOf(start),
          start,
          end: day(a.prazo) || sprint?.end || start,
          createdAt: day(a.criadoEm),
          doneAt: doneAt ?? null,
        });
      }
      const setor = a.setorGeral ?? (inProject ? null : (a.responsavelId && setorDoUsuario.get(a.responsavelId)) || null);
      if (inProject && !a.setorGeral) continue;
      const id = ids.atividade.num(a.id);
      this.itemTenant.set(id, a.tenantId);
      const status = backlogStatus(a);
      items.push({
        ...emptyItem(a.colunaBacklog && backlogIds.has(a.colunaBacklog) && !a.arquivadoTipo ? (a.colunaBacklog as BacklogStatus) : status),
        id,
        name: a.titulo,
        description: a.descricao,
        due: day(a.prazo),
        tags: a.tags,
        assignee: nameOf(a.responsavelId),
        sharedWith: a.compartilhadoCom.map(nameOf).filter(Boolean),
        locked: !!a.bloqueioMotivo,
        favorite: !!a.favorito,
        planning: a.planning === 'waiting' || a.planning === 'ready' ? a.planning : undefined,
        subtasks: (a.subtarefas ?? []).map((st, i) => ({ id: i + 1, title: st.titulo, done: st.feito })),
        comments: (a.comentarios ?? []).map((c) => ({ id: commentId++, author: c.autor ?? '—', text: c.texto, time: new Date(c.em) })),
        companyId: ids.empresa.num(a.tenantId),
        sprintId: sprint?.id,
        sectorId: setor && ids.setor.has(setor) ? ids.setor.num(setor) : undefined,
        sprintStatus: sprint ? (a.colunaSprint && sprintIds.has(a.colunaSprint) ? a.colunaSprint : SPRINT_COLUMN[a.status]) : undefined,
        addedAt: sprint ? sprint.start : undefined,
        doneAt: sprint ? doneAt : undefined,
      });
    }

    this.sprints.sprints.set([...sprintById.values()]);
    this.backlog.items.set(items);
    this.tasks.tasks.set(tasks);

    // A partir daqui, o que as telas mudarem é gravado no banco
    this.lastItems.clear();
    this.lastTasks.clear();
    this.lastSprints.clear();
    for (const i of items) this.lastItems.set(i.id, i);
    for (const t of tasks) this.lastTasks.set(t.id, t);
    for (const s of sprintById.values()) this.lastSprints.set(s.id, s);
    const snap = <T extends { id: number }>(map: Map<number, T>, list: T[]) => {
      map.clear();
      for (const x of list) map.set(x.id, x);
    };
    snap(this.lastCompanies, this.companies.companies());
    snap(this.lastSectors, this.sectors.sectors());
    snap(this.lastMembers, this.members.members());
    snap(this.lastTeams, this.teams.teams());
    snap(this.lastProjects, this.projects.projects());
    this.loaded = true;
  }

  // ---------- Gravação ----------
  private userIn(name: string, tenantId: string) {
    const person = this.personByName.get(name);
    return person ? (this.userByPersonTenant.get(`${person}|${tenantId}`) ?? null) : null;
  }

  private tenantOfItem(item: BacklogItem) {
    return (
      this.itemTenant.get(item.id) ??
      this.ids.empresa.db(item.companyId ?? this.sectors.byId(item.sectorId ?? -1)?.companyId ?? this.companies.currentId())
    );
  }

  // Campos do banco que a tela controla (comparados com o último estado gravado)
  private itemFields(item: BacklogItem, tenantId: string): Record<string, unknown> {
    return {
      titulo: item.name,
      descricao: item.description,
      prazo: item.due || null,
      tags: item.tags,
      responsavelId: item.assignee ? this.userIn(item.assignee, tenantId) : null,
      compartilhadoCom: item.sharedWith.map((n) => this.userIn(n, tenantId)).filter(Boolean),
      status: dbStatusOf(item),
      sprintId: this.ids.sprint.db(item.sprintId),
      bloqueado: item.locked,
      setorGeral: this.ids.setor.db(item.sectorId),
      arquivado: item.status === 'archived' ? 'ARQUIVADO' : item.status === 'canceled' ? 'CANCELADO' : null,
      colunaBacklog: item.status,
      colunaSprint: item.sprintStatus ?? null,
      subtarefas: item.subtasks.map((s) => ({ titulo: s.title, feito: s.done })),
      favorito: item.favorite,
      planning: item.planning ?? null,
    };
  }

  private taskFields(task: ProjectTask): Record<string, unknown> {
    const tenantId = this.taskTenant.get(task.id) ?? this.projectTenant.get(task.projectId) ?? '';
    return {
      titulo: task.title,
      descricao: task.description ?? '',
      responsavelId: task.assignee ? this.userIn(task.assignee, tenantId) : null,
      estimativa: task.points,
      status: DB_STATUS[task.status] ?? 'EM_EXECUCAO',
      prazo: task.end || null,
      colunaSprint: task.status,
    };
  }

  private static changed(before: Record<string, unknown>, after: Record<string, unknown>) {
    return Object.fromEntries(Object.entries(after).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k])));
  }

  // Grava em ordem, uma de cada vez (não embaralha mudanças seguidas no mesmo cartão)
  private send(path: string | (() => string), method: string, body: unknown, after?: (result: { id?: string } | null) => void) {
    this.queue = this.queue.then(async () => {
      try {
        const result = await api<{ id?: string } | null>(typeof path === 'string' ? path : path(), { method, body: JSON.stringify(body) });
        after?.(result);
      } catch (e) {
        this.saveError.set(`Não foi possível salvar no banco: ${(e as Error).message}`);
      }
    });
  }

  private syncItems(items: BacklogItem[]) {
    const seen = new Set<number>();
    for (const item of items) {
      seen.add(item.id);
      const before = this.lastItems.get(item.id);
      if (before === item) continue;
      this.lastItems.set(item.id, item);
      const tenantId = this.tenantOfItem(item);
      if (!tenantId) continue;
      const dbId = this.ids.atividade.db(item.id);
      const fields = this.itemFields(item, tenantId);
      if (!dbId && !before) {
        this.itemTenant.set(item.id, tenantId);
        this.send('/data/atividades', 'POST', { ...fields, tenantId }, (r) => r?.id && this.ids.atividade.link(r.id, item.id));
        continue;
      }
      const diff = ApiSync.changed(before ? this.itemFields(before, tenantId) : {}, fields);
      const newComments = item.comments.filter((c) => !before?.comments.some((b) => b.id === c.id));
      // O id do banco é lido na hora de enviar: a atividade pode ter acabado de ser criada
      const path = () => `/data/atividades/${this.ids.atividade.db(item.id)}`;
      if (Object.keys(diff).length) this.send(path, 'PATCH', diff);
      for (const c of newComments) this.send(path, 'PATCH', { comentario: c.text });
    }
    // Excluída na tela: arquiva no banco (nada é apagado de verdade)
    for (const [id] of this.lastItems) {
      if (seen.has(id)) continue;
      this.lastItems.delete(id);
      const dbId = this.ids.atividade.db(id);
      if (dbId) this.send(`/data/atividades/${dbId}`, 'PATCH', { arquivado: 'ARQUIVADO' });
    }
  }

  private syncTasks(tasks: ProjectTask[]) {
    const seen = new Set<number>();
    for (const task of tasks) {
      seen.add(task.id);
      const before = this.lastTasks.get(task.id);
      if (before === task) continue;
      this.lastTasks.set(task.id, task);
      const fields = this.taskFields(task);
      if (!this.ids.tarefa.db(task.id) && !before) {
        const tenantId = this.projectTenant.get(task.projectId);
        if (!tenantId) continue;
        this.taskTenant.set(task.id, tenantId);
        const body = { ...fields, tenantId, projetoId: this.ids.projeto.db(task.projectId) };
        this.send('/data/atividades', 'POST', body, (r) => r?.id && this.ids.tarefa.link(r.id, task.id));
        continue;
      }
      const diff = ApiSync.changed(before ? this.taskFields(before) : {}, fields);
      if (Object.keys(diff).length) this.send(() => `/data/atividades/${this.ids.tarefa.db(task.id)}`, 'PATCH', diff);
    }
    for (const [id] of this.lastTasks) {
      if (seen.has(id)) continue;
      this.lastTasks.delete(id);
      const dbId = this.ids.tarefa.db(id);
      if (dbId) this.send(`/data/atividades/${dbId}`, 'PATCH', { arquivado: 'ARQUIVADO' });
    }
  }

  // Diferença genérica: novos → criar, alterados → mandar só o que mudou, excluídos → arquivar/desativar
  private syncList<T extends { id: number }>(
    list: T[],
    last: Map<number, T>,
    opts: {
      dbId: (x: T) => string | null;
      fields: (x: T) => Record<string, unknown> | null; // null: não dá para gravar (ex.: sem empresa)
      create?: (x: T, fields: Record<string, unknown>) => void;
      update: (x: T, diff: Record<string, unknown>, before: T) => void;
      remove?: (dbId: string, before: T) => void;
    },
  ) {
    const seen = new Set<number>();
    for (const x of list) {
      seen.add(x.id);
      const before = last.get(x.id);
      if (before === x) continue;
      last.set(x.id, x);
      const fields = opts.fields(x);
      if (!fields) continue;
      if (!before) {
        if (!opts.dbId(x)) opts.create?.(x, fields);
        continue;
      }
      const diff = ApiSync.changed(opts.fields(before) ?? {}, fields);
      if (Object.keys(diff).length) opts.update(x, diff, before);
    }
    for (const [id, before] of last) {
      if (seen.has(id)) continue;
      last.delete(id);
      const dbId = opts.dbId(before);
      if (dbId) opts.remove?.(dbId, before);
    }
  }

  private companyDb(name: string) {
    return this.ids.empresa.db(this.companies.companies().find((c) => c.name === name)?.id);
  }

  private syncCompanies(list: Company[]) {
    this.syncList(list, this.lastCompanies, {
      dbId: (c) => this.ids.empresa.db(c.id),
      fields: (c) => ({
        nome: c.name,
        ativo: c.active,
        fusoHorario: c.timeZone,
        avatarUrl: c.image,
        extra: { descricao: c.description, site: c.site, view: c.view },
      }),
      create: (c, fields) => this.send('/data/empresas', 'POST', { ...fields, sigla: initialsOf(c.name) }, (r) => r?.id && this.ids.empresa.link(r.id, c.id)),
      update: (c, diff) => this.send(() => `/data/empresas/${this.ids.empresa.db(c.id)}`, 'PATCH', diff),
    });
  }

  private syncSectors(list: Sector[]) {
    this.syncList(list, this.lastSectors, {
      dbId: (s) => this.ids.setor.db(s.id),
      fields: (s) => {
        const tenantId = this.ids.empresa.db(s.companyId);
        if (!tenantId) return null;
        const managerId = this.personByName.get(s.manager);
        const people = [...new Set([...s.memberIds, ...(managerId ? [managerId] : [])])];
        const membros = people
          .map((p) => ({ usuarioId: this.userByPersonTenant.get(`${p}|${tenantId}`), gestor: p === managerId }))
          .filter((m) => m.usuarioId);
        return { nome: s.name, cor: SECTOR_COLOR_NAME[s.color] ?? 'sky', membros, extra: { descricao: s.description, columns: s.columns } };
      },
      create: (s, fields) =>
        this.send('/data/setores', 'POST', { ...fields, tenantId: this.ids.empresa.db(s.companyId) }, (r) => r?.id && this.ids.setor.link(r.id, s.id)),
      update: (s, diff) => this.send(() => `/data/setores/${this.ids.setor.db(s.id)}`, 'PATCH', diff),
      remove: (dbId) => this.send(`/data/setores/${dbId}`, 'DELETE', {}),
    });
  }

  private syncMembers(list: Member[]) {
    this.syncList(list, this.lastMembers, {
      dbId: (m) => this.ids.pessoa.db(m.id),
      fields: (m) => (m.email ? { nome: m.name, papel: PAPEL_OF[m.role], empresa: m.company } : null),
      create: (m) => {
        const tenantId = m.company ? this.companyDb(m.company) : null;
        if (!tenantId) {
          this.saveError.set('Não foi possível salvar no banco: escolha a empresa do membro.');
          return;
        }
        this.send('/data/usuarios', 'POST', { tenantId, nome: m.name, email: m.email, papel: PAPEL_OF[m.role] }, (r) => {
          if (!r?.id) return;
          this.ids.pessoa.link(m.email.trim().toLowerCase(), m.id);
          this.userByPersonTenant.set(`${m.id}|${tenantId}`, r.id);
          this.personByName.set(m.name, m.id);
        });
      },
      update: (m, diff) => {
        const { empresa, ...pessoa } = diff;
        if (Object.keys(pessoa).length) this.send('/data/pessoas', 'PATCH', { email: m.email, ...pessoa });
        // Ligado a outra empresa: dá acesso a ela (a antiga continua)
        const tenantId = typeof empresa === 'string' ? this.companyDb(empresa) : null;
        if (tenantId && !this.userByPersonTenant.has(`${m.id}|${tenantId}`)) {
          this.send('/data/usuarios', 'POST', { tenantId, nome: m.name, email: m.email, papel: PAPEL_OF[m.role] }, (r) => {
            if (r?.id) this.userByPersonTenant.set(`${m.id}|${tenantId}`, r.id);
          });
        }
      },
      remove: (_dbId, m) => m.email && this.send('/data/pessoas/remover', 'POST', { email: m.email }),
    });
  }

  private syncTeams(list: Team[]) {
    this.syncList(list, this.lastTeams, {
      dbId: (t) => this.ids.equipe.db(t.id),
      fields: (t) => {
        const tenantId = this.teamTenant.get(t.id) ?? this.ids.empresa.db(this.companies.currentId());
        if (!tenantId) return null;
        return {
          nome: t.name,
          membros: t.memberIds.map((p) => this.userByPersonTenant.get(`${p}|${tenantId}`)).filter(Boolean),
          projetos: t.projectIds.filter((p) => this.projectTenant.get(p) === tenantId).map((p) => this.ids.projeto.db(p)),
          extra: { focus: t.focus },
        };
      },
      create: (t, fields) => {
        const tenantId = this.ids.empresa.db(this.companies.currentId())!;
        this.teamTenant.set(t.id, tenantId);
        this.send('/data/equipes', 'POST', { ...fields, tenantId }, (r) => r?.id && this.ids.equipe.link(r.id, t.id));
      },
      update: (t, diff) => this.send(() => `/data/equipes/${this.ids.equipe.db(t.id)}`, 'PATCH', diff),
      remove: (dbId) => this.send(`/data/equipes/${dbId}`, 'DELETE', {}),
    });
  }

  private projectTenantOf(p: Project) {
    return this.projectTenant.get(p.id) ?? this.companyDb(p.company) ?? this.ids.empresa.db(this.companies.currentId());
  }

  private syncProjects(list: Project[]) {
    this.syncList(list, this.lastProjects, {
      dbId: (p) => this.ids.projeto.db(p.id),
      fields: (p) => {
        const tenantId = this.projectTenantOf(p);
        if (!tenantId) return null;
        const companyId = this.companies.companies().find((c) => this.ids.empresa.db(c.id) === tenantId)?.id;
        const sector = this.sectors.sectors().find((s) => s.companyId === companyId && s.name.toLowerCase() === p.sector.toLowerCase());
        const team = this.teams.teams().find((t) => t.name === p.team && this.teamTenant.get(t.id) === tenantId);
        return {
          nome: p.name,
          descricao: p.description,
          responsavelId: p.owner ? this.userIn(p.owner, tenantId) : null,
          setorId: this.ids.setor.db(sector?.id),
          equipeId: this.ids.equipe.db(team?.id),
          situacao: projectSituacao(p.status),
          arquivado: p.status === 'archived' || p.status === 'canceled',
          orcamento: Math.round(p.costInitial || 0),
          custoPrevisto: Math.round(p.costDev || 0),
          custoRealizado: Math.round(p.costFinal || 0),
          extra: { status: p.status, requester: p.requester, docs: p.docs },
        };
      },
      create: (p, fields) => {
        const tenantId = this.projectTenantOf(p)!;
        this.projectTenant.set(p.id, tenantId);
        this.send('/data/projetos', 'POST', { ...fields, tenantId }, (r) => r?.id && this.ids.projeto.link(r.id, p.id));
      },
      update: (p, diff) => this.send(() => `/data/projetos/${this.ids.projeto.db(p.id)}`, 'PATCH', diff),
    });
  }

  private syncSprints(sprints: Sprint[]) {
    for (const sprint of sprints) {
      const before = this.lastSprints.get(sprint.id);
      if (before === sprint) continue;
      this.lastSprints.set(sprint.id, sprint);
      const dbId = this.ids.sprint.db(sprint.id);
      if (!dbId && !before) {
        const tenantId = this.ids.empresa.db(sprint.companyId ?? this.companies.currentId());
        if (!tenantId) continue;
        const body = { tenantId, nome: sprint.name, inicio: sprint.start, fim: sprint.end };
        this.send('/data/sprints', 'POST', body, (r) => r?.id && this.ids.sprint.link(r.id, sprint.id));
      } else if (before && before.status !== sprint.status) {
        this.send(() => `/data/sprints/${this.ids.sprint.db(sprint.id)}`, 'PATCH', { situacao: sprintSituacao(sprint.status) });
      }
    }
  }
}
