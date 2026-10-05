import type { Pt } from "./scene";

/**
 * Screen labels for template instances whose artwork is not in the M1 file.
 * The target point stays the instance origin. The label is stepped aside only
 * when it would cover another label, and a leader joins the two.
 */
export interface LabelItem {
  text: string;
  target: Pt;
  objectId: number;
  nodeId: string;
}

export interface PlacedLabel extends LabelItem {
  at: Pt;
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const overlaps = (a: Box, b: Box) => a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;

function boxOf(at: Pt, text: string): Box {
  const w = Math.max(2.4, text.length * 0.62);
  const h = 1.05;
  return { minX: at[0], minY: at[1] - h, maxX: at[0] + w, maxY: at[1] + 0.15 };
}

const holds = (b: Box, p: Pt) => p[0] >= b.minX && p[0] <= b.maxX && p[1] >= b.minY && p[1] <= b.maxY;

/** Tightest drawn shape that contains the point. Page-sized panels are ignored. */
function containerOf(target: Pt, blockers: Box[]): Box | null {
  let best: Box | null = null;
  let area = Infinity;
  for (const b of blockers) {
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    if (w > 35 || h > 28 || w * h < 0.2) continue;
    if (!holds(b, target)) continue;
    if (w * h < area) {
      best = b;
      area = w * h;
    }
  }
  return best;
}

/** Stable, deterministic label positions. Same input always yields the same places. */
export function placeLabels(items: LabelItem[], blockers: Box[] = []): PlacedLabel[] {
  const sorted = [...items].sort((a, b) => b.target[1] - a.target[1] || a.target[0] - b.target[0] || a.objectId - b.objectId);
  const used: Box[] = [];
  const out: PlacedLabel[] = [];
  for (const it of sorted) {
    const host = containerOf(it.target, blockers);
    const w = boxOf([0, 0], it.text).maxX;
    const steps: Pt[] = [];
    if (host) {
      steps.push([host.maxX + 0.45, it.target[1]], [host.minX - w - 0.35, it.target[1]], [it.target[0], host.maxY + 0.35], [it.target[0], host.minY - 1.2]);
    }
    for (const dy of [0.8, 2.1, 3.4, 4.7, 6.0, -1.4, -2.7, -4.0]) {
      for (const dx of [0.45, 3.2, -w - 0.3]) steps.push([it.target[0] + dx, it.target[1] + dy]);
    }
    let at = steps[0];
    for (const c of steps) {
      const box = boxOf(c, it.text);
      if (!used.some((u) => overlaps(u, box))) {
        at = c;
        break;
      }
    }
    used.push(boxOf(at, it.text));
    out.push({ ...it, at });
  }
  return out;
}
