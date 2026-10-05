/**
 * Positioned text + vector-op census for any PDF, via pdf.js.
 *
 * Text items are merged into runs: consecutive items on the same baseline
 * whose gap is under half a glyph are joined, so per-glyph emitters (the
 * vendor plot writes one glyph per show operator) yield whole strings.
 */
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

export interface TextRun {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
}

export interface PageCensus {
  page: number;
  width: number;
  height: number;
  rotate: number;
  runs: TextRun[];
  rawItems: number;
  ops: { lines: number; curves: number; rects: number; strokes: number; fills: number; images: number; texts: number };
}

export async function readPdfText(file: string, opts: { maxPages?: number } = {}): Promise<PageCensus[]> {
  const data = new Uint8Array(await (await import("node:fs/promises")).readFile(file));
  const doc = await pdfjs.getDocument({ data, verbosity: 0, disableFontFace: true, useSystemFonts: false }).promise;
  const OPS = pdfjs.OPS as Record<string, number>;
  const out: PageCensus[] = [];
  const n = Math.min(doc.numPages, opts.maxPages ?? Infinity);
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent({ includeMarkedContent: false, disableNormalization: true });
    type Item = { str: string; transform: number[]; width: number; height: number };
    const items = (tc.items as Item[]).filter((it) => typeof it.str === "string");
    const runs: TextRun[] = [];
    let cur: (TextRun & { ex: number; ey: number; dx: number; dy: number }) | null = null;
    for (const it of items) {
      const [a, b, , , e, f] = it.transform;
      const size = Math.hypot(a, b) || it.height || 1;
      const angle = Math.round((Math.atan2(b, a) * 180) / Math.PI);
      const dx = Math.cos((angle * Math.PI) / 180);
      const dy = Math.sin((angle * Math.PI) / 180);
      if (!it.str) continue;
      if (cur && cur.angle === angle) {
        const along = (e - cur.ex) * dx + (f - cur.ey) * dy;
        const across = Math.abs(-(e - cur.ex) * dy + (f - cur.ey) * dx);
        if (across < size * 0.3 && along > -size * 0.3 && along < size * 0.55) {
          if (along > size * 0.35) cur.text += " ";
          cur.text += it.str;
          cur.ex = e + it.width * dx;
          cur.ey = f + it.width * dy;
          cur.w += it.width + Math.max(0, along);
          continue;
        }
      }
      if (cur) runs.push(strip(cur));
      cur = { text: it.str, x: e, y: f, w: it.width, h: size, angle, ex: e + it.width * dx, ey: f + it.width * dy, dx, dy };
    }
    if (cur) runs.push(strip(cur));

    const ol = await page.getOperatorList();
    const ops = { lines: 0, curves: 0, rects: 0, strokes: 0, fills: 0, images: 0, texts: 0 };
    for (let k = 0; k < ol.fnArray.length; k++) {
      const fn = ol.fnArray[k];
      if (fn === OPS.constructPath) {
        const args = ol.argsArray[k] as unknown[];
        const sub = args[0];
        if (Array.isArray(sub) || ArrayBuffer.isView(sub)) {
          for (const op of sub as ArrayLike<number>) {
            if (op === OPS.lineTo) ops.lines++;
            else if (op === OPS.curveTo || op === OPS.curveTo2 || op === OPS.curveTo3) ops.curves++;
            else if (op === OPS.rectangle) ops.rects++;
          }
        }
        const paint = typeof args[0] === "number" ? (args[0] as number) : null;
        if (paint === OPS.stroke || paint === OPS.closeStroke) ops.strokes++;
        if (paint === OPS.fill || paint === OPS.eoFill) ops.fills++;
      } else if (fn === OPS.stroke || fn === OPS.closeStroke) ops.strokes++;
      else if (fn === OPS.fill || fn === OPS.eoFill || fn === OPS.fillStroke) ops.fills++;
      else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) ops.images++;
      else if (fn === OPS.showText || fn === OPS.showSpacedText) ops.texts++;
    }
    out.push({ page: i, width: vp.width, height: vp.height, rotate: page.rotate, runs, rawItems: items.length, ops });
    page.cleanup();
  }
  await doc.destroy();
  return out;
}

function strip(r: TextRun & Record<string, unknown>): TextRun {
  return { text: r.text, x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h), angle: r.angle };
}
const round = (v: number) => Math.round(v * 100) / 100;
