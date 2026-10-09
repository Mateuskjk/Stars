import { datesFromName, papelLabel } from './migration-wizard';

describe('datesFromName', () => {
  const today = new Date(2026, 9, 9); // 09/10/2026

  it('lê as datas do nome da sprint', () => {
    expect(datesFromName('Sprint 14 [06/10 à 15/10]', today)).toEqual({ inicio: '2026-10-06', fim: '2026-10-15' });
    expect(datesFromName('SPRINT 12 [11/09 à 21/09]', today)).toEqual({ inicio: '2026-09-11', fim: '2026-09-21' });
  });

  it('virada de ano e datas muito no futuro', () => {
    expect(datesFromName('Sprint [29/12 a 08/01]', new Date(2026, 11, 20))).toEqual({ inicio: '2026-12-29', fim: '2027-01-08' });
    expect(datesFromName('Sprint 1 [05/01 à 14/01]', today)).toEqual({ inicio: '2026-01-05', fim: '2026-01-14' });
  });

  it('sem datas no nome', () => {
    expect(datesFromName('Sprint 13', today)).toBeNull();
  });
});

describe('papelLabel', () => {
  it('mapeia os papéis do banco para os cargos do LexÁgile', () => {
    expect(papelLabel('DONO')).toBe('Admin');
    expect(papelLabel('GESTOR')).toBe('Supervisor');
    expect(papelLabel('ATENDENTE')).toBe('Membro');
    expect(papelLabel('OBSERVADOR')).toBe('Membro (só leitura)');
  });
});
