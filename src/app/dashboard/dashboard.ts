import { NgTemplateOutlet } from '@angular/common';
import { Component, afterNextRender, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AiStore } from '../ai/ai-store';
import { BacklogItem, BacklogStore } from '../backlog/backlog-store';
import { H, PAD, Tip, TipState, lineChart, pieChart, plotH, tipAt, watchChartWidth } from '../charts/charts';
import { ActivityAccess } from '../companies/activity-access';
import { CompanyStore } from '../companies/company-store';
import { SPRINT_COLUMNS, SectorStore, sprintColumnOf } from '../companies/sector-store';
import { SprintStore } from '../planning/sprint-store';
import { BoardToolbar, FilterField, FilterRule } from '../kanban/board-toolbar';
import { HEALTH, ProjectSummary, burnDown, burnUp, cascade, gantt, health, insights, shortDate, weekday } from '../projects/project-metrics';
import { ApiSync } from '../api/api-sync';
import { DailyRefresh, REFRESH_HOUR, serverAnalysis, updatedAt } from './daily-refresh';
import { GanttChart } from './gantt-chart';
import { ProjectTask, SPRINT_DAYS, sprintOf, sprintWindow, today } from '../projects/project-tasks';

const TONES = { good: 'Bom sinal', warn: 'Atenção', bad: 'Risco', info: 'Info' } as const;

// Dashboards das atividades gerais dos setores (as do kanban da sprint de cada setor).
// Mesmas regras do Dash de Projetos (sprints de 7 dias úteis, burn-up, burn-down, Gantt),
// contando atividades em vez de pontos, e a mesma regra de visibilidade do kanban do setor.
@Component({
  imports: [NgTemplateOutlet, RouterLink, BoardToolbar, GanttChart],
  selector: 'app-dashboard',
  templateUrl: './dashboard.html',
  host: { class: 'dashboard project-dash' },
})
export class Dashboard {
  private readonly backlog = inject(BacklogStore);
  private readonly sectorStore = inject(SectorStore);
  private readonly companyStore = inject(CompanyStore);
  private readonly sprintStore = inject(SprintStore);
  private readonly access = inject(ActivityAccess);

  protected readonly now = today();
  protected readonly tones = TONES;
  protected readonly healthInfo = HEALTH;
  protected readonly shortDate = shortDate;
  protected readonly statusColumns = SPRINT_COLUMNS;
  protected readonly restricted = computed(() => !this.access.seesAll());

  // ---------- Filtros (painel "Filtro", igual ao do Work) ----------
  // Sem filtro de empresa vale a do seletor do topo; sem sprint, a ativa. Um valor por campo (o primeiro escolhido).
  protected readonly filters = signal<FilterRule[]>([]);
  private readonly chosen = (key: string) => this.filters().find((r) => r.key === key && r.value)?.value;
  protected readonly companyId = computed(() => Number(this.chosen('empresa') ?? this.companyStore.currentId() ?? 0));
  protected readonly sectorId = computed(() => {
    const id = Number(this.chosen('setor') ?? 0);
    return this.sectorOptions().some((s) => s.id === id) ? id : 0;
  });
  protected readonly sprintId = computed(() => (this.chosen('sprint') ? Number(this.chosen('sprint')) : null));
  protected readonly person = computed(() => this.chosen('pessoa') ?? '');

  protected readonly companies = computed(() =>
    this.companyStore.companies().filter((c) => this.sectorStore.sectors().some((s) => s.companyId === c.id)),
  );
  protected readonly sectorOptions = computed(() =>
    this.sectorStore.sectors().filter((s) => !this.companyId() || s.companyId === this.companyId()),
  );
  protected readonly sprintOptions = computed(() => [...this.sprintStore.sprints()].sort((a, b) => b.start.localeCompare(a.start)));
  protected readonly sprint = computed(
    () => this.sprintStore.byId(this.sprintId() ?? this.sprintStore.active()?.id) ?? this.sprintOptions()[0] ?? null,
  );
  protected readonly sector = computed(() => this.sectorStore.byId(this.sectorId()));

  protected readonly scopeLabel = computed(() => {
    const sector = this.sector();
    if (sector) return `${sector.name} · ${this.companyName(sector.companyId)}`;
    const company = this.companyStore.companies().find((c) => c.id === this.companyId());
    return company ? `todos os setores da ${company.name}` : 'todos os setores';
  });

  protected readonly filterFields = computed<FilterField[]>(() => [
    { key: 'empresa', label: 'Empresa', options: this.companies().map((c) => ({ value: String(c.id), label: c.name })) },
    {
      key: 'setor',
      label: 'Setor',
      options: this.sectorOptions().map((s) => ({ value: String(s.id), label: this.companyId() ? s.name : `${s.name} · ${this.companyName(s.companyId)}` })),
    },
    {
      key: 'sprint',
      label: 'Sprint',
      options: this.sprintOptions().map((sp) => ({
        value: String(sp.id),
        label: `${sp.name} · ${shortDate(sp.start)} – ${shortDate(sp.end)}${sp.status === 'active' ? ' (ativa)' : ''}`,
      })),
    },
    { key: 'pessoa', label: 'Pessoa', options: this.people().map((p) => ({ value: p, label: p })) },
  ]);

  // Recorte padrão (sem filtros): é o que a IA analisa sozinha todo dia às 10h
  protected readonly hasFilters = computed(() => !!(this.chosen('empresa') || this.sectorId() || this.sprintId() || this.person()));

  // ---------- Sprints: nome da Planning ↔ janela de 7 dias úteis ----------
  private readonly activeNumber = computed(() => this.sprintStore.active()?.id ?? Math.max(0, ...this.sprintStore.sprints().map((s) => s.id)));

  protected sprintName = (business: number) => {
    const sprint = this.sprintStore.sprints().find((s) => sprintOf(s.start) === business);
    return sprint?.name ?? `Sprint ${this.activeNumber() + business - sprintOf(this.now)}`; // sprints futuras da projeção
  };

  protected shortSprint = (business: number) => this.sprintName(business).replace('Sprint ', 'S');

  // ---------- Dados: atividades gerais em sprints, já filtradas ----------
  // Empresa e setor (sem o filtro de pessoa: o Gantt escolhe a pessoa dele)
  private readonly scoped = computed(() => {
    const sectors = new Set(this.sectorOptions().map((s) => s.id));
    const one = this.sectorId();
    return this.backlog
      .items()
      .filter((item) => item.sectorId && item.sprintId && item.status !== 'canceled' && this.sprintStore.byId(item.sprintId))
      .filter((item) => (one ? item.sectorId === one : sectors.has(item.sectorId!)))
      .filter((item) => this.access.canSee(item));
  });
  private readonly involves = (item: BacklogItem, person: string) => item.assignee === person || item.sharedWith.includes(person);
  protected readonly activities = computed(() => this.scoped().filter((item) => !this.person() || this.involves(item, this.person())));

  // Pessoas que aparecem nas atividades visíveis (para o filtro)
  protected readonly people = computed(() => {
    const names = new Set<string>();
    for (const item of this.backlog.items()) {
      if (!item.sectorId || !item.sprintId || !this.access.canSee(item)) continue;
      [item.assignee, ...item.sharedWith].filter(Boolean).forEach((n) => names.add(n));
    }
    return [...names].sort();
  });

  // Cada atividade vira uma "tarefa" de 1 ponto: os cálculos do Dash de Projetos valem igual
  private toTask(item: BacklogItem): ProjectTask {
    const n = sprintOf(this.sprintStore.byId(item.sprintId)!.start);
    const window = sprintWindow(n);
    const column = item.sprintStatus;
    return {
      id: item.id,
      projectId: item.sectorId!,
      title: item.name,
      assignee: item.assignee || 'Sem responsável',
      points: 1,
      status: item.doneAt ? 'done' : column === 'review' ? 'review' : column === 'doing' ? 'doing' : 'todo',
      sprint: n,
      start: window.start,
      end: item.due && item.due >= window.start ? item.due : window.end,
      createdAt: item.addedAt ?? window.start,
      doneAt: item.doneAt ?? null,
    };
  }

  protected readonly tasks = computed(() => this.activities().map((item) => this.toTask(item)));
  protected readonly sprintNumber = computed(() => (this.sprint() ? sprintOf(this.sprint()!.start) : sprintOf(this.now)));
  protected readonly inSprint = computed(() => this.activities().filter((item) => item.sprintId === this.sprint()?.id));

  protected readonly bd = computed(() => burnDown(this.tasks(), sprintWindow(this.sprintNumber()), this.now));
  protected readonly bu = computed(() => burnUp(this.tasks(), this.now, this.shortSprint));

  // Resumo por setor (saúde no Gantt geral e nos insights)
  protected readonly sectorSummaries = computed<(ProjectSummary & { id: number; companyId: number })[]>(() => {
    const tasks = this.tasks();
    return this.sectorOptions()
      .map((s) => {
        const mine = tasks.filter((t) => t.projectId === s.id);
        const bu = burnUp(mine, this.now, this.shortSprint);
        return { id: s.id, companyId: s.companyId, name: s.name, bu, health: health(bu), count: mine.length };
      })
      .filter((s) => s.count);
  });

  protected readonly stats = computed(() => {
    const items = this.inSprint();
    return {
      total: items.length,
      done: items.filter((i) => i.doneAt).length,
      doing: items.filter((i) => !i.doneAt && !i.locked && ['doing', 'review'].includes(i.sprintStatus ?? '')).length,
      blocked: items.filter((i) => i.locked).length,
      overdue: items.filter((i) => !i.doneAt && i.due && i.due < this.now).length,
    };
  });

  private readonly liveInsights = computed(() =>
    insights(this.tasks(), this.bd(), this.bu(), this.now, this.sectorId() ? [] : this.sectorSummaries(), {
      unit: 'atividades',
      sprintName: this.sprintName,
      riskLabel: 'Setores em risco',
      scopeGrowth: false,
    }),
  );

  // Carga de trabalho em aberto na sprint: atividade compartilhada conta para cada pessoa
  protected readonly workload = computed(() => {
    const counts = new Map<string, number>();
    for (const item of this.inSprint().filter((i) => !i.doneAt)) {
      for (const name of new Set([item.assignee, ...item.sharedWith].filter(Boolean))) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const sorted = [...counts].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 4).map(([name, value]) => ({ name, value }));
    const rest = sorted.slice(4).reduce((n, [, v]) => n + v, 0);
    const slices = rest ? [...top, { name: 'Outros', value: rest }] : top;
    return slices.length ? pieChart(slices) : [];
  });

  // ---------- Gráficos ----------
  private readonly chartWidth = signal(320);
  protected readonly viewBox = computed(() => `0 0 ${this.chartWidth()} ${H}`);
  protected readonly plot = computed(() => ({ left: PAD.left, right: this.chartWidth() - PAD.right, bottom: PAD.top + plotH, labelY: H - 6 }));

  protected readonly burnDownChart = computed(() => {
    const bd = this.bd();
    const chart = lineChart(bd.labels, bd.series, bd.scale.max, bd.scale.step, this.chartWidth());
    chart.hits.forEach((hit, i) => (hit.tip.heading = `${weekday(bd.sprint.days[i])} ${bd.labels[i]} · dia ${i + 1} de ${SPRINT_DAYS}`));
    return chart;
  });

  protected readonly burnUpChart = computed(() => {
    const bu = this.bu();
    return bu ? lineChart(bu.labels, bu.series, bu.scale.max, bu.scale.step, this.chartWidth()) : null;
  });

  // ---------- Gantt por pessoa: a atividade atrasada empurra as seguintes da mesma pessoa ----------
  private readonly me = computed(() => this.access.viewer()?.name ?? '');
  // Pessoas com atividade na sprint escolhida (para o seletor do Gantt)
  protected readonly ganttPeople = computed(() => {
    const names = new Set<string>();
    for (const item of this.scoped().filter((i) => i.sprintId === this.sprint()?.id)) [item.assignee, ...item.sharedWith].filter(Boolean).forEach((n) => names.add(n));
    return [...names].sort((a, b) => a.localeCompare(b));
  });
  protected readonly ganttPerson = linkedSignal(() => {
    const people = this.ganttPeople();
    const wanted = [this.person(), this.me()].find((p) => p && people.includes(p));
    return wanted ?? people[0] ?? '';
  });

  protected readonly ganttLegend = SPRINT_COLUMNS.map((c) => ({ label: c.label, color: c.color }));

  protected readonly ganttChart = computed(() => {
    const person = this.ganttPerson();
    const items = this.scoped().filter((item) => item.sprintId === this.sprint()?.id && this.involves(item, person));
    const planned = items.map((item) => {
      const task = this.toTask(item);
      return { id: item.id, item, start: task.createdAt, end: task.end, doneAt: task.doneAt };
    });
    const rows = cascade(planned, this.now).map(({ item: p, start, end, pushed, delay }) => {
      const item = p.item;
      const sector = this.sectorStore.byId(item.sectorId!);
      const column = sprintColumnOf(sector?.columns ?? SPRINT_COLUMNS, item);
      const moved = pushed > 0 || end > p.end; // atrasou ou foi empurrada (terminar antes não conta)
      return {
        id: item.id,
        label: item.name,
        detail: [column.label, sector?.name, pushed ? `empurrada +${pushed}d` : ''].filter(Boolean).join(' · '),
        start,
        end,
        progress: item.doneAt ? 1 : 0,
        color: column.color,
        late: !item.doneAt && p.end < this.now,
        chip: column,
        planned: moved ? { start: p.start, end: p.end } : null,
        delay,
      };
    });
    return gantt(rows, this.now);
  });

  constructor() {
    watchChartWidth('.project-dash__charts .dash-card', this.chartWidth);
    afterNextRender(() => this.ai.load());
    // Fotografia do dia: os insights ficam como estavam às 10h (ou na primeira abertura depois disso)
    effect(() => {
      const scope = this.analysisScope();
      if (!this.daily.get(scope)) untracked(() => this.daily.save(scope, { at: new Date().toISOString(), insights: this.liveInsights() }));
    });
  }

  // ---------- Fotografia diária (insights e IA às 10h) ----------
  private readonly daily = new DailyRefresh('setores');
  // A análise das 10h vem do servidor (Cron da Vercel), da empresa escolhida; vale para o recorte sem filtros
  private readonly ids = inject(ApiSync).ids;
  private readonly auto = serverAnalysis('setores', () => this.ids.empresa.db(this.companyId()));
  protected readonly refreshHour = REFRESH_HOUR;
  protected readonly snapshot = computed(() => this.daily.get(this.analysisScope()));
  protected readonly insights = computed(() => this.snapshot()?.insights ?? this.liveInsights());
  protected readonly insightsAt = computed(() => (this.snapshot() ? updatedAt(this.snapshot()!.at) : ''));
  // Na tela: a análise pedida agora ou a guardada do dia para este recorte
  protected readonly shownAnalysis = computed(() => {
    const a = this.analysis();
    if (a && (a.loading || a.scope === this.analysisScope())) return a;
    const auto = this.hasFilters() ? null : this.auto();
    if (auto) return { loading: false, text: auto.texto, error: false, scope: this.analysisScope(), at: auto.criadoEm, auto: true };
    const saved = this.snapshot()?.analysis;
    if (saved) return { loading: false, text: saved.text, error: saved.error, scope: this.analysisScope(), at: saved.at };
    return a;
  });

  // Quantas atividades da sprint estão em cada status (colunas de outros setores contam como "Não iniciado")
  protected inSprintBy(id: string) {
    return this.inSprint().filter((i) => !i.doneAt && sprintColumnOf(SPRINT_COLUMNS, i).id === id).length;
  }

  protected companyName(id: number) {
    return this.companyStore.companies().find((c) => c.id === id)?.name ?? '';
  }

  protected forecastText() {
    const bu = this.bu();
    if (!bu) return '—';
    if (bu.finished) return 'Tudo finalizado';
    return bu.forecastDate ? shortDate(bu.forecastDate) : 'Sem previsão';
  }

  // ---------- Análise pela IA ----------
  private readonly ai = inject(AiStore);
  protected readonly aiReady = computed(() => !!this.ai.assistant());
  protected readonly analysis = signal<{ loading: boolean; text: string; error: boolean; scope: string; at?: string; auto?: boolean } | null>(null);
  protected readonly updatedAt = updatedAt;
  // Identifica os filtros da análise (para avisar quando a análise na tela é de outros filtros)
  protected readonly analysisScope = computed(() => `${this.scopeLabel()} · ${this.sprint()?.name ?? ''}${this.person() ? ' · ' + this.person() : ''}`);

  protected async analyze() {
    const scope = this.analysisScope();
    this.analysis.set({ loading: true, text: '', error: false, scope });
    const bd = this.bd();
    const bu = this.bu();
    const s = this.stats();
    // Só números, nomes de setores, atividades e responsáveis: nada de chaves, e-mails ou tokens.
    // Vai só o que a pessoa pode ver (mesma regra de visibilidade da tela).
    const data = {
      filtro: scope,
      cadencia: 'Scrum, sprints de 7 dias úteis; atividades gerais dos setores contadas uma a uma',
      hoje: this.now,
      sprint: {
        nome: this.sprint()?.name,
        periodo: `${bd.sprint.start} a ${bd.sprint.end}`,
        diaAtual: `${bd.lived} de ${SPRINT_DAYS}`,
        total: s.total,
        finalizadas: s.done,
        emAndamento: s.doing,
        bloqueadas: s.blocked,
        atrasadas: s.overdue,
        comprometidasNoInicio: bd.committed,
        entraramNoMeio: bd.added,
        ritmoPorDia: bd.pace,
        necessarioPorDia: bd.needed,
        previsaoDeSobra: bd.leftover,
      },
      burnUp: bu && {
        finalizadasPorSprint: bu.deltas,
        velocidadeMedia: bu.velocity,
        previsaoTermino: bu.forecast ? `${this.sprintName(bu.forecast)} (${bu.forecastDate})` : 'sem previsão',
      },
      setores: this.sectorId()
        ? undefined
        : this.sectorSummaries().map((x) => ({ setor: `${x.name} · ${this.companyName(x.companyId)}`, saude: HEALTH[x.health].label, velocidade: x.bu?.velocity ?? 0 })),
      bloqueadas: this.inSprint().filter((i) => i.locked).map((i) => ({ atividade: i.name, responsavel: i.assignee })),
      atrasadas: this.inSprint()
        .filter((i) => !i.doneAt && i.due && i.due < this.now)
        .map((i) => ({ atividade: i.name, responsavel: i.assignee, prazo: i.due })),
      cargaEmAbertoPorPessoa: Object.fromEntries(this.workload().map((slice) => [slice.name, slice.value])),
      insightsDoDashboard: this.liveInsights().map((i) => i.text),
    };
    const prompt = `Você é um gestor experiente de times que trabalham com Scrum. Analise os dados do painel de atividades gerais dos setores abaixo (${scope}).
Responda em português, em texto simples (sem tabelas), com:
1. Diagnóstico em 2 ou 3 frases (andamento da sprint e previsibilidade).
2. Principais riscos (bloqueios, atrasos, sobrecarga de pessoas, mudanças de escopo no meio da sprint).
3. Até 5 ações de melhoria concretas, dizendo o que fazer e quem deve agir.

Dados:
${JSON.stringify(data, null, 2)}`;
    try {
      const reply = await this.ai.chat([{ role: 'user', content: prompt }], 'Dashboards (/dashboards)');
      const at = new Date().toISOString();
      const text = reply || '(a IA não respondeu nada)';
      this.analysis.set({ loading: false, text, error: false, scope, at });
      // Vira a análise do dia deste recorte (e os insights são atualizados junto)
      this.daily.save(scope, { at, insights: this.liveInsights(), analysis: { text, error: false, at } });
    } catch (error) {
      this.analysis.set({ loading: false, text: error instanceof Error ? error.message : 'Não foi possível falar com a IA.', error: true, scope });
    }
  }

  // ---------- Dica do hover ----------
  protected readonly tip = signal<TipState | null>(null);

  protected showTip(event: Event, data: Tip) {
    this.tip.set(tipAt(event, data));
  }

  protected hideTip() {
    this.tip.set(null);
  }
}
