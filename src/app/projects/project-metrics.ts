import { LineSeries, MUTED, SERIES, Tip } from '../charts/charts';
import { ProjectTask, SPRINT_DAYS, SprintWindow, TASK_STATUSES, businessIndex, parseDay, sprintOf, sprintWindow } from './project-tasks';

// Cálculos do Dash de Projetos. Funções puras: recebem as atividades (já filtradas) e o dia de hoje.

const sum = (tasks: ProjectTask[]) => tasks.reduce((total, task) => total + task.points, 0);
const round1 = (value: number) => Math.round(value * 10) / 10;
const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

export const shortDate = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const weekday = (day: string) => WEEKDAYS[parseDay(day).getDay()];

// Eixo Y com no máximo 5 divisões "redondas"
export function niceScale(value: number) {
  for (const step of [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000]) {
    if (Math.ceil(value / step) <= 5) return { max: Math.max(step, Math.ceil(value / step) * step), step };
  }
  return { max: Math.ceil(value / 10000) * 10000, step: 10000 };
}

// ---------- Burn-down: pontos que faltam na sprint, dia a dia, contra a linha ideal ----------

export function burnDown(tasks: ProjectTask[], sprint: SprintWindow, now: string) {
  const list = tasks.filter((task) => task.sprint === sprint.number);
  const scopeAt = (day: string) => sum(list.filter((task) => task.createdAt <= day));
  const doneBy = (day: string) => sum(list.filter((task) => task.doneAt !== null && task.doneAt <= day));

  const committed = sum(list.filter((task) => task.createdAt <= sprint.start)); // compromisso do início da sprint
  const lived = sprint.days.filter((day) => day <= now).length; // dias úteis já vividos (0 a 7)
  const lastDay = sprint.days[lived - 1];
  const scope = lived ? scopeAt(lastDay) : sum(list);
  const done = lived ? doneBy(lastDay) : 0;
  const left = scope - done;
  const daysLeft = SPRINT_DAYS - lived;
  const pace = lived ? round1(done / lived) : 0; // pontos por dia útil
  const needed = daysLeft ? round1(left / daysLeft) : left;

  const ideal = sprint.days.map((_, i) => round1(committed * (1 - i / (SPRINT_DAYS - 1))));
  const remaining = sprint.days.map((day, i) => (i < lived ? scopeAt(day) - doneBy(day) : null));
  const series: LineSeries[] = [
    { name: 'Ideal', color: MUTED, values: ideal, dashed: true },
    { name: 'Restante', color: SERIES[0], values: remaining },
  ];

  return {
    sprint,
    labels: sprint.days.map(shortDate),
    series,
    scale: niceScale(Math.max(committed, scope, 1)),
    committed,
    added: scope - committed, // pontos que entraram com a sprint em andamento
    scope,
    done,
    left,
    lived,
    daysLeft,
    pace,
    needed,
    leftover: Math.max(0, Math.round(left - pace * daysLeft)), // previsão do que sobra no fim, no ritmo atual
  };
}

export type BurnDown = ReturnType<typeof burnDown>;

// ---------- Burn-up: escopo × concluído por sprint, com plano e projeção de término ----------

export function burnUp(tasks: ProjectTask[], now: string, label: (sprint: number) => string = (n) => `S${n}`) {
  if (!tasks.length) return null;
  const current = sprintOf(now);
  const first = Math.min(...tasks.map((task) => Math.min(task.sprint, sprintOf(task.createdAt))));
  const plannedEnd = Math.max(...tasks.map((task) => sprintOf(task.end)));
  const cutoff = (n: number) => (n < current ? sprintWindow(n).end : now);
  const scopeAt = (n: number) => sum(tasks.filter((task) => task.createdAt <= cutoff(n)));
  const doneBy = (n: number) => sum(tasks.filter((task) => task.doneAt !== null && task.doneAt <= cutoff(n)));

  const total = scopeAt(current); // escopo conhecido hoje
  const initial = sum(tasks.filter((task) => task.createdAt <= sprintWindow(first).start));
  const doneNow = doneBy(current);
  const finished = total > 0 && doneNow >= total;

  // Velocidade: média do que foi entregue nas últimas 3 sprints fechadas
  const closed = range(Math.max(first, current - 3), current - 1);
  const deltas = closed.map((n) => doneBy(n) - doneBy(n - 1));
  const velocity = deltas.length ? round1(deltas.reduce((a, b) => a + b, 0) / deltas.length) : 0;
  const stalled = !finished && deltas.length > 0 && deltas.at(-1) === 0 && doneNow === doneBy(current - 1);

  // Previsão: a sprint atual termina no ritmo médio e as próximas seguem a mesma velocidade
  let forecast: number | null = null;
  const endOfCurrent = Math.max(doneNow, doneBy(current - 1) + velocity);
  if (finished) {
    forecast = sprintOf(tasks.map((task) => task.doneAt!).sort().at(-1)!);
  } else if (velocity > 0 && !stalled) {
    const needed = Math.max(0, Math.ceil((total - endOfCurrent) / velocity - 1e-9));
    if (needed <= 24) forecast = current + needed;
  }

  const realEnd = finished ? forecast! : current;
  const last = Math.min(Math.max(realEnd, plannedEnd, forecast ?? 0), current + 24);
  const numbers = range(first, last);
  const projection = (n: number) => (n === current ? doneNow : Math.min(total, round1(endOfCurrent + (n - current) * velocity)));

  const series: LineSeries[] = [
    { name: 'Escopo', color: SERIES[1], values: numbers.map((n) => (n <= realEnd ? scopeAt(n) : total)) },
    { name: 'Concluído', color: SERIES[0], values: numbers.map((n) => (n <= realEnd ? doneBy(n) : null)) },
    {
      name: 'Planejado',
      color: MUTED,
      dashed: true,
      values: numbers.map((n) => (n <= plannedEnd ? round1((total * (n - first + 1)) / (plannedEnd - first + 1)) : null)),
    },
  ];
  if (!finished && forecast !== null) {
    series.push({ name: 'Projeção', color: SERIES[2], dashed: true, values: numbers.map((n) => (n >= current && n <= forecast! ? projection(n) : null)) });
  }

  return {
    labels: numbers.map(label),
    series,
    scale: niceScale(Math.max(total, 1)),
    current,
    total,
    initial,
    doneNow,
    finished,
    stalled,
    velocity,
    deltas,
    plannedEnd,
    plannedDate: sprintWindow(plannedEnd).end,
    forecast,
    forecastDate: forecast === null ? null : sprintWindow(forecast).end,
    delay: forecast === null ? null : forecast - plannedEnd, // em sprints
    scopeGrowth: initial ? Math.round(((total - initial) / initial) * 100) : 0,
  };
}

export type BurnUp = NonNullable<ReturnType<typeof burnUp>>;

// ---------- Saúde do projeto ----------

export type Health = 'done' | 'on-track' | 'attention' | 'late' | 'stalled' | 'unknown';

export const HEALTH: Record<Health, { label: string; color: string }> = {
  done: { label: 'Concluído', color: '#0ca30c' },
  'on-track': { label: 'No prazo', color: '#2a78d6' },
  attention: { label: 'Atenção', color: '#eda100' },
  late: { label: 'Atrasado', color: '#d03b3b' },
  stalled: { label: 'Parado', color: '#52514e' },
  unknown: { label: 'Sem dados', color: '#898781' },
};

export function health(bu: BurnUp | null): Health {
  if (!bu) return 'unknown';
  if (bu.finished) return 'done';
  if (bu.stalled) return 'stalled';
  if (bu.delay === null) return 'late'; // sem previsão: velocidade zero
  return bu.delay <= 0 ? 'on-track' : bu.delay === 1 ? 'attention' : 'late';
}

// ---------- Gantt ----------

export interface GanttItem {
  id: number;
  label: string;
  detail: string;
  start: string;
  end: string;
  progress: number; // 0 a 1
  color: string;
  late: boolean;
  chip?: { label: string; color: string };
  forecast?: string | null; // previsão de término (marcador ◆)
}

export function gantt(items: GanttItem[], now: string) {
  if (!items.length) return null;
  const days = items.flatMap((item) => [item.start, item.end, item.forecast ?? item.end]).concat(now);
  const from = Math.min(...days.map(businessIndex));
  const to = Math.max(...days.map(businessIndex)) + 1;
  const pos = (day: string, end = false) => ((businessIndex(day) + (end ? 1 : 0) - from) / (to - from)) * 100;
  const firstSprint = Math.floor(from / SPRINT_DAYS) + 1;
  const lastSprint = Math.floor((to - 1) / SPRINT_DAYS) + 1;

  return {
    today: pos(now) + 50 / (to - from),
    sprints: range(firstSprint, lastSprint).map((n) => {
      const left = Math.max(0, (((n - 1) * SPRINT_DAYS - from) / (to - from)) * 100);
      const right = Math.min(100, ((n * SPRINT_DAYS - from) / (to - from)) * 100);
      return { number: n, left, width: right - left, current: n === sprintOf(now) };
    }),
    rows: items.map((item) => {
      const left = pos(item.start);
      const tip: Tip = {
        heading: item.label,
        rows: [
          { name: 'período planejado', value: `${shortDate(item.start)} – ${shortDate(item.end)}`, color: item.color },
          { name: 'concluído', value: `${Math.round(item.progress * 100)}%`, color: item.color },
          ...(item.forecast ? [{ name: 'previsão de término', value: shortDate(item.forecast), color: SERIES[2] }] : []),
          ...(item.late ? [{ name: 'passou do prazo', value: '⚠', color: '#d03b3b' }] : []),
        ],
      };
      return {
        ...item,
        left,
        width: Math.max(0.6, pos(item.end, true) - left),
        forecastLeft: item.forecast && item.forecast !== item.end ? pos(item.forecast, true) : null,
        tip,
      };
    }),
  };
}

// ---------- Insights automáticos ----------

export interface Insight {
  tone: 'good' | 'warn' | 'bad' | 'info';
  text: string;
}

export interface ProjectSummary {
  name: string;
  bu: BurnUp | null;
  health: Health;
}

export interface InsightOptions {
  unit?: string; // 'pts' (projetos) ou 'atividades' (atividades gerais, contadas uma a uma)
  sprintName?: (sprint: number) => string;
  riskLabel?: string; // 'Projetos em risco' ou 'Setores em risco'
  scopeGrowth?: boolean; // projetos têm escopo fechado; o trabalho contínuo dos setores cresce a cada sprint (padrão: true)
}

export function insights(tasks: ProjectTask[], bd: BurnDown, bu: BurnUp | null, now: string, projects: ProjectSummary[] = [], options: InsightOptions = {}): Insight[] {
  const u = options.unit ?? 'pts';
  const q = (n: number) => `${n} ${n === 1 && u === 'atividades' ? 'atividade' : u}`; // 1 atividade, 2 atividades
  const sn = options.sprintName ?? ((n: number) => `Sprint ${n}`);
  const list: Insight[] = [];
  const isCurrent = bd.sprint.number === sprintOf(now);

  // Sprint (burn-down)
  if (bd.scope === 0) {
    list.push({ tone: 'info', text: `Nenhuma atividade comprometida na ${sn(bd.sprint.number)}.` });
  } else if (bd.left === 0) {
    list.push({ tone: 'good', text: `${sn(bd.sprint.number)}: tudo entregue (${q(bd.done)}).` });
  } else if (isCurrent && bd.daysLeft > 0) {
    if (bd.leftover === 0) {
      list.push({ tone: 'good', text: `No ritmo atual (${bd.pace} ${u}/dia), a ${sn(bd.sprint.number)} fecha no prazo: faltam ${q(bd.left)} em ${bd.daysLeft} dias úteis.` });
    } else {
      list.push({
        tone: 'bad',
        text: `Faltam ${q(bd.left)} em ${bd.daysLeft} dias úteis: é preciso ${bd.needed} ${u}/dia e o time entrega ${bd.pace} ${u}/dia. Cerca de ${q(bd.leftover)} ${bd.leftover === 1 ? 'deve' : 'devem'} ficar para a próxima sprint — priorize ou renegocie o escopo.`,
      });
    }
  } else if (bd.lived === SPRINT_DAYS) {
    list.push({ tone: 'warn', text: `A ${sn(bd.sprint.number)} fechou com ${bd.left} de ${q(bd.scope)} sem entregar (${Math.round((bd.done / bd.scope) * 100)}% concluído).` });
  }
  if (bd.added > 0) {
    list.push({ tone: 'warn', text: `${q(bd.added)} ${bd.added === 1 ? 'entrou' : 'entraram'} com a ${sn(bd.sprint.number)} já em andamento (${Math.round((bd.added / Math.max(bd.committed, 1)) * 100)}% a mais que o compromisso). Mudança de escopo no meio da sprint derruba a previsibilidade.` });
  }

  // Projeto / geral (burn-up)
  if (bu && !bu.finished) {
    if (bu.stalled) {
      list.push({ tone: 'bad', text: 'Nenhum ponto entregue desde a sprint passada: o andamento está parado. Verifique bloqueios ou se o projeto deveria estar pausado.' });
    } else if (bu.forecast === null) {
      list.push({ tone: 'bad', text: 'Sem velocidade nas últimas sprints: não dá para prever o término.' });
    } else if (bu.delay! > 0) {
      list.push({ tone: bu.delay! > 1 ? 'bad' : 'warn', text: `Previsão de término na ${sn(bu.forecast!)} (${shortDate(bu.forecastDate!)}), ${bu.delay} ${bu.delay === 1 ? 'sprint' : 'sprints'} depois do planejado (${sn(bu.plannedEnd)}, ${shortDate(bu.plannedDate)}).` });
    } else {
      list.push({ tone: 'good', text: `Previsão de término na ${sn(bu.forecast!)} (${shortDate(bu.forecastDate!)}), dentro do planejado (${sn(bu.plannedEnd)}).` });
    }
    if (options.scopeGrowth !== false && !projects.length && bu.scopeGrowth >= 15) { // no geral os projetos começam em datas diferentes: crescimento não se compara
      list.push({ tone: 'warn', text: `O escopo cresceu ${bu.scopeGrowth}% desde o início (${bu.initial} → ${q(bu.total)}). Cada item novo empurra a data de entrega.` });
    }
    const [previous, last] = [bu.deltas.slice(0, -1), bu.deltas.at(-1)];
    if (last !== undefined && previous.length) {
      const average = previous.reduce((a, b) => a + b, 0) / previous.length;
      if (average > 0 && last < average * 0.75) list.push({ tone: 'warn', text: `A velocidade caiu na última sprint: ${q(last)} contra a média de ${q(round1(average))}.` });
      if (average > 0 && last > average * 1.25) list.push({ tone: 'good', text: `A velocidade subiu na última sprint: ${q(last)} contra a média de ${q(round1(average))}.` });
    }
  }

  // Projetos atrasados (visão geral)
  const late = projects.filter((p) => p.health === 'late' || p.health === 'stalled');
  if (late.length) {
    list.push({ tone: 'bad', text: `${options.riskLabel ?? 'Projetos em risco'}: ${late.map((p) => `${p.name} (${HEALTH[p.health].label.toLowerCase()})`).join(', ')}.` });
  }

  // Atividades atrasadas
  const overdue = tasks.filter((task) => task.status !== 'done' && task.end < now);
  if (overdue.length) {
    const names = overdue.slice(0, 3).map((task) => task.title).join(', ');
    list.push({ tone: 'warn', text: `${overdue.length} ${overdue.length === 1 ? 'atividade passou' : 'atividades passaram'} do prazo: ${names}${overdue.length > 3 ? '…' : ''}.` });
  }

  // Carga e gargalo na sprint atual
  const open = tasks.filter((task) => task.sprint === sprintOf(now) && task.status !== 'done');
  const byPerson = new Map<string, number>();
  for (const task of open) byPerson.set(task.assignee, (byPerson.get(task.assignee) ?? 0) + task.points);
  if (byPerson.size >= 2) {
    const [name, points] = [...byPerson].sort((a, b) => b[1] - a[1])[0];
    const share = points / sum(open);
    if (share > 1.5 / byPerson.size && share >= 0.35) {
      list.push({ tone: 'warn', text: `${name} concentra ${q(points)} em aberto na sprint (${Math.round(share * 100)}% do que falta). Redistribuir reduz o risco de gargalo.` });
    }
  }
  const review = sum(open.filter((task) => task.status === 'review'));
  if (review >= 5 && review / Math.max(sum(open), 1) >= 0.35) {
    list.push({ tone: 'warn', text: `${q(review)} parados em ${TASK_STATUSES.review.label}: a revisão virou gargalo.` });
  }

  return list;
}
