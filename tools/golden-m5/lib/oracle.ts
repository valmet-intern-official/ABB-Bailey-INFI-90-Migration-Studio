/**
 * Oracle page normalisation: bring a parsed PDF page into its displayed,
 * landscape orientation (origin bottom-left, Y up) and merge per-character
 * text shows into runs, so pages from different producers compare directly.
 */
import type { PdfPage, PdfSegment } from "./pdf";

export interface TextRun { x: number; y: number; size: number; text: string; angle: number; x2: number }
export interface NormPage {
  index: number;
  width: number;
  height: number;
  segments: PdfSegment[];
  curves: number;
  paintedPaths: number;
  runs: TextRun[];
  /** CAD filename stamped on the page, when present. */
  cadName?: string;
}

export function normalizePage(p: PdfPage, rotate: 0 | 90): NormPage {
  const W = p.width;
  const tx = (x: number, y: number) => (rotate === 90 ? { x: y, y: W - x } : { x, y });
  const segments = p.segments.map((s) => {
    const a = tx(s.x1, s.y1);
    const b = tx(s.x2, s.y2);
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, dashed: s.dashed, w: s.w };
  });
  const chars = p.texts.map((t) => {
    const o = tx(t.x, t.y);
    return { x: o.x, y: o.y, size: t.size, angle: ((t.angle - rotate) % 360 + 360) % 360, text: t.text };
  });
  // Merge consecutive shows that continue the same baseline at the Courier
  // advance. Stream order is preserved; nothing is reordered spatially.
  const runs: TextRun[] = [];
  let cur: TextRun | null = null;
  for (const c of chars) {
    const adv = 0.6 * c.size;
    if (
      cur &&
      c.angle === cur.angle &&
      Math.abs(c.size - cur.size) < 0.05 &&
      // Glyph-by-glyph producers place the next glyph exactly one advance on;
      // a looser tolerance would fuse separate source strings such as 'P' 'B'.
      (c.angle === 0
        ? Math.abs(c.y - cur.y) < 0.3 && Math.abs(c.x - cur.x2) < adv * 0.3
        : Math.abs(c.x - cur.x) < 0.3 && Math.abs(c.y - cur.x2) < adv * 0.3)
    ) {
      cur.text += c.text;
      cur.x2 = (c.angle === 0 ? c.x : c.y) + adv * c.text.length;
      continue;
    }
    if (cur) runs.push(cur);
    cur = { x: c.x, y: c.y, size: c.size, angle: c.angle, text: c.text, x2: (c.angle === 0 ? c.x : c.y) + adv * c.text.length };
  }
  if (cur) runs.push(cur);
  // Split runs on wide internal gaps is unnecessary: gaps break the merge.
  const trimmed = runs
    .map((r) => {
      const lead = r.text.length - r.text.trimStart().length;
      const adv = 0.6 * r.size;
      return { ...r, x: r.angle === 0 ? r.x + lead * adv : r.x, y: r.angle === 0 ? r.y : r.y + lead * adv, text: r.text.trim() };
    })
    .filter((r) => r.text.length > 0);
  const cadName = trimmed.map((r) => /([0-9A-Z]{8})\.CAD/i.exec(r.text)?.[1]).find(Boolean);
  const width = rotate === 90 ? p.height : p.width;
  const height = rotate === 90 ? p.width : p.height;
  return { index: p.index, width, height, segments, curves: p.curves, paintedPaths: p.paintedPaths, runs: trimmed, cadName: cadName ? `${cadName.toUpperCase()}.CAD` : undefined };
}
