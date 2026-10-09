// Datas no nome da sprint, ex.: "Sprint 14 [06/10 à 15/10]" → 2026-10-06 / 2026-10-15
export function datesFromName(nome: string, today = new Date()): { inicio: string; fim: string } | null {
  const m = nome.match(/(\d{1,2})\/(\d{1,2})\s*(?:à|a|-|até)\s*(\d{1,2})\/(\d{1,2})/i);
  if (!m) return null;
  const [d1, m1, d2, m2] = m.slice(1).map(Number);
  // Sem ano no nome: usa o ano atual, ou o anterior se a data ficaria mais de 2 meses no futuro
  let year = today.getFullYear();
  if (new Date(year, m1 - 1, d1).getTime() - today.getTime() > 62 * 864e5) year--;
  const pad = (n: number) => String(n).padStart(2, '0');
  const fimYear = m2 < m1 ? year + 1 : year;
  return { inicio: `${year}-${pad(m1)}-${pad(d1)}`, fim: `${fimYear}-${pad(m2)}-${pad(d2)}` };
}
