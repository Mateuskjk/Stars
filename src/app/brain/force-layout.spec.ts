import { seedNodes, settle } from './force-layout';

describe('force layout', () => {
  it('pulls linked notes together and pushes unlinked ones apart', () => {
    // 1–2–3 ligados em cadeia; 4 sozinho
    const nodes = settle(seedNodes([1, 2, 3, 4]), [
      [1, 2],
      [2, 3],
    ]);
    const at = (id: number) => nodes.find((n) => n.id === id)!;
    const dist = (a: number, b: number) => Math.hypot(at(a).x - at(b).x, at(a).y - at(b).y);

    expect(nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
    expect(dist(1, 2)).toBeLessThan(dist(1, 4));
    expect(dist(2, 3)).toBeLessThan(dist(3, 4));
    expect(dist(1, 2)).toBeGreaterThan(20); // não colapsam num ponto só
  });
});
