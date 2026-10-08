// Layout de força simples (sem biblioteca): notas se repelem, links funcionam como molas
// e tudo é puxado de leve para o centro. Bom para algumas centenas de notas.
// ponytail: repulsão O(n²); se passar de ~500 notas, trocar por d3-force (Barnes–Hut)

export interface GraphNode {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed?: boolean; // nó sendo arrastado: não se move sozinho
}

export type GraphEdge = readonly [number, number];

const REPULSION = 7000;
const SPRING_LENGTH = 85;
const SPRING = 0.06;
const GRAVITY = 0.012;
const DAMPING = 0.82;

// Posições iniciais em espiral (determinístico: o mesmo grafo sempre começa igual)
export function seedNodes(ids: number[]): GraphNode[] {
  return ids.map((id, i) => {
    const angle = i * 2.4; // ângulo dourado espalha bem os pontos
    const radius = 30 + 18 * Math.sqrt(i);
    return { id, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, vx: 0, vy: 0 };
  });
}

// Um passo da simulação; alpha (1 → 0) diminui a força conforme o grafo se acomoda
export function tick(nodes: GraphNode[], edges: GraphEdge[], alpha: number) {
  const index = new Map(nodes.map((node) => [node.id, node]));

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      if (dx === 0 && dy === 0) dx = 0.1 * (j - i); // evita divisão por zero em nós sobrepostos
      const d2 = Math.max(dx * dx + dy * dy, 25);
      const force = (REPULSION * alpha) / d2;
      const d = Math.sqrt(d2);
      a.vx -= (dx / d) * force;
      a.vy -= (dy / d) * force;
      b.vx += (dx / d) * force;
      b.vy += (dy / d) * force;
    }
  }

  for (const [from, to] of edges) {
    const a = index.get(from);
    const b = index.get(to);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.max(Math.hypot(dx, dy), 0.01);
    const force = (d - SPRING_LENGTH) * SPRING * alpha;
    a.vx += (dx / d) * force;
    a.vy += (dy / d) * force;
    b.vx -= (dx / d) * force;
    b.vy -= (dy / d) * force;
  }

  for (const node of nodes) {
    if (node.fixed) {
      node.vx = node.vy = 0;
      continue;
    }
    node.vx = (node.vx - node.x * GRAVITY * alpha) * DAMPING;
    node.vy = (node.vy - node.y * GRAVITY * alpha) * DAMPING;
    node.x += node.vx;
    node.y += node.vy;
  }
}

// Roda a simulação até o fim de uma vez (usado nos testes e com "reduzir movimento")
export function settle(nodes: GraphNode[], edges: GraphEdge[], ticks = 300) {
  let alpha = 1;
  for (let i = 0; i < ticks; i++) {
    tick(nodes, edges, alpha);
    alpha *= 0.985;
  }
  return nodes;
}
