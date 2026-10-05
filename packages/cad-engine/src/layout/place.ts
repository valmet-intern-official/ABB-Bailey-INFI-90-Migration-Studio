import { LAYOUT_CONFIG, snap } from "./config";
import type { LayoutGroup } from "./groups";
import type { LogicGraph } from "./graph";

/**
 * Compact hierarchical placement:
 * - Columns by layer (inputs → logic → outputs)
 * - Rows by source-Y order within each layer
 * - STEP groups share aligned row bands without cascading empty slots
 */
export function placeNodes(
  graph: LogicGraph,
  byLayer: Map<number, string[]>,
  groups: LayoutGroup[]
): { pageWidth: number; pageHeight: number } {
  const cfg = LAYOUT_CONFIG;
  const layers = [...byLayer.keys()].sort((a, b) => a - b);

  const layerWidths = new Map<number, number>();
  for (const L of layers) {
    let maxW = cfg.minBlockWidth;
    for (const id of byLayer.get(L) ?? []) {
      maxW = Math.max(maxW, graph.nodes.get(id)!.width);
    }
    layerWidths.set(L, maxW);
  }

  const colX = new Map<number, number>();
  let x = cfg.pageMargin;
  for (const L of layers) {
    colX.set(L, snap(x));
    x += layerWidths.get(L)! + cfg.nodeSpacingX;
  }

  // Global row assignment: sort all non-junction nodes by source Y, pack into rows
  // with barycentric tie-break by group.
  const placeable = graph.nodeOrder
    .map((id) => graph.nodes.get(id)!)
    .filter((n) => n.role !== "junction");

  placeable.sort((a, b) => {
    const ya = a.block.sourceGeometry?.originalY ?? a.block.y;
    const yb = b.block.sourceGeometry?.originalY ?? b.block.y;
    if (ya !== yb) return ya - yb;
    if ((a.groupId ?? "") !== (b.groupId ?? "")) {
      return (a.groupId ?? "").localeCompare(b.groupId ?? "");
    }
    return a.id.localeCompare(b.id);
  });

  // Assign each node a row index; nodes in the same layer cannot share a row.
  const layerRowOcc = new Map<number, Set<number>>();
  for (const L of layers) layerRowOcc.set(L, new Set());

  let nextRow = 0;
  const nodeRow = new Map<string, number>();

  for (const n of placeable) {
    const occ = layerRowOcc.get(n.layer) ?? new Set();
    let row = nextRow;
    // Prefer a row near source order; walk forward until free in this layer.
    while (occ.has(row)) row++;
    occ.add(row);
    layerRowOcc.set(n.layer, occ);
    nodeRow.set(n.id, row);
    nextRow = Math.max(nextRow, row);
  }

  // Align nodes that share a group and similar ordinal across layers onto same rows when free.
  if (groups.length > 0) {
    for (const g of groups) {
      const members = g.nodeIds
        .map((id) => graph.nodes.get(id)!)
        .filter((n) => n.role !== "junction")
        .sort((a, b) => a.order - b.order);
      // Use median row of members as band start.
      const rows = members.map((m) => nodeRow.get(m.id) ?? 0).sort((a, b) => a - b);
      if (rows.length === 0) continue;
      const base = rows[0];
      members.forEach((m, i) => {
        const desired = base + i;
        const occ = layerRowOcc.get(m.layer)!;
        const cur = nodeRow.get(m.id)!;
        if (cur === desired) return;
        if (!occ.has(desired)) {
          occ.delete(cur);
          occ.add(desired);
          nodeRow.set(m.id, desired);
        }
      });
    }
  }

  const rowH = cfg.minBlockHeight + cfg.minimumNodeGap;
  const y0 = cfg.pageMargin + cfg.titleBand;

  for (const n of placeable) {
    const row = nodeRow.get(n.id) ?? 0;
    n.x = snap(
      (colX.get(n.layer) ?? cfg.pageMargin) + (layerWidths.get(n.layer)! - n.width) / 2
    );
    n.y = snap(y0 + row * rowH);
  }

  // Junctions: place in the nearest clear vertical gutter at neighbor barycenter Y.
  const logicBoxes = placeable.map((n) => ({
    x: n.x,
    y: n.y,
    w: n.width,
    h: n.height,
  }));
  const clearX = (x: number) =>
    logicBoxes.every((b) => x <= b.x - 4 || x >= b.x + b.w + 4);

  // Build gutter X list from layer columns.
  const gutters: number[] = [];
  for (let i = 0; i < layers.length - 1; i++) {
    // Approximate: between column left edges
    const xL = (colX.get(layers[i]) ?? 0) + (layerWidths.get(layers[i]) ?? 0);
    const xR = colX.get(layers[i + 1]) ?? xL + cfg.nodeSpacingX;
    gutters.push(snap((xL + xR) / 2));
  }
  if (layers.length > 0) {
    gutters.unshift(snap((colX.get(layers[0]) ?? cfg.pageMargin) - 24));
    const last = layers[layers.length - 1];
    gutters.push(
      snap((colX.get(last) ?? 0) + (layerWidths.get(last) ?? 0) + 24)
    );
  }

  for (const id of graph.nodeOrder) {
    const n = graph.nodes.get(id)!;
    if (n.role !== "junction") continue;
    const pts: { x: number; y: number }[] = [];
    for (const eid of [...n.inEdges, ...n.outEdges]) {
      const e = graph.edges.find((x) => x.id === eid);
      if (!e) continue;
      const otherId = e.sourceId === id ? e.targetId : e.sourceId;
      if (!otherId) continue;
      const o = graph.nodes.get(otherId);
      if (!o || o.role === "junction") continue;
      pts.push({ x: o.x + o.width / 2, y: o.y + o.height / 2 });
    }
    const ay =
      pts.length === 0
        ? y0
        : pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const ax =
      pts.length === 0
        ? cfg.pageMargin
        : pts.reduce((s, p) => s + p.x, 0) / pts.length;
    // Prefer a gutter near the barycenter X.
    let bestG = gutters[0] ?? snap(ax);
    let bestD = Infinity;
    for (const g of gutters) {
      if (!clearX(g)) continue;
      const d = Math.abs(g - ax);
      if (d < bestD) {
        bestD = d;
        bestG = g;
      }
    }
    if (!clearX(bestG)) {
      for (let d = 8; d < 200; d += 8) {
        if (clearX(ax + d)) {
          bestG = snap(ax + d);
          break;
        }
        if (clearX(ax - d)) {
          bestG = snap(ax - d);
          break;
        }
      }
    }
    n.x = snap(bestG - n.width / 2);
    n.y = snap(ay - n.height / 2);
  }

  resolveOverlaps(graph);

  let maxX = cfg.pageMargin;
  let maxY = cfg.pageMargin;
  for (const id of graph.nodeOrder) {
    const n = graph.nodes.get(id)!;
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }

  return {
    pageWidth: snap(maxX + cfg.pageMargin + 120),
    pageHeight: snap(maxY + cfg.pageMargin + cfg.footerBand + 40),
  };
}

function resolveOverlaps(graph: LogicGraph): void {
  const gap = LAYOUT_CONFIG.minimumNodeGap;
  const ids = graph.nodeOrder.filter((id) => graph.nodes.get(id)!.role !== "junction");

  for (let pass = 0; pass < 10; pass++) {
    let moved = false;
    const sorted = [...ids].sort((a, b) => {
      const na = graph.nodes.get(a)!;
      const nb = graph.nodes.get(b)!;
      return na.y - nb.y || na.x - nb.x || a.localeCompare(b);
    });
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = graph.nodes.get(sorted[i])!;
        const b = graph.nodes.get(sorted[j])!;
        if (a.layer !== b.layer) continue; // only same-column collisions matter for push
        const ax2 = a.x + a.width + gap;
        const ay2 = a.y + a.height + gap;
        const bx2 = b.x + b.width + gap;
        const by2 = b.y + b.height + gap;
        if (a.x < bx2 && ax2 > b.x && a.y < by2 && ay2 > b.y) {
          b.y = snap(ay2);
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}
