// Temas de datas comemorativas: ligam e desligam sozinhos pela data (dá para desligar em Minha conta).
// O tema escolhido vai para <html data-season="…"> e o CSS (_season.scss) troca as cores de destaque.

export interface Season {
  id: string;
  label: string;
  emoji: string;
  message: string;
}

// Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano)
export function easter(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// n-ésimo domingo do mês (mês 0–11)
function nthSunday(year: number, month: number, n: number) {
  const first = new Date(year, month, 1);
  return new Date(year, month, 1 + ((7 - first.getDay()) % 7) + (n - 1) * 7);
}

const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
const between = (date: Date, from: Date, to: Date) => day(date) >= day(from) && day(date) <= day(to);

// Na ordem: a primeira que bate vale (as de data móvel vêm antes dos meses temáticos)
export function seasonOf(date: Date): Season | null {
  const y = date.getFullYear();
  const md = (m: number, d: number) => new Date(y, m - 1, d);
  const pascoa = easter(y);
  const maes = nthSunday(y, 4, 2);
  const pais = nthSunday(y, 7, 2);
  const rules: [boolean, Season][] = [
    [
      between(date, md(12, 27), md(12, 31)) || between(date, md(1, 1), md(1, 3)),
      { id: 'ano-novo', label: 'Ano Novo', emoji: '🎆', message: 'Feliz Ano Novo! Que o próximo ciclo venha com sprints leves e entregas no prazo.' },
    ],
    [between(date, md(12, 1), md(12, 26)), { id: 'natal', label: 'Natal', emoji: '🎄', message: 'Boas festas! Obrigado por tudo que o time entregou este ano.' }],
    [
      between(date, addDays(pascoa, -51), addDays(pascoa, -46)),
      { id: 'carnaval', label: 'Carnaval', emoji: '🎭', message: 'Bom Carnaval! Deixe as atividades em dia antes do feriado.' },
    ],
    [between(date, addDays(pascoa, -6), pascoa), { id: 'pascoa', label: 'Páscoa', emoji: '🐣', message: 'Feliz Páscoa para você e sua família!' }],
    [between(date, addDays(maes, -6), maes), { id: 'maes', label: 'Dia das Mães', emoji: '💐', message: 'Feliz Dia das Mães a todas as mães do nosso time!' }],
    [between(date, md(6, 1), md(6, 30)), { id: 'junina', label: 'Festa Junina', emoji: '🌽', message: 'Arraiá do LexÁgile! Bom São João para todo mundo.' }],
    [between(date, addDays(pais, -6), pais), { id: 'pais', label: 'Dia dos Pais', emoji: '👔', message: 'Feliz Dia dos Pais a todos os pais do nosso time!' }],
    [between(date, md(9, 1), md(9, 7)), { id: 'independencia', label: 'Independência', emoji: '🇧🇷', message: 'Semana da Pátria: viva o Brasil!' }],
    [between(date, md(10, 25), md(10, 31)), { id: 'halloween', label: 'Halloween', emoji: '🎃', message: 'Nada de sustos: só cartões atrasados dão medo por aqui.' }],
    [between(date, md(10, 1), md(10, 24)), { id: 'outubro-rosa', label: 'Outubro Rosa', emoji: '🎀', message: 'Mês de prevenção e cuidado com a saúde da mulher.' }],
    [between(date, md(11, 1), md(11, 30)), { id: 'novembro-azul', label: 'Novembro Azul', emoji: '💙', message: 'Mês de prevenção e cuidado com a saúde do homem.' }],
  ];
  return rules.find(([on]) => on)?.[1] ?? null;
}
