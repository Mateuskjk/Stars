import { NgTemplateOutlet } from '@angular/common';
import { Component, afterNextRender, computed, inject, linkedSignal, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AiStore } from '../ai/ai-store';
import { BacklogItem, BacklogStore } from '../backlog/backlog-store';
import { H, PAD, Tip, TipState, lineChart, pieChart, plotH, tipAt, watchChartWidth } from '../charts/charts';
import { ActivityAccess } from '../companies/activity-access';
import { CompanyStore } from '../companies/company-store';
import { SPRINT_COLUMNS, SectorStore, sprintColumnOf } from '../companies/sector-store';
import { RecentsStore } from '../home/recents-store';
import { SprintStore } from '../planning/sprint-store';
import { GanttItem, HEALTH, ProjectSummary, burnDown, burnUp, gantt, health, insights, shortDate, weekday } from '../projects/project-metrics';
import { ProjectTask, SPRINT_DAYS, sprintOf, sprintWindow, today } from '../projects/project-tasks';

const TONES = { good: 'Bom sinal', warn: 'Atenção', bad: 'Risco', info: 'Info' } as const;

// Dashboards das atividades gerais dos setores (as do kanban da sprint de cada setor).
// Mesmas regras do Dash de Projetos (sprints de 7 dias úteis, burn-up, burn-down, Gantt),
// contando atividades em vez de pontos, e a mesma regra de visibilidade do kanban do setor.
@Component({
  imports: [NgTemplateOutlet, RouterLink],
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

  // ---------- Filtros ----------
  protected readonly companyId = linkedSignal(() => this.companyStore.currentId() ?? 0); // começa na empresa do seletor; 0 = todas
  protected readonly sectorId = signal(0); // 0 = todos
  protected readonly sprintId = signal<number | null>(null); // null = sprint ativa
  protected readonly person = signal(''); // '' = todas

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

  protected selectCompany(value: string) {
    this.companyId.set(Number(value));
    if (this.sector() && this.sector()!.companyId !== Number(value)) this.sectorId.set(0);
  }

  protected clearFilters() {
    this.companyId.set(0);
    this.sectorId.set(0);
    this.sprintId.set(null);
    this.person.set('');
  }

  protected readonly hasFilters = computed(() => !!(this.companyId() || this.sectorId() || this.sprintId() || this.person()));

  // ---------- Sprints: nome da Planning ↔ janela de 7 dias úteis ----------
  private readonly activeNumber = computed(() => this.sprintStore.active()?.id ?? Math.max(0, ...this.sprintStore.sprints().map((s) => s.id)));

  protected sprintName = (business: number) => {
    const sprint = this.sprintStore.sprints().find((s) => sprintOf(s.start) === business);
    return sprint?.name ?? `Sprint ${this.activeNumber() + business - sprintOf(this.now)}`; // sprints futuras da projeção
  };

  protected shortSprint = (business: number) => this.sprintName(business).replace('Sprint ', 'S');

  // ---------- Dados: atividades gerais em sprints, já filtradas ----------
  protected readonly activities = computed(() => {
    const sectors = new Set(this.sectorOptions().map((s) => s.id));
    const one = this.sectorId();
    const person = this.person();
    return this.backlog
      .items()
      .filter((item) => item.sectorId && item.sprintId && item.status !== 'canceled' && this.sprintStore.byId(item.sprintId))
      .filter((item) => (one ? item.sectorId === one : sectors.has(item.sectorId!)))
      .filter((item) => !person || item.assignee === person || item.sharedWith.includes(person))
      .filter((item) => this.access.canSee(item));
  });

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

  protected readonly insights = computed(() =>
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

  protected readonly ganttChart = computed(() => {
    let items: GanttItem[];
    const sector = this.sector();
    if (sector) {
      // Um setor: uma barra por atividade da sprint escolhida, na cor do status no kanban
      items = this.inSprint()
        .map((item) => ({ item, task: this.toTask(item), column: sprintColumnOf(sector.columns, item) }))
        .sort((a, b) => a.task.createdAt.localeCompare(b.task.createdAt) || a.item.id - b.item.id)
        .map(({ item, task, column }) => ({
          id: item.id,
          label: item.name,
          detail: [item.assignee, ...item.sharedWith].filter(Boolean).join(' ⇄ ') || 'Sem responsável',
          start: task.createdAt,
          end: task.end,
          progress: item.doneAt ? 1 : 0,
          color: column.color,
          late: !item.doneAt && task.end < this.now,
          chip: column,
        }));
    } else {
      // Geral: uma barra por setor, com o progresso e a previsão de término (◆)
      const tasks = this.tasks();
      items = this.sectorSummaries().map((s) => {
        const mine = tasks.filter((t) => t.projectId === s.id);
        const done = mine.filter((t) => t.status === 'done').length;
        return {
          id: s.id,
          label: `${s.name} · ${this.companyName(s.companyId)}`,
          detail: `${done} de ${mine.length} finalizadas`,
          start: mine.map((t) => t.createdAt).sort()[0],
          end: mine.map((t) => t.end).sort().at(-1)!,
          progress: mine.length ? done / mine.length : 0,
          color: HEALTH[s.health].color,
          late: s.health === 'late' || s.health === 'stalled',
          chip: HEALTH[s.health],
          forecast: s.bu && !s.bu.finished ? s.bu.forecastDate : null,
        };
      });
    }
    return gantt(items, this.now);
  });

  constructor() {
    watchChartWidth('.project-dash__charts .dash-card', this.chartWidth);
    const recents = inject(RecentsStore);
    afterNextRender(() => {
      this.ai.load();
      recents.visit('dashboard', 'dashboards');
    });
  }

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
  protected readonly analysis = signal<{ loading: boolean; text: string; error: boolean; scope: string } | null>(null);
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
      insightsDoDashboard: this.insights().map((i) => i.text),
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
      this.analysis.set({ loading: false, text: reply || '(a IA não respondeu nada)', error: false, scope });
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
