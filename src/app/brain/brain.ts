import { Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NotesStore } from '../notes/notes-store';
import { GraphNode, seedNodes, settle, tick } from './force-layout';

interface Point {
  x: number;
  y: number;
}

@Component({
  imports: [RouterLink],
  selector: 'app-brain',
  templateUrl: './brain.html',
  host: { class: 'brain' },
})
export class Brain {
  private readonly store = inject(NotesStore);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // ---------- Dados do grafo ----------
  // Ligações sem direção e sem repetir (A→B e B→A viram uma linha só)
  protected readonly edges = computed(() => {
    const seen = new Set<string>();
    return this.store.edges().filter(([a, b]) => {
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      return !seen.has(key) && seen.add(key);
    });
  });

  protected readonly degree = computed(() => {
    const count = new Map<number, number>();
    for (const [a, b] of this.edges()) {
      count.set(a, (count.get(a) ?? 0) + 1);
      count.set(b, (count.get(b) ?? 0) + 1);
    }
    return count;
  });

  protected readonly stats = computed(() => {
    const notes = this.store.notes();
    const degree = this.degree();
    return {
      notes: notes.length,
      links: this.edges().length,
      orphans: notes.filter((note) => !degree.get(note.id)).length,
      hubs: [...notes]
        .filter((note) => degree.get(note.id))
        .sort((a, b) => degree.get(b.id)! - degree.get(a.id)!)
        .slice(0, 3),
    };
  });

  // Posições ficam fora dos signals (mudam 60x por segundo); "frame" avisa o template para redesenhar
  private nodes: GraphNode[] = [];
  protected readonly frame = signal(0);

  protected readonly view = computed(() => {
    this.frame();
    const titles = new Map(this.store.notes().map((note) => [note.id, note.title]));
    const degree = this.degree();
    const at = new Map(this.nodes.map((node) => [node.id, node]));
    return {
      nodes: this.nodes.map((node) => ({
        id: node.id,
        x: node.x,
        y: node.y,
        title: titles.get(node.id) ?? '',
        degree: degree.get(node.id) ?? 0,
        r: 6 + 3 * Math.sqrt(degree.get(node.id) ?? 0),
      })),
      edges: this.edges()
        .map(([a, b]) => ({ a, b, from: at.get(a), to: at.get(b) }))
        .filter((edge) => edge.from && edge.to),
    };
  });

  // ---------- Destaque (hover / foco) ----------
  protected readonly hovered = signal<number | null>(null);
  protected readonly neighbors = computed(() => {
    const id = this.hovered();
    const set = new Set<number>();
    if (id === null) return set;
    set.add(id);
    for (const [a, b] of this.edges()) {
      if (a === id) set.add(b);
      if (b === id) set.add(a);
    }
    return set;
  });
  protected readonly focusedNote = computed(() => this.store.notes().find((note) => note.id === this.hovered()) ?? null);
  protected readonly focusedBacklinks = computed(() => {
    const note = this.focusedNote();
    return note ? this.store.backlinks(note).length : 0;
  });

  // ---------- Câmera (arrastar o fundo e zoom) ----------
  protected readonly camera = signal({ x: 0, y: 0, k: 1 });
  protected readonly size = signal({ width: 800, height: 560 });
  protected readonly viewBox = computed(() => {
    const { width, height } = this.size();
    return `${-width / 2} ${-height / 2} ${width} ${height}`;
  });
  protected readonly transform = computed(() => {
    const { x, y, k } = this.camera();
    return `translate(${x} ${y}) scale(${k})`;
  });

  private readonly svg = viewChild.required<ElementRef<SVGSVGElement>>('svg');

  constructor() {
    this.destroyRef.onDestroy(() => (this.destroyed = true)); // para a animação ao sair da página

    afterNextRender(() => {
      const svg = this.svg().nativeElement;
      const measure = () => {
        const rect = svg.getBoundingClientRect();
        if (rect.width) this.size.set({ width: rect.width, height: rect.height });
      };
      measure(); // antes de carregar as notas, para o primeiro enquadramento usar o tamanho real
      this.store.load();
      const observer = new ResizeObserver(measure);
      observer.observe(svg);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });

    // Quando as notas mudam: mantém quem já estava no lugar, acrescenta os novos e reaquece a simulação
    effect(() => {
      const ids = this.store.notes().map((note) => note.id);
      const old = new Map(this.nodes.map((node) => [node.id, node]));
      const seeded = seedNodes(ids);
      this.nodes = ids.map((id, i) => old.get(id) ?? seeded[i]);
      const edges = this.edges(); // depende também das ligações
      if (old.size) {
        this.reheat(0.5); // grafo mudou com a página aberta: anima até se acomodar
      } else if (typeof window !== 'undefined' && this.nodes.length) {
        // Primeira vez: calcula o layout de uma vez e já mostra enquadrado, sem animação de entrada
        settle(this.nodes, edges);
        this.frame.update((n) => n + 1);
        this.fit();
      }
    });
  }

  // ---------- Simulação ----------
  private alpha = 0;
  private running = false;

  private reheat(alpha: number) {
    if (typeof window === 'undefined') return; // no SSR não há animação
    this.alpha = Math.max(this.alpha, alpha);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      settle(this.nodes, this.edges());
      this.alpha = 0;
      this.frame.update((n) => n + 1);
      this.autoFit();
      return;
    }
    if (this.running) return;
    this.running = true;
    const step = () => {
      if (this.destroyed || this.alpha < 0.005) {
        this.running = false;
        this.autoFit();
        return;
      }
      for (let i = 0; i < 2; i++) {
        tick(this.nodes, this.edges(), this.alpha);
        this.alpha *= 0.985;
      }
      this.frame.update((n) => n + 1);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private destroyed = false;

  // ---------- Ponteiro: arrastar nó, arrastar fundo, clicar ----------
  private drag: { kind: 'node'; node: GraphNode; start: Point; moved: boolean } | { kind: 'pan'; start: Point; origin: Point } | null = null;

  // Ponto da tela → coordenada do grafo (desfaz o centro, o deslocamento e o zoom)
  private toGraph(event: PointerEvent): Point {
    const rect = this.svg().nativeElement.getBoundingClientRect();
    const { x, y, k } = this.camera();
    return {
      x: (event.clientX - rect.left - rect.width / 2 - x) / k,
      y: (event.clientY - rect.top - rect.height / 2 - y) / k,
    };
  }

  protected onPointerDown(event: PointerEvent, nodeId?: number) {
    this.svg().nativeElement.setPointerCapture(event.pointerId);
    const node = nodeId !== undefined ? this.nodes.find((n) => n.id === nodeId) : undefined;
    if (node) {
      node.fixed = true;
      this.drag = { kind: 'node', node, start: { x: event.clientX, y: event.clientY }, moved: false };
    } else {
      const { x, y } = this.camera();
      this.drag = { kind: 'pan', start: { x: event.clientX, y: event.clientY }, origin: { x, y } };
    }
    event.stopPropagation();
  }

  protected onPointerMove(event: PointerEvent) {
    const drag = this.drag;
    if (!drag) return;
    if (drag.kind === 'node') {
      if (Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) > 3) drag.moved = true;
      const point = this.toGraph(event);
      drag.node.x = point.x;
      drag.node.y = point.y;
      this.reheat(0.3);
      this.frame.update((n) => n + 1);
    } else {
      this.cameraTouched = true;
      this.camera.update((camera) => ({
        ...camera,
        x: drag.origin.x + event.clientX - drag.start.x,
        y: drag.origin.y + event.clientY - drag.start.y,
      }));
    }
  }

  protected onPointerUp() {
    const drag = this.drag;
    this.drag = null;
    if (drag?.kind !== 'node') return;
    drag.node.fixed = false;
    if (!drag.moved) this.openNote(drag.node.id); // clique sem arrastar abre a nota
  }

  protected onWheel(event: WheelEvent) {
    event.preventDefault();
    this.zoom(event.deltaY < 0 ? 1.15 : 1 / 1.15);
  }

  protected zoom(factor: number) {
    this.cameraTouched = true;
    this.camera.update((camera) => ({ ...camera, k: Math.min(4, Math.max(0.25, camera.k * factor)) }));
  }

  // Enquadra o grafo inteiro na área visível
  protected fit() {
    this.cameraTouched = false;
    if (!this.nodes.length) return this.camera.set({ x: 0, y: 0, k: 1 });
    const xs = this.nodes.map((n) => n.x);
    const ys = this.nodes.map((n) => n.y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const { width, height } = this.size();
    const padding = 80; // espaço para os nomes nas bordas
    const k = Math.min(1.5, (width - padding * 2) / Math.max(maxX - minX, 1), (height - padding * 2) / Math.max(maxY - minY, 1));
    this.camera.set({ x: (-(minX + maxX) / 2) * k, y: (-(minY + maxY) / 2) * k, k: Math.max(0.25, k) });
  }

  // Depois que o grafo se acomoda, enquadra sozinho — a não ser que a pessoa já tenha mexido na câmera
  private cameraTouched = false;

  private autoFit() {
    if (!this.cameraTouched && !this.drag) this.fit();
  }

  protected openNote(id: number) {
    this.router.navigate(['/workspace/notes'], { queryParams: { nota: id } });
  }

  // Nomes aparecem sempre perto; com zoom afastado, só do nó em destaque e dos maiores
  protected showLabel(node: { id: number; degree: number }) {
    return this.camera().k >= 0.7 || this.neighbors().has(node.id) || node.degree >= 3;
  }
}
