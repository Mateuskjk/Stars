import { NgTemplateOutlet } from '@angular/common';
import { Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AiStore } from '../ai/ai-store';
import { RecentsStore } from '../home/recents-store';
import { H, PAD, Tip, TipState, lineChart, plotH, tipAt, watchChartWidth } from '../charts/charts';
import { BurnUp, GanttItem, HEALTH, ProjectSummary, burnDown, burnUp, gantt, health, insights, shortDate, weekday } from './project-metrics';
import { ProjectStore } from './project-store';
import { SPRINT_DAYS, ProjectTaskStore, sprintOf, sprintWindow, today } from './project-tasks';

const TONES = { good: 'Bom sinal', warn: 'Atenção', bad: 'Risco', info: 'Info' } as const;

@Component({
  imports: [RouterLink, NgTemplateOutlet],
  selector: 'app-project-dashboard',
  templateUrl: './project-dashboard.html',
  host: { class: 'dashboard project-dash' },
})
export class ProjectDashboard {
  private readonly projectStore = inject(ProjectStore);
  private readonly taskStore = inject(ProjectTaskStore);
  private readonly ai = inject(AiStore);

  protected readonly now = today();
  protected readonly currentSprint = sprintOf(this.now);
  protected readonly todayInSprint = sprintWindow(this.currentSprint).days.filter((day) => day <= this.now).length;
  protected readonly projects = this.projectStore.projects;
  protected readonly taskStatuses = this.taskStore.columns;
  protected readonly healthInfo = HEALTH;
  protected readonly tones = TONES;
  protected readonly shortDate = shortDate;

  // ---------- Filtros ----------
  protected readonly projectId = signal(0); // 0 = todos os projetos
  protected readonly sprintNumber = signal<number | null>(null); // null = sprint atual

  protected readonly project = computed(() => this.projects().find((p) => p.id === this.projectId()) ?? null);
  protected readonly tasks = computed(() => {
    const id = this.projectId();
    return this.taskStore.tasks().filter((task) => !id || task.projectId === id);
  });

  // Sprints com atividades (para o seletor do burn-down), mais recentes primeiro
  protected readonly sprintOptions = computed(() => {
    const numbers = new Set(this.tasks().map((task) => task.sprint));
    numbers.add(this.currentSprint);
    return [...numbers].sort((a, b) => b - a).map((n) => ({ number: n, label: `Sprint ${n} · ${shortDate(sprintWindow(n).start)} – ${shortDate(sprintWindow(n).end)}` }));
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

  protected readonly insights = computed(() =>
    insights(this.tasks(), this.bd(), this.bu(), this.now, this.projectId() ? [] : this.active()),
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

  protected readonly ganttChart = computed(() => {
    const id = this.projectId();
    let items: GanttItem[];
    if (id) {
      // Um projeto: uma barra por atividade, na cor da situação
      items = [...this.tasks()]
        .sort((a, b) => a.start.localeCompare(b.start) || a.id - b.id)
        .map((task) => ({
          id: task.id,
          label: task.title,
          detail: `${task.assignee} · ${task.points} pts · Sprint ${task.sprint}`,
          start: task.start,
          end: task.end,
          progress: task.status === 'done' ? 1 : 0,
          color: this.taskStore.column(task.status).color,
          late: task.status !== 'done' && task.end < this.now,
          chip: this.taskStore.column(task.status),
        }));
    } else {
      // Geral: uma barra por projeto, com o progresso preenchido e a previsão de término (◆)
      items = this.summaries()
        .filter((s) => s.points)
        .map((s) => {
          const tasks = this.taskStore.tasks().filter((t) => t.projectId === s.id);
          const end = tasks.map((t) => t.end).sort().at(-1)!;
          return {
            id: s.id,
            label: s.name,
            detail: `${Math.round(s.progress * 100)}% · ${s.points} pts`,
            start: tasks.map((t) => t.start).sort()[0],
            end,
            progress: s.progress,
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
      recents.visit('dashboard', 'projects');
    });
    // Vindo da página do projeto: /projetos?projeto=ID já abre filtrado
    const id = Number(inject(ActivatedRoute).snapshot.queryParamMap.get('projeto'));
    if (id) this.projectId.set(id);
  }

  protected selectProject(value: string) {
    this.projectId.set(Number(value));
    this.analysis.set(null);
  }

  protected selectSprint(value: string) {
    this.sprintNumber.set(Number(value) === this.currentSprint ? null : Number(value));
  }

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
  protected readonly analysis = signal<{ loading: boolean; text: string; error: boolean; scope: string } | null>(null);

  protected async analyze() {
    const scope = this.project()?.name ?? 'Todos os projetos';
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
        terminoPlanejado: `Sprint ${bu.plannedEnd} (${bu.plannedDate})`,
        previsaoTermino: bu.forecast ? `Sprint ${bu.forecast} (${bu.forecastDate})` : 'sem previsão',
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
      insightsDoDashboard: this.insights().map((i) => i.text),
    };
    const prompt = `Você é um gestor de projetos ágeis experiente. Analise os dados do Dash de Projetos abaixo (${scope}).
Responda em português, em texto simples (sem tabelas), com:
1. Diagnóstico em 2 ou 3 frases (andamento e previsibilidade).
2. Principais riscos.
3. Até 5 ações de melhoria concretas, dizendo o que fazer e quem deve agir.

Dados:
${JSON.stringify(data, null, 2)}`;
    try {
      const reply = await this.ai.chat([{ role: 'user', content: prompt }], 'Dash de Projetos (/projetos)');
      this.analysis.set({ loading: false, text: reply || '(a IA não respondeu nada)', error: false, scope });
    } catch (error) {
      this.analysis.set({ loading: false, text: error instanceof Error ? error.message : 'Não foi possível falar com a IA.', error: true, scope });
    }
  }
}
