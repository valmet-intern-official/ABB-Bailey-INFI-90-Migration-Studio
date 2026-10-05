import { LAYOUT_CONFIG, snap } from "./config";
import type { RoutingGrid } from "./grid";
import type { LogicGraph } from "./graph";
import { portPoint } from "./ports";

/**
 * Industrial CAD orthogonal router.
 *
 * Vertical travel only in inter-column channels.
 * Horizontal travel only in inter-row gutters (or short port stubs).
 * Never deletes a connection — falls back to outer lanes when blocked.
 */
export function routeOrthogonal(
  grid: RoutingGrid,
  start: { x: number; y: number },
  end: { x: number; y: number }
): { x: number; y: number }[] | null {
  if (approxEq(start.x, end.x) && approxEq(start.y, end.y)) return [start, end];
  if (approxEq(start.x, end.x) || approxEq(start.y, end.y)) {
    const direct = [start, end];
    if (pathClear(grid, direct)) return direct;
  }

  const midX = snap((start.x + end.x) / 2);
  const midY = snap((start.y + end.y) / 2);
  for (const path of [
    [start, { x: end.x, y: start.y }, end],
    [start, { x: start.x, y: end.y }, end],
    [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end],
    [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end],
  ]) {
    if (pathClear(grid, path)) return collapseOrthogonal(path);
  }

  // Lee BFS
  const s = grid.worldToCell(start.x, start.y);
  const t = grid.worldToCell(end.x, end.y);
  const parent = new Map<number, number>();
  const key = (c: number, r: number) => r * grid.cols + c;
  const queue: Array<{ c: number; r: number }> = [s];
  const seen = new Uint8Array(grid.cols * grid.rows);
  seen[key(s.c, s.r)] = 1;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  let found = false;
  let visited = 0;
  const maxVisit = grid.cols * grid.rows;
  while (queue.length > 0 && visited++ < maxVisit) {
    const cur = queue.shift()!;
    if (cur.c === t.c && cur.r === t.r) {
      found = true;
      break;
    }
    for (const [dc, dr] of dirs) {
      const nc = cur.c + dc;
      const nr = cur.r + dr;
      if (!grid.inBounds(nc, nr)) continue;
      const k = key(nc, nr);
      if (seen[k]) continue;
      if (grid.isBlocked(nc, nr) && !(nc === t.c && nr === t.r) && !(nc === s.c && nr === s.r)) {
        continue;
      }
      seen[k] = 1;
      parent.set(k, key(cur.c, cur.r));
      queue.push({ c: nc, r: nr });
    }
  }
  if (!found) return null;

  const cells: Array<{ c: number; r: number }> = [];
  let ck = key(t.c, t.r);
  const sk = key(s.c, s.r);
  while (ck !== sk) {
    cells.push({ c: ck % grid.cols, r: Math.floor(ck / grid.cols) });
    const p = parent.get(ck);
    if (p == null) break;
    ck = p;
  }
  cells.push(s);
  cells.reverse();
  const pts: { x: number; y: number }[] = [start];
  for (const cell of cells) pts.push(grid.cellToWorld(cell.c, cell.r));
  pts.push(end);
  return collapseOrthogonal(pts);
}

function approxEq(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.51;
}

function pathClear(grid: RoutingGrid, pts: { x: number; y: number }[]): boolean {
  for (let i = 0; i < pts.length - 1; i++) {
    if (!segmentClear(grid, pts[i], pts[i + 1])) return false;
  }
  return true;
}

function segmentClear(
  grid: RoutingGrid,
  a: { x: number; y: number },
  b: { x: number; y: number }
): boolean {
  const ca = grid.worldToCell(a.x, a.y);
  const cb = grid.worldToCell(b.x, b.y);
  if (ca.c === cb.c) {
    for (let r = Math.min(ca.r, cb.r) + 1; r < Math.max(ca.r, cb.r); r++) {
      if (grid.isBlocked(ca.c, r)) return false;
    }
    return true;
  }
  if (ca.r === cb.r) {
    for (let c = Math.min(ca.c, cb.c) + 1; c < Math.max(ca.c, cb.c); c++) {
      if (grid.isBlocked(c, ca.r)) return false;
    }
    return true;
  }
  return false;
}

function collapseOrthogonal(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  const forced = forceOrthogonal(pts);
  if (forced.length <= 2) return forced;
  const out: { x: number; y: number }[] = [forced[0]];
  for (let i = 1; i < forced.length - 1; i++) {
    const a = out[out.length - 1];
    const b = forced[i];
    const c = forced[i + 1];
    if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) continue;
    if (b.x === a.x && b.y === a.y) continue;
    out.push(b);
  }
  const last = forced[forced.length - 1];
  if (last.x !== out[out.length - 1].x || last.y !== out[out.length - 1].y) out.push(last);
  return out;
}

function forceOrthogonal(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  if (pts.length < 2) return pts;
  const out: { x: number; y: number }[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    if (a.x === b.x || a.y === b.y) out.push(b);
    else {
      out.push({ x: b.x, y: a.y });
      out.push(b);
    }
  }
  return out;
}

export function fallbackOrthogonalRoute(
  start: { x: number; y: number },
  end: { x: number; y: number },
  preferOuterY?: number
): { x: number; y: number }[] {
  if (start.x === end.x || start.y === end.y) return [start, end];
  if (preferOuterY != null) {
    return [start, { x: start.x, y: preferOuterY }, { x: end.x, y: preferOuterY }, end];
  }
  const midX = snap((start.x + end.x) / 2);
  return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
}

interface Channels {
  vertical: number[];
  horizontal: number[];
}

function computeChannels(graph: LogicGraph): Channels {
  const byLayer = new Map<number, { minX: number; maxX: number }>();
  const blocks: Array<{ x: number; y: number; w: number; h: number }> = [];
  const ys: number[] = [];
  for (const id of graph.nodeOrder) {
    const n = graph.nodes.get(id)!;
    if (n.role === "junction") continue;
    const cur = byLayer.get(n.layer) ?? { minX: n.x, maxX: n.x + n.width };
    cur.minX = Math.min(cur.minX, n.x);
    cur.maxX = Math.max(cur.maxX, n.x + n.width);
    byLayer.set(n.layer, cur);
    ys.push(n.y, n.y + n.height);
    blocks.push({ x: n.x, y: n.y, w: n.width, h: n.height });
  }

  const clearX = (x: number) =>
    blocks.every((b) => x <= b.x - 2 || x >= b.x + b.w + 2);
  const clearY = (y: number) =>
    blocks.every((b) => y <= b.y - 2 || y >= b.y + b.h + 2);

  const layers = [...byLayer.keys()].sort((a, b) => a - b);
  const vertical: number[] = [];
  for (let i = 0; i < layers.length - 1; i++) {
    const left = byLayer.get(layers[i])!;
    const right = byLayer.get(layers[i + 1])!;
    const mid = snap((left.maxX + right.minX) / 2);
    // Search nearby for a clear X if midpoint clips a block.
    let found = mid;
    for (let d = 0; d <= 40; d += 4) {
      if (clearX(mid + d)) {
        found = mid + d;
        break;
      }
      if (clearX(mid - d)) {
        found = mid - d;
        break;
      }
    }
    if (clearX(found)) vertical.push(found);
  }
  if (layers.length > 0) {
    const first = byLayer.get(layers[0])!;
    const last = byLayer.get(layers[layers.length - 1])!;
    for (const cand of [
      snap(first.minX - LAYOUT_CONFIG.verticalLaneSpacing * 3),
      snap(last.maxX + LAYOUT_CONFIG.verticalLaneSpacing * 3),
    ]) {
      if (clearX(cand)) vertical.push(cand);
      else {
        for (let d = 4; d <= 48; d += 4) {
          if (clearX(cand - d)) {
            vertical.push(cand - d);
            break;
          }
          if (clearX(cand + d)) {
            vertical.push(cand + d);
            break;
          }
        }
      }
    }
  }
  vertical.sort((a, b) => a - b);

  const edges = [...new Set(ys.map((v) => snap(v)))].sort((a, b) => a - b);
  const horizontal: number[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const gap = edges[i + 1] - edges[i];
    if (gap < LAYOUT_CONFIG.minimumNodeGap) continue;
    const mid = snap(edges[i] + gap / 2);
    if (clearY(mid)) horizontal.push(mid);
    else {
      for (let d = 0; d < gap / 2; d += 4) {
        if (clearY(mid + d)) {
          horizontal.push(mid + d);
          break;
        }
        if (clearY(mid - d)) {
          horizontal.push(mid - d);
          break;
        }
      }
    }
  }
  if (edges.length > 0) {
    for (const cand of [
      snap(edges[0] - LAYOUT_CONFIG.horizontalLaneSpacing * 2),
      snap(edges[edges.length - 1] + LAYOUT_CONFIG.horizontalLaneSpacing * 2),
    ]) {
      if (clearY(cand)) horizontal.push(cand);
    }
  }
  horizontal.sort((a, b) => a - b);

  return { vertical, horizontal };
}

function nearest(values: number[], target: number): number {
  if (values.length === 0) return snap(target);
  let best = values[0];
  let bestD = Math.abs(values[0] - target);
  for (const v of values) {
    const d = Math.abs(v - target);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}

function exitChannel(channels: number[], fromX: number, towardX: number): number {
  const goingRight = towardX >= fromX;
  const candidates = channels.filter((c) => (goingRight ? c > fromX + 2 : c < fromX - 2));
  if (candidates.length === 0) return nearest(channels, fromX);
  // Closest channel in the travel direction.
  candidates.sort((a, b) => Math.abs(a - fromX) - Math.abs(b - fromX));
  return candidates[0];
}

function channelRoute(
  start: { x: number; y: number },
  end: { x: number; y: number },
  channels: Channels,
  laneSlot: number,
  grid: RoutingGrid
): { x: number; y: number }[] | null {
  const vCh = channels.vertical;
  const hCh = channels.horizontal;
  if (vCh.length === 0) return null;

  const outCh = exitChannel(vCh, start.x, end.x);
  const inCh = exitChannel(vCh, end.x, start.x);

  // Prefer a horizontal gutter near the midpoint, with lane offsets for parallels.
  const midY = (start.y + end.y) / 2;
  const gutterCandidates = [...hCh].sort(
    (a, b) => Math.abs(a - midY) - Math.abs(b - midY) || a - b
  );

  for (let gi = 0; gi < Math.min(8, gutterCandidates.length); gi++) {
    const g =
      gutterCandidates[gi] +
      ((laneSlot % 5) - 2) * (LAYOUT_CONFIG.horizontalLaneSpacing / 2);
    const gy = snap(g);

    // Same exit/entry channel (adjacent layers or shared gutter column):
    if (approxEq(outCh, inCh)) {
      const path = [
        start,
        { x: outCh, y: start.y },
        { x: outCh, y: end.y },
        end,
      ];
      if (pathClear(grid, path)) return path;
    }

    // Full: stub → outCh → gutter → inCh → stub
    const path = [
      start,
      { x: outCh, y: start.y },
      { x: outCh, y: gy },
      { x: inCh, y: gy },
      { x: inCh, y: end.y },
      end,
    ];
    if (pathClear(grid, path)) return collapseOrthogonal(path);
  }

  // Try direct shared channel without gutter.
  const midCh = nearest(
    vCh.filter((c) => c > Math.min(start.x, end.x) && c < Math.max(start.x, end.x)),
    (start.x + end.x) / 2
  );
  const simple = [
    start,
    { x: midCh, y: start.y },
    { x: midCh, y: end.y },
    end,
  ];
  if (pathClear(grid, simple)) return simple;

  return null;
}

export function routeAllConnections(
  graph: LogicGraph,
  grid: RoutingGrid,
  pageHeight: number
): void {
  const channels = computeChannels(graph);
  const edges = [...graph.edges]
    .filter((e) => e.sourceId || e.targetId)
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  let laneSlot = 0;

  for (const e of edges) {
    if (!e.sourceId || !e.targetId) {
      e.waypoints = geometryToWaypoints(e.connection.geometry);
      continue;
    }

    const sNode = graph.nodes.get(e.sourceId)!;
    const tNode = graph.nodes.get(e.targetId)!;
    const start = portPoint(sNode, e.sourcePortSide, e.sourcePortOffset || sNode.height / 2);
    const end = portPoint(tNode, e.targetPortSide, e.targetPortOffset || tNode.height / 2);

    let path: { x: number; y: number }[] | null = null;

    if (e.isFeedback) {
      const localY = snap(
        Math.max(sNode.y + sNode.height, tNode.y + tNode.height) +
          LAYOUT_CONFIG.horizontalLaneSpacing * (2 + (laneSlot % 6))
      );
      // Prefer bottom gutter
      const gy = nearest(channels.horizontal, localY);
      const leftCh = Math.min(...channels.vertical);
      path = [
        start,
        { x: start.x, y: gy },
        { x: leftCh, y: gy },
        { x: leftCh, y: end.y },
        end,
      ];
      if (!pathClear(grid, path)) {
        path = [start, { x: start.x, y: gy }, { x: end.x, y: gy }, end];
      }
    } else {
      path = channelRoute(start, end, channels, laneSlot, grid);
    }

    if (!path) {
      const openedS = grid.openPortWindow(start.x, start.y, 2);
      const openedT = grid.openPortWindow(end.x, end.y, 2);
      path = routeOrthogonal(grid, start, end);
      grid.restoreBlocked(openedS);
      grid.restoreBlocked(openedT);
    }

    if (!path) {
      const outer = snap(pageHeight - LAYOUT_CONFIG.pageMargin - (laneSlot % 10) * 8);
      path = fallbackOrthogonalRoute(start, end, outer);
    }

    e.waypoints = collapseOrthogonal(path);
    for (let i = 0; i < e.waypoints.length - 1; i++) {
      stampSegment(grid, e.waypoints[i], e.waypoints[i + 1]);
    }
    laneSlot++;
  }

  // Repair pass: detour any remaining wire-through segments around block bodies.
  repairWireThrough(graph, channels);
}

function repairWireThrough(graph: LogicGraph, channels: Channels): void {
  const boxes = [...graph.nodes.values()]
    .filter((n) => n.role !== "junction")
    .map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.width, h: n.height }));

  const hits = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    skipA?: string,
    skipB?: string
  ) => {
    for (const b of boxes) {
      if (b.id === skipA || b.id === skipB) continue;
      const pad = 4;
      const rx1 = b.x + pad;
      const ry1 = b.y + pad;
      const rx2 = b.x + b.w - pad;
      const ry2 = b.y + b.h - pad;
      if (rx2 <= rx1 || ry2 <= ry1) continue;
      if (Math.abs(y1 - y2) < 0.51) {
        if (y1 > ry1 && y1 < ry2) {
          const lo = Math.min(x1, x2);
          const hi = Math.max(x1, x2);
          if (Math.min(hi, rx2) - Math.max(lo, rx1) > 10) return b;
        }
      } else if (Math.abs(x1 - x2) < 0.51) {
        if (x1 > rx1 && x1 < rx2) {
          const lo = Math.min(y1, y2);
          const hi = Math.max(y1, y2);
          if (Math.min(hi, ry2) - Math.max(lo, ry1) > 10) return b;
        }
      }
    }
    return null;
  };

  for (const e of graph.edges) {
    if (e.waypoints.length < 2) continue;
    const repaired: { x: number; y: number }[] = [e.waypoints[0]];
    for (let i = 0; i < e.waypoints.length - 1; i++) {
      const a = repaired[repaired.length - 1];
      const b = e.waypoints[i + 1];
      const hit = hits(a.x, a.y, b.x, b.y, e.sourceId, e.targetId);
      if (!hit) {
        repaired.push(b);
        continue;
      }
      // Detour via nearest clear channel around the hit box.
      if (Math.abs(a.x - b.x) < 0.51) {
        // Vertical segment through a box — dogleg via side gutter.
        const side =
          nearest(
            channels.vertical.filter((x) => x < hit.x - 2 || x > hit.x + hit.w + 2),
            a.x
          ) || snap(hit.x + hit.w + 16);
        repaired.push({ x: side, y: a.y });
        repaired.push({ x: side, y: b.y });
        repaired.push(b);
      } else {
        // Horizontal through a box — dogleg via above/below gutter.
        const side =
          nearest(
            channels.horizontal.filter((y) => y < hit.y - 2 || y > hit.y + hit.h + 2),
            a.y
          ) || snap(hit.y + hit.h + 16);
        repaired.push({ x: a.x, y: side });
        repaired.push({ x: b.x, y: side });
        repaired.push(b);
      }
    }
    e.waypoints = collapseOrthogonal(repaired);
  }
}

function geometryToWaypoints(
  geometry: { x1: number; y1: number; x2: number; y2: number }[]
): { x: number; y: number }[] {
  if (geometry.length === 0) return [];
  const pts = [{ x: geometry[0].x1, y: geometry[0].y1 }];
  for (const s of geometry) pts.push({ x: s.x2, y: s.y2 });
  return forceOrthogonal(pts);
}

function stampSegment(
  grid: RoutingGrid,
  a: { x: number; y: number },
  b: { x: number; y: number }
): void {
  const ca = grid.worldToCell(a.x, a.y);
  const cb = grid.worldToCell(b.x, b.y);
  if (ca.c === cb.c) {
    for (let r = Math.min(ca.r, cb.r); r <= Math.max(ca.r, cb.r); r++) grid.addCongestion(ca.c, r);
  } else if (ca.r === cb.r) {
    for (let c = Math.min(ca.c, cb.c); c <= Math.max(ca.c, cb.c); c++) grid.addCongestion(c, ca.r);
  }
}

export function waypointsToGeometry(
  pts: { x: number; y: number }[]
): { x1: number; y1: number; x2: number; y2: number }[] {
  const segs: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a.x === b.x && a.y === b.y) continue;
    segs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }
  return segs;
}
