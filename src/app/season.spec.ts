import { easter, seasonOf } from './season';

describe('temas de datas comemorativas', () => {
  it('calcula a Páscoa e as datas móveis', () => {
    expect(easter(2026)).toEqual(new Date(2026, 3, 5)); // 5 de abril de 2026
    expect(easter(2027)).toEqual(new Date(2027, 2, 28)); // 28 de março de 2027
    expect(seasonOf(new Date(2026, 1, 16))?.id).toBe('carnaval'); // segunda de Carnaval 2026
    expect(seasonOf(new Date(2026, 3, 2))?.id).toBe('pascoa');
    expect(seasonOf(new Date(2026, 4, 10))?.id).toBe('maes'); // 2º domingo de maio
    expect(seasonOf(new Date(2026, 7, 9))?.id).toBe('pais'); // 2º domingo de agosto
  });

  it('meses temáticos e fim de ano; fora deles, nenhum tema', () => {
    expect(seasonOf(new Date(2026, 10, 11))?.id).toBe('novembro-azul');
    expect(seasonOf(new Date(2026, 9, 10))?.id).toBe('outubro-rosa');
    expect(seasonOf(new Date(2026, 9, 31))?.id).toBe('halloween');
    expect(seasonOf(new Date(2026, 11, 24))?.id).toBe('natal');
    expect(seasonOf(new Date(2026, 11, 31))?.id).toBe('ano-novo');
    expect(seasonOf(new Date(2027, 0, 2))?.id).toBe('ano-novo');
    expect(seasonOf(new Date(2026, 6, 15))).toBeNull(); // meio de julho
  });
});
