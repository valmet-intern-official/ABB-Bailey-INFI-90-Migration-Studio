/**
 * Oracle pages -> SVG -> PNG, and ink-mask comparison.
 *
 * All pages are drawn into one common canvas in landscape page points so a
 * new render and an oracle page can be compared pixel-for-pixel.
 */
import sharp from "sharp";
import type { NormPage } from "./oracle";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Comparison masks use one stroke width for every page set, wide enough that
 * a sub-point shift cannot decide whether an antialiased line counts as ink.
 */
export const MASK_STROKE = 0.9;

export function oracleSvg(p: NormPage, opts: { text?: boolean; strokeWidth?: number } = {}): string {
  const H = p.height;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${p.width}" height="${H}" viewBox="0 0 ${p.width} ${H}">`);
  parts.push(`<rect width="100%" height="100%" fill="#fff"/>`);
  parts.push(`<g stroke="#000" stroke-width="${opts.strokeWidth ?? 0.35}" fill="none" stroke-linecap="round">`);
  for (const s of p.segments) {
    parts.push(`<line x1="${s.x1.toFixed(2)}" y1="${(H - s.y1).toFixed(2)}" x2="${s.x2.toFixed(2)}" y2="${(H - s.y2).toFixed(2)}"${s.dashed ? ` stroke-dasharray="2,1.5"` : ""}/>`);
  }
  parts.push(`</g>`);
  if (opts.text !== false) {
    parts.push(`<g font-family="Courier New, Courier, monospace" fill="#000">`);
    for (const r of p.runs) {
      const rot = r.angle ? ` transform="rotate(${-r.angle} ${r.x.toFixed(2)} ${(H - r.y).toFixed(2)})"` : "";
      parts.push(`<text x="${r.x.toFixed(2)}" y="${(H - r.y).toFixed(2)}" font-size="${r.size.toFixed(2)}"${rot}>${esc(r.text)}</text>`);
    }
    parts.push(`</g>`);
  }
  parts.push(`</svg>`);
  return parts.join("\n");
}

export async function svgToPng(svg: string, file: string, scale = 2): Promise<void> {
  await sharp(Buffer.from(svg), { density: 72 * scale }).png().toFile(file);
}

/** Binary ink mask (true = dark pixel) at a fixed raster size. */
export async function inkMask(svg: string, width: number, height: number): Promise<Uint8Array> {
  const { data, info } = await sharp(Buffer.from(svg), { density: 144 })
    .resize(width, height, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const mask = new Uint8Array(info.width * info.height);
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * info.channels] < 160 ? 1 : 0;
  return mask;
}

export function dilate(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy >= 0 && yy < h && xx >= 0 && xx < w) out[yy * w + xx] = 1;
        }
    }
  return out;
}

/**
 * Tolerance-aware ink comparison. Precision: share of candidate ink lying
 * within `r` px of reference ink; recall: share of reference ink lying within
 * `r` px of candidate ink; F1 combines them. IoU is the strict overlap.
 */
export function compareMasks(ref: Uint8Array, cand: Uint8Array, w: number, h: number, r = 2) {
  const refD = dilate(ref, w, h, r);
  const candD = dilate(cand, w, h, r);
  let refInk = 0, candInk = 0, candHit = 0, refHit = 0, inter = 0, union = 0;
  for (let i = 0; i < ref.length; i++) {
    if (ref[i]) { refInk++; if (candD[i]) refHit++; }
    if (cand[i]) { candInk++; if (refD[i]) candHit++; }
    if (ref[i] && cand[i]) inter++;
    if (ref[i] || cand[i]) union++;
  }
  const precision = candInk ? candHit / candInk : 0;
  const recall = refInk ? refHit / refInk : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { refInk, candInk, precision, recall, f1, iou: union ? inter / union : 0 };
}
