/**
 * Text layout primitives shared by the engineering PDF and its validation:
 * monospace measurement, cell wrapping, and axis-aligned boxes for overlap
 * and clipping checks.
 */
import { COURIER_ADVANCE, type RenderItem } from "@infi90/cad-engine";

export type Box = [number, number, number, number];

export const boxesIntersect = (a: Box, b: Box, pad = 0) =>
  a[0] < b[2] + pad && b[0] < a[2] + pad && a[1] < b[3] + pad && b[1] < a[3] + pad;

export const insideBox = (inner: Box, outer: Box) =>
  inner[0] >= outer[0] - 1e-6 && inner[1] >= outer[1] - 1e-6 && inner[2] <= outer[2] + 1e-6 && inner[3] <= outer[3] + 1e-6;

export type Segment = [number, number, number, number];

/** Straight segments of the drawn line work (paths and arc chords). */
export function lineSegments(items: RenderItem[]): Segment[] {
  const out: Segment[] = [];
  for (const it of items) {
    if (it.t === "path") {
      for (let i = 1; i < it.pts.length; i++) out.push([it.pts[i - 1][0], it.pts[i - 1][1], it.pts[i][0], it.pts[i][1]]);
      if (it.closed && it.pts.length > 2) out.push([it.pts[it.pts.length - 1][0], it.pts[it.pts.length - 1][1], it.pts[0][0], it.pts[0][1]]);
    } else if (it.t === "arc") {
      const n = Math.max(2, Math.ceil(Math.abs(it.a1 - it.a0) / (Math.PI / 8)));
      for (let i = 0; i < n; i++) {
        const a = it.a0 + ((it.a1 - it.a0) * i) / n, b = it.a0 + ((it.a1 - it.a0) * (i + 1)) / n;
        out.push([it.cx + it.r * Math.cos(a), it.cy + it.r * Math.sin(a), it.cx + it.r * Math.cos(b), it.cy + it.r * Math.sin(b)]);
      }
    }
  }
  return out;
}

/** Whether a segment passes through a box (Liang–Barsky clip). */
export function segmentHitsBox([x1, y1, x2, y2]: Segment, [bx1, by1, bx2, by2]: Box): boolean {
  if (Math.max(x1, x2) < bx1 || Math.min(x1, x2) > bx2 || Math.max(y1, y2) < by1 || Math.min(y1, y2) > by2) return false;
  const dx = x2 - x1, dy = y2 - y1;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, x1 - bx1], [dx, bx2 - x1], [-dy, y1 - by1], [dy, by2 - y1]] as const) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return false;
  }
  return true;
}

/** Axis-aligned box of a text item (Courier advance, baseline at y, descender 0.2 em). */
export function textBox(it: Extract<RenderItem, { t: "text" }>): Box {
  const w = COURIER_ADVANCE * it.size * it.text.length;
  const shift = it.anchor === "end" ? w : it.anchor === "middle" ? w / 2 : 0;
  const a = (it.angle * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const corners: Array<[number, number]> = [
    [-shift, -0.2 * it.size],
    [w - shift, -0.2 * it.size],
    [w - shift, 0.8 * it.size],
    [-shift, 0.8 * it.size],
  ].map(([dx, dy]) => [it.x + dx * c - dy * s, it.y + dx * s + dy * c]);
  const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Wrap text to a column of `width` characters, breaking at spaces where possible. */
export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let rest = para.replace(/\s+/g, " ").trim();
    if (!rest) {
      out.push("");
      continue;
    }
    while (rest.length > width) {
      let cut = rest.lastIndexOf(" ", width);
      if (cut <= 0) cut = width;
      out.push(rest.slice(0, cut).trimEnd());
      rest = rest.slice(cut).trimStart();
    }
    out.push(rest);
  }
  return out.length ? out : [""];
}

/** Text as it will be written to the PDF (WinAnsi printable subset). */
export const pdfSafe = (s: string) => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, "-").replace(/\u2026/g, "...").replace(/[^\x20-\x7e]/g, "?");
