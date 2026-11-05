import { SprintStore } from '../planning/sprint-store';
import { NgTemplateOutlet } from '@angular/common';
import { Component, afterNextRender, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AiStore } from '../ai/ai-store';
import { H, PAD, Tip, TipState, lineChart, plotH, tipAt, watchChartWidth } from '../charts/charts';
import { BurnUp, HEALTH, ProjectSummary, burnDown, burnUp, cascade, gantt, health, insights, shortDate, weekday } from './project-metrics';
import { BoardToolbar, FilterField, FilterRule } from '../kanban/board-toolbar';
import { DailyRefresh, REFRESH_HOUR, serverAnalysis, updatedAt } from '../dashboard/daily-refresh';
import { ApiSync } from '../api/api-sync';
import { CompanyStore } from '../companies/company-store';
import { GanttChart } from '../dashboard/gantt-chart';
import { ProjectStore } from './project-store';
import { SPRINT_DAYS, ProjectTaskStore, sprintOf, sprintWindow, today } from './project-tasks';

const TONES = { good: 'Bom sinal', warn: 'Atenção', bad: 'Risco', info: 'Info' } as const;

@Component({
  imports: [RouterLink, NgTemplateOutlet, BoardToolbar, GanttChart],
  selector: 'app-project-dashboard',
  templateUrl: './project-dashboard.html',
  host: { class: 'dashboard project-dash' },
})
export class ProjectDashboard {
  private readonly projectStore = inject(ProjectStore);
  private readonly taskStore = inject(ProjectTaskStore);
  protected readonly sprintName = (n: number) => this.sprintStore.nameOf(n); // nome da sprint da Planning
  private readonly sprintStore = inject(SprintStore);
  private readonly ai = inject(AiStore);

  protected readonly now = today();
  protected readonly currentSprint = sprintOf(this.now);
  protected readonly projects = this.projectStore.visible; // só empresas ativas
  protected readonly taskStatuses = this.taskStore.columns;
  protected readonly healthInfo = HEALTH;
  protected readonly tones = TONES;
  protected readonly shortDate = shortDate;

  // ---------- Filtros (painel "Filtro", igual ao do Work) ----------
  protected readonly filters = signal<FilterRule[]>([]);
  private readonly chosen = (key: string) => this.filters().find((r) => r.key === key && r.value)?.value;
  protected readonly projectId = computed(() => Number(this.chosen('projeto') ?? 0)); // 0 = todos os projetos
  protected readonly sprintNumber = computed(() => (this.chosen('sprint') ? Number(this.chosen('sprint')) : null)); // null = sprint atual
  protected readonly filterFields = computed<FilterField[]>(() => [
    { key: 'projeto', label: 'Projeto', options: this.projects().map((p) => ({ value: String(p.id), label: p.name })) },
    {
      key: 'sprint',
      label: 'Sprint (burn-down)',
      options: this.sprintOptions().map((o) => ({ value: String(o.number), label: o.label + (o.number === this.currentSprint ? ' (atual)' : '') })),
    },
  ]);

  protected readonly project = computed(() => this.projects().find((p) => p.id === this.projectId()) ?? null);
  // Um projeto: as atividades dele e dos agregados. Todos: só projetos visíveis (empresas ativas)
  protected readonly tasks = computed(() => {
    const id = this.projectId();
    const ids = new Set(id ? [id, ...this.projectStore.childrenOf(id).map((c) => c.id)] : this.projects().map((p) => p.id));
    return this.taskStore.tasks().filter((task) => ids.has(task.projectId));
  });

  // Sprints com atividades (para o seletor do burn-down), mais recentes primeiro
  protected readonly sprintOptions = computed(() => {
    const numbers = new Set(this.tasks().map((task) => task.sprint));
    numbers.add(this.currentSprint);
    return [...numbers].sort((a, b) => b - a).map((n) => ({ number: n, label: `${this.sprintName(n)} · ${shortDate(sprintWindow(n).start)} – ${shortDate(sprintWindow(n).end)}` }));
  });

  protected readonly sprint = computed(() => sprintWindow(this.sprintNumber() ?? this.currentSprint));

  // ---------- Métricas ----------
  protected readonly bd = computed(() => burnDown(this.tasks(), this.sprint(), this.now));
  protected readonly bu = computed(() => burnUp(this.tasks(), this.now));

  protected readonly summaries = computed<(ProjectSummary & { id: number; progress: number; points: number })[]>(() =>
    this.projects().map((project) => {
      const tasks = this.taskStore.tasks().filter((task) => task.projectId === project.id);
      const bu = burnUp(tasks, this.now);
      const points = tasks.reduce((n, t) => n + t.points, 0);
      const done = tasks.filter((t) => t.status === 'done').reduce((n, t) => n + t.points, 0);
      return { id: project.id, name: project.name, bu, health: health(bu), points, progress: points ? done / points : 0 };
    }),
  );

  // Projetos com atividades (os que entram no Gantt e no resumo geral)
  protected readonly active = computed(() => this.summaries().filter((s) => s.points));
  protected readonly atRisk = computed(() => this.active().filter((s) => ['late', 'stalled'].includes(s.health)).length);

  protected readonly stats = computed(() => {
    const tasks = this.tasks();
    const points = tasks.reduce((n, t) => n + t.points, 0);
    const done = tasks.filter((t) => t.status === 'done').reduce((n, t) => n + t.points, 0);
    const bu = this.bu();
    const last = bu?.deltas.at(-1);
    return {
      progress: points ? Math.round((done / points) * 100) : 0,
      done,
      points,
      velocity: bu?.velocity ?? 0,
      lastVelocity: last ?? null,
      overdue: tasks.filter((t) => t.status !== 'done' && t.end < this.now).length,
      open: tasks.filter((t) => t.status !== 'done').length,
      health: health(bu),
    };
  });

  private readonly liveInsights = computed(() =>
    insights(this.tasks(), this.bd(), this.bu(), this.now, this.projectId() ? [] : this.active(), { sprintName: this.sprintName }),
  );

  // ---------- Gráficos ----------
  private readonly chartWidth = signal(320);
  protected readonly viewBox = computed(() => `0 0 ${this.chartWidth()} ${H}`);
  protected readonly plot = computed(() => ({ left: PAD.left, right: this.chartWidth() - PAD.right, bottom: PAD.top + plotH, labelY: H - 6 }));

  protected readonly burnDownChart = computed(() => {
    const bd = this.bd();
    const chart = lineChart(bd.labels, bd.series, bd.scale.max, bd.scale.step, this.chartWidth());
    // Dica com o dia da semana: "qua 08/10 · dia 3 de 7"
    chart.hits.forEach((hit, i) => (hit.tip.heading = `${weekday(bd.sprint.days[i])} ${bd.labels[i]} · dia ${i + 1} de ${SPRINT_DAYS}`));
    return chart;
  });

  protected readonly burnUpChart = computed(() => {
    const bu = this.bu();
    return bu ? lineChart(bu.labels, bu.series, bu.scale.max, bu.scale.step, this.chartWidth()) : null;
  });

  // ---------- Gantt por projeto: a atividade atrasada empurra as seguintes do projeto ----------
  protected readonly ganttProjects = computed(() => this.active().map((s) => ({ id: s.id, name: s.name })));
  protected readonly ganttProjectId = linkedSignal(() => this.projectId() || this.ganttProjects()[0]?.id || 0);
  protected readonly ganttProject = computed(() => this.projects().find((p) => p.id === this.ganttProjectId()) ?? null);
  protected readonly ganttLegend = computed(() => this.taskStatuses().map((s) => ({ label: s.label, color: s.color })));

  protected readonly ganttChart = computed(() => {
    const id = this.ganttProjectId();
    if (!id) return null;
    const ids = new Set([id, ...this.projectStore.childrenOf(id).map((c) => c.id)]);
    const tasks = this.taskStore.tasks().filter((t) => ids.has(t.projectId));
    const planned = tasks.map((task) => ({ id: task.id, task, start: task.start, end: task.end, doneAt: task.status === 'done' ? (task.doneAt ?? task.end) : null }));
    const rows = cascade(planned, this.now).map(({ item: p, start, end, pushed, delay }) => {
      const task = p.task;
      const moved = pushed > 0 || end > p.end; // atrasou ou foi empurrada (terminar antes não conta)
      return {
        id: task.id,
        label: task.title,
        detail: [task.assignee, `${task.points} pts`, this.sprintName(task.sprint), pushed ? `empurrada +${pushed}d` : ''].filter(Boolean).join(' · '),
        start,
        end,
        progress: task.status === 'done' ? 1 : 0,
        color: this.taskStore.column(task.status).color,
        late: task.status !== 'done' && task.end < this.now,
        chip: this.taskStore.column(task.status),
        planned: moved ? { start: p.start, end: p.end } : null,
        delay,
      };
    });
    return gantt(rows, this.now);
  });

  constructor() {
    watchChartWidth('.project-dash__charts .dash-card', this.chartWidth);
    afterNextRender(() => this.ai.load());
    // Vindo da página do projeto: /projetos?projeto=ID já abre filtrado
    const id = Number(inject(ActivatedRoute).snapshot.queryParamMap.get('projeto'));
    if (id) this.filters.set([{ key: 'projeto', value: String(id) }]);
    // Fotografia do dia: os insights ficam como estavam às 10h (ou na primeira abertura depois disso)
    effect(() => {
      const scope = this.scope();
      if (!this.daily.get(scope)) untracked(() => this.daily.save(scope, { at: new Date().toISOString(), insights: this.liveInsights() }));
    });
  }

  // ---------- Fotografia diária (insights e IA às 10h) ----------
  private readonly daily = new DailyRefresh('projetos');
  // A análise das 10h vem do servidor (Cron da Vercel): a dos projetos da empresa escolhida no topo do menu
  private readonly ids = inject(ApiSync).ids;
  private readonly companyStore = inject(CompanyStore);
  private readonly auto = serverAnalysis('projetos', () => this.ids.empresa.db(this.companyStore.currentId()));
  protected readonly autoCompany = computed(() => this.companyStore.current()?.name ?? '');
  protected readonly refreshHour = REFRESH_HOUR;
  protected readonly updatedAt = updatedAt;
  protected readonly scope = computed(() => `${this.project()?.name ?? 'Todos os projetos'} · ${this.sprintName(this.sprint().number)}`);
  protected readonly snapshot = computed(() => this.daily.get(this.scope()));
  protected readonly insights = computed(() => this.snapshot()?.insights ?? this.liveInsights());
  protected readonly insightsAt = computed(() => (this.snapshot() ? updatedAt(this.snapshot()!.at) : ''));
  protected readonly shownAnalysis = computed(() => {
    const a = this.analysis();
    if (a && (a.loading || a.scope === this.scope())) return a;
    const auto = this.projectId() || this.sprintNumber() !== null ? null : this.auto();
    if (auto) return { loading: false, text: auto.texto, error: false, scope: this.scope(), at: auto.criadoEm as string | undefined, auto: true };
    const saved = this.snapshot()?.analysis;
    return saved ? { loading: false, text: saved.text, error: saved.error, scope: this.scope(), at: saved.at as string | undefined, auto: false } : null;
  });

  protected forecastText(bu: BurnUp | null) {
    if (!bu) return '—';
    if (bu.finished) return `Entregue na S${bu.forecast}`;
    return bu.forecastDate ? shortDate(bu.forecastDate) : 'Sem previsão';
  }

  // ---------- Dica do hover ----------
  protected readonly tip = signal<TipState | null>(null);

  protected showTip(event: Event, data: Tip) {
    this.tip.set(tipAt(event, data));
  }

  protected hideTip() {
    this.tip.set(null);
  }

  // ---------- Análise pela IA ----------
  protected readonly aiReady = computed(() => !!this.ai.assistant());
  protected readonly analysis = signal<{ loading: boolean; text: string; error: boolean; scope: string; at?: string; auto?: boolean } | null>(null);

  protected async analyze() {
    const scope = this.scope();
    this.analysis.set({ loading: true, text: '', error: false, scope });
    const bd = this.bd();
    const bu = this.bu();
    // Só números e nomes de atividades: nada de chaves, e-mails ou tokens
    const data = {
      filtro: scope,
      cadencia: 'Scrum, sprints de 7 dias úteis',
      hoje: this.now,
      sprint: {
        numero: bd.sprint.number,
        periodo: `${bd.sprint.start} a ${bd.sprint.end}`,
        diaAtual: `${bd.lived} de ${SPRINT_DAYS}`,
        comprometidoNoInicio: bd.committed,
        entrouNoMeio: bd.added,
        concluido: bd.done,
        restante: bd.left,
        ritmoPtsDia: bd.pace,
        necessarioPtsDia: bd.needed,
        previsaoDeSobra: bd.leftover,
      },
      burnUp: bu && {
        escopoInicial: bu.initial,
        escopoAtual: bu.total,
        concluido: bu.doneNow,
        velocidadeUltimasSprints: bu.deltas,
        velocidadeMedia: bu.velocity,
        terminoPlanejado: `${this.sprintName(bu.plannedEnd)} (${bu.plannedDate})`,
        previsaoTermino: bu.forecast ? `${this.sprintName(bu.forecast)} (${bu.forecastDate})` : 'sem previsão',
      },
      projetos: this.projectId()
        ? undefined
        : this.summaries()
            .filter((s) => s.points)
            .map((s) => ({ nome: s.name, saude: HEALTH[s.health].label, progresso: `${Math.round(s.progress * 100)}%`, previsao: this.forecastText(s.bu) })),
      atividadesAtrasadas: this.tasks()
        .filter((t) => t.status !== 'done' && t.end < this.now)
        .map((t) => ({ atividade: t.title, responsavel: t.assignee, prazo: t.end, pontos: t.points })),
      emAbertoNaSprintPorPessoa: Object.fromEntries(
        Object.entries(
          this.tasks()
            .filter((t) => t.sprint === this.currentSprint && t.status !== 'done')
            .reduce<Record<string, number>>((acc, t) => ({ ...acc, [t.assignee]: (acc[t.assignee] ?? 0) + t.points }), {}),
        ),
      ),
      insightsDoDashboard: this.liveInsights().map((i) => i.text),
    };
    const prompt = `Você é um gestor de projetos ágeis experiente. Analise os dados dos projetos abaixo (${scope}).
Responda em português, em texto simples (sem tabelas), com:
1. Diagnóstico em 2 ou 3 frases (andamento e previsibilidade).
2. Principais riscos.
3. Até 5 ações de melhoria concretas, dizendo o que fazer e quem deve agir.

Dados:
${JSON.stringify(data, null, 2)}`;
    try {
      const reply = await this.ai.chat([{ role: 'user', content: prompt }], 'Dashboards › Projetos (/dashboards?aba=projetos)');
      const at = new Date().toISOString();
      const text = reply || '(a IA não respondeu nada)';
      this.analysis.set({ loading: false, text, error: false, scope, at });
      // Vira a análise do dia deste recorte (e os insights são atualizados junto)
      this.daily.save(scope, { at, insights: this.liveInsights(), analysis: { text, error: false, at } });
    } catch (error) {
      this.analysis.set({ loading: false, text: error instanceof Error ? error.message : 'Não foi possível falar com a IA.', error: true, scope });
    }
  }
}
