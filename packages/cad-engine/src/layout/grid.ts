import { LAYOUT_CONFIG, snap } from "./config";
import type { LogicGraph } from "./graph";

/**
 * Discrete routing grid. Obstacles are expanded node footprints.
 * Routing cells that touch a block (+ clearance) are blocked.
 */
export class RoutingGrid {
  readonly cell: number;
  readonly originX: number;
  readonly originY: number;
  readonly cols: number;
  readonly rows: number;
  /** 0 = free, >0 = obstacle or reserved wire congestion. */
  private cells: Uint16Array;
  private blocked: Uint8Array;

  constructor(pageWidth: number, pageHeight: number, cell = LAYOUT_CONFIG.gridSize) {
    this.cell = cell;
    this.originX = 0;
    this.originY = 0;
    this.cols = Math.ceil(pageWidth / cell) + 2;
    this.rows = Math.ceil(pageHeight / cell) + 2;
    this.cells = new Uint16Array(this.cols * this.rows);
    this.blocked = new Uint8Array(this.cols * this.rows);
  }

  private idx(c: number, r: number): number {
    return r * this.cols + c;
  }

  inBounds(c: number, r: number): boolean {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows;
  }

  worldToCell(x: number, y: number): { c: number; r: number } {
    return {
      c: Math.max(0, Math.min(this.cols - 1, Math.round((x - this.originX) / this.cell))),
      r: Math.max(0, Math.min(this.rows - 1, Math.round((y - this.originY) / this.cell))),
    };
  }

  cellToWorld(c: number, r: number): { x: number; y: number } {
    return {
      x: snap(this.originX + c * this.cell),
      y: snap(this.originY + r * this.cell),
    };
  }

  isBlocked(c: number, r: number): boolean {
    if (!this.inBounds(c, r)) return true;
    return this.blocked[this.idx(c, r)] === 1;
  }

  congestion(c: number, r: number): number {
    if (!this.inBounds(c, r)) return 999;
    return this.cells[this.idx(c, r)];
  }

  addCongestion(c: number, r: number, amount = 1): void {
    if (!this.inBounds(c, r)) return;
    this.cells[this.idx(c, r)] = Math.min(60000, this.cells[this.idx(c, r)] + amount);
  }

  markObstacleRect(
    x: number,
    y: number,
    w: number,
    h: number,
    clearance = LAYOUT_CONFIG.routeClearance
  ): void {
    const x1 = x - clearance;
    const y1 = y - clearance;
    const x2 = x + w + clearance;
    const y2 = y + h + clearance;
    const a = this.worldToCell(x1, y1);
    const b = this.worldToCell(x2, y2);
    const c0 = Math.min(a.c, b.c);
    const c1 = Math.max(a.c, b.c);
    const r0 = Math.min(a.r, b.r);
    const r1 = Math.max(a.r, b.r);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (this.inBounds(c, r)) this.blocked[this.idx(c, r)] = 1;
      }
    }
  }

  /** Temporarily open cells at a port so A* can start/end on the block face. */
  openPortWindow(x: number, y: number, radiusCells = 1): Array<{ c: number; r: number }> {
    const { c, r } = this.worldToCell(x, y);
    const opened: Array<{ c: number; r: number }> = [];
    for (let dr = -radiusCells; dr <= radiusCells; dr++) {
      for (let dc = -radiusCells; dc <= radiusCells; dc++) {
        const cc = c + dc;
        const rr = r + dr;
        if (!this.inBounds(cc, rr)) continue;
        const i = this.idx(cc, rr);
        if (this.blocked[i]) {
          this.blocked[i] = 0;
          opened.push({ c: cc, r: rr });
        }
      }
    }
    return opened;
  }

  restoreBlocked(cells: Array<{ c: number; r: number }>): void {
    for (const { c, r } of cells) {
      if (this.inBounds(c, r)) this.blocked[this.idx(c, r)] = 1;
    }
  }

  /** Clear a world-space rectangle (used to carve routing gutters). */
  clearRect(x: number, y: number, w: number, h: number): void {
    const a = this.worldToCell(x, y);
    const b = this.worldToCell(x + w, y + h);
    const c0 = Math.min(a.c, b.c);
    const c1 = Math.max(a.c, b.c);
    const r0 = Math.min(a.r, b.r);
    const r1 = Math.max(a.r, b.r);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (this.inBounds(c, r)) this.blocked[this.idx(c, r)] = 0;
      }
    }
  }
}

export function createRoutingGrid(
  graph: LogicGraph,
  pageWidth: number,
  pageHeight: number
): RoutingGrid {
  // Pad page for outer feedback lanes.
  const pad = LAYOUT_CONFIG.pageMargin * 2;
  const grid = new RoutingGrid(pageWidth + pad, pageHeight + pad);
  for (const id of graph.nodeOrder) {
    const n = graph.nodes.get(id)!;
    if (n.role === "junction") continue;
    grid.markObstacleRect(n.x, n.y, n.width, n.height, 3);
  }

  // Carve free vertical gutters between layer columns so routers can travel.
  const byLayer = new Map<number, { minX: number; maxX: number }>();
  for (const id of graph.nodeOrder) {
    const n = graph.nodes.get(id)!;
    if (n.role === "junction") continue;
    const cur = byLayer.get(n.layer) ?? { minX: n.x, maxX: n.x + n.width };
    cur.minX = Math.min(cur.minX, n.x);
    cur.maxX = Math.max(cur.maxX, n.x + n.width);
    byLayer.set(n.layer, cur);
  }
  const layers = [...byLayer.keys()].sort((a, b) => a - b);
  for (let i = 0; i < layers.length - 1; i++) {
    const left = byLayer.get(layers[i])!;
    const right = byLayer.get(layers[i + 1])!;
    const x0 = left.maxX + 2;
    const x1 = right.minX - 2;
    if (x1 > x0) grid.clearRect(x0, 0, x1 - x0, pageHeight + pad);
  }
  return grid;
}
