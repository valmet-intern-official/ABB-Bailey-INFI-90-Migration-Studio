import type { DrawOp, Layout } from "../render/layout";
import type { Pt } from "../scene/scene";
import type { RefMapping } from "./align";

export interface OwnerLayer {
  width: number;
  height: number;
  /** Index into `layers` of the topmost op covering each pixel, or −1. */
  owner: Int32Array;
  layers: { op: Extract<DrawOp, { op: "path" }>; part: "fill" | "stroke" }[];
}

function fillPolygon(pts: Pt[], W: number, H: number, cb: (x: number, y: number) => void) {
  if (pts.length < 3) return;
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  const y0 = Math.max(0, Math.ceil(minY - 0.5));
  const y1 = Math.min(H - 1, Math.floor(maxY - 0.5));
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if ((a[1] <= cy && b[1] > cy) || (b[1] <= cy && a[1] > cy)) xs.push(a[0] + ((cy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
      const xb = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = xa; x <= xb; x++) cb(x, y);
    }
  }
}

function strokePolyline(pts: Pt[], closed: boolean, width: number, W: number, H: number, cb: (x: number, y: number) => void) {
  const r = Math.max(0, Math.floor(width / 2));
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))));
    for (let s = 0; s <= steps; s++) {
      const x = Math.floor(a[0] + ((b[0] - a[0]) * s) / steps);
      const y = Math.floor(a[1] + ((b[1] - a[1]) * s) / steps);
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const X = x + dx, Y = y + dy;
          if (X >= 0 && Y >= 0 && X < W && Y < H) cb(X, Y);
        }
    }
  }
}

/** Rasterise path ops in draw order into reference-pixel space. */
export function buildOwnership(layout: Layout, mapping: RefMapping, W: number, H: number): OwnerLayer {
  const k = mapping.s / layout.scale;
  const toRef = ([x, y]: Pt): Pt => [mapping.x0 + x * k, mapping.y0 + y * k];
  const owner = new Int32Array(W * H).fill(-1);
  const layers: OwnerLayer["layers"] = [];
  for (const op of layout.ops) {
    if (op.op !== "path") continue;
    const pts = op.points.map(toRef);
    if (op.fill && op.closed) {
      const id = layers.push({ op, part: "fill" }) - 1;
      fillPolygon(pts, W, H, (x, y) => (owner[y * W + x] = id));
    }
    if (op.stroke) {
      const id = layers.push({ op, part: "stroke" }) - 1;
      strokePolyline(pts, op.closed, op.strokeWidth * k, W, H, (x, y) => (owner[y * W + x] = id));
    }
  }
  return { width: W, height: H, owner, layers };
}
