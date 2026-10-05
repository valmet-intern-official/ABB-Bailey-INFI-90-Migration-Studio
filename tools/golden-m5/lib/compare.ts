/**
 * Page-level golden-master comparison. All comparisons run in the Expected
 * page's landscape point space. The new render already lives there; the
 * Tool Output is normalised by a least-squares scale+translation fitted on
 * uniquely matching text anchors, so it is compared fairly "after coordinate
 * normalisation" and the fit residual itself measures lost source geometry.
 */
import type { NormPage, TextRun } from "./oracle";
import type { PdfSegment } from "./pdf";

export const normText = (s: string) => s.replace(/\s+/g, " ").trim();

export interface Affine { sx: number; sy: number; tx: number; ty: number; pairs: number; inliers: number; rms: number }

/**
 * Scale+translation from `from` page space onto `to`, fitted on uniquely
 * matching strings by consensus: strings placed by a glyph layout rather than
 * by source coordinates disagree with the consensus and are excluded instead
 * of biasing the fit. `rms` is over inliers; `inliers / pairs` is reported.
 */
/**
 * Scale+translation mapping the drawing frame of `from` onto that of `to`,
 * where the frame is the bounding box of long straight segments. The frame is
 * library geometry drawn on every page, so it anchors pages whose unique
 * source strings are too few or too clustered for a text fit.
 */
export function frameAffine(from: PdfSegment[], to: PdfSegment[], minLen = 250): Affine | null {
  const box = (ss: PdfSegment[]) => {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const s of ss) {
      if (Math.hypot(s.x2 - s.x1, s.y2 - s.y1) < minLen) continue;
      x1 = Math.min(x1, s.x1, s.x2); x2 = Math.max(x2, s.x1, s.x2);
      y1 = Math.min(y1, s.y1, s.y2); y2 = Math.max(y2, s.y1, s.y2);
    }
    return x2 > x1 && y2 > y1 ? { x1, y1, x2, y2 } : null;
  };
  const a = box(from), b = box(to);
  if (!a || !b) return null;
  const sx = (b.x2 - b.x1) / (a.x2 - a.x1), sy = (b.y2 - b.y1) / (a.y2 - a.y1);
  return { sx, sy, tx: b.x1 - sx * a.x1, ty: b.y1 - sy * a.y1, pairs: 4, inliers: 4, rms: 0 };
}

/** Anchors (unique shared strings) that `f` maps within `tol` of their partner. */
export function textInliers(from: TextRun[], to: TextRun[], f: Affine, anchorsOnly?: Set<string>, tol = 1.5): { pairs: number; inliers: number; rms: number } {
  const uniq = (rs: TextRun[]) => {
    const m = new Map<string, TextRun[]>();
    for (const r of rs) { const k = normText(r.text); if (k.length >= 4 && (!anchorsOnly || anchorsOnly.has(k))) m.set(k, [...(m.get(k) ?? []), r]); }
    return m;
  };
  const a = uniq(from), b = uniq(to);
  let pairs = 0, inliers = 0, se = 0;
  for (const [k, ra] of a) {
    const rb = b.get(k);
    if (ra.length !== 1 || rb?.length !== 1) continue;
    pairs++;
    const d = Math.hypot(f.sx * ra[0].x + f.tx - rb[0].x, f.sy * ra[0].y + f.ty - rb[0].y);
    if (d <= tol) { inliers++; se += d * d; }
  }
  return { pairs, inliers, rms: inliers ? Math.sqrt(se / inliers) : NaN };
}

export function fitAffine(from: TextRun[], to: TextRun[], anchorsOnly?: Set<string>): Affine | null {
  const count = (rs: TextRun[]) => {
    const m = new Map<string, TextRun[]>();
    for (const r of rs) { const k = normText(r.text); if (k.length >= 4) m.set(k, [...(m.get(k) ?? []), r]); }
    return m;
  };
  const a = count(from), b = count(to);
  const all: Array<[TextRun, TextRun]> = [];
  for (const [k, ra] of a) {
    if (anchorsOnly && !anchorsOnly.has(k)) continue;
    const rb = b.get(k);
    if (ra.length === 1 && rb?.length === 1) all.push([ra[0], rb[0]]);
  }
  if (all.length < 3) return null;
  const fit1 = (xs: number[], ys: number[]) => {
    const n = xs.length, mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    const k = den ? num / den : 1;
    return { k, c: my - k * mx };
  };
  // Deterministic consensus seed: every anchor pair (i, j) with enough
  // separation proposes a transform; the proposal with the most anchors
  // agreeing within 1.5 pt wins and is refined by least squares.
  const TOL = 1.5;
  const inliersOf = (sx: number, sy: number, tx: number, ty: number) =>
    all.filter(([p, q]) => Math.hypot(sx * p.x + tx - q.x, sy * p.y + ty - q.y) <= TOL);
  let seed = all;
  const stride = Math.max(1, Math.floor((all.length * all.length) / 6000));
  let tried = 0;
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (tried++ % stride) continue;
      const [pi, qi] = all[i], [pj, qj] = all[j];
      const dx = pj.x - pi.x, dy = pj.y - pi.y;
      if (Math.abs(dx) < 40 || Math.abs(dy) < 25) continue;
      const sx = (qj.x - qi.x) / dx, sy = (qj.y - qi.y) / dy;
      if (!(sx > 0.3 && sx < 3 && sy > 0.3 && sy < 3)) continue;
      const inl = inliersOf(sx, sy, qi.x - sx * pi.x, qi.y - sy * pi.y);
      if (inl.length > (seed === all ? 0 : seed.length)) seed = inl;
    }
  }
  let pairs = seed.length >= 3 ? seed : all;
  let fx = { k: 1, c: 0 }, fy = { k: 1, c: 0 };
  for (let iter = 0; iter < 4; iter++) {
    fx = fit1(pairs.map((p) => p[0].x), pairs.map((p) => p[1].x));
    fy = fit1(pairs.map((p) => p[0].y), pairs.map((p) => p[1].y));
    const keep = inliersOf(fx.k, fy.k, fx.c, fy.c);
    if (keep.length < 3 || keep.length === pairs.length) break;
    pairs = keep;
  }
  let se = 0;
  for (const [p, q] of pairs) se += (fx.k * p.x + fx.c - q.x) ** 2 + (fy.k * p.y + fy.c - q.y) ** 2;
  return { sx: fx.k, sy: fy.k, tx: fx.c, ty: fy.c, pairs: all.length, inliers: pairs.length, rms: Math.sqrt(se / pairs.length) };
}

export function applyAffine(p: NormPage, f: Affine, width: number, height: number): NormPage {
  return {
    ...p,
    width,
    height,
    segments: p.segments.map((s) => ({ ...s, x1: f.sx * s.x1 + f.tx, y1: f.sy * s.y1 + f.ty, x2: f.sx * s.x2 + f.tx, y2: f.sy * s.y2 + f.ty })),
    runs: p.runs.map((r) => ({ ...r, x: f.sx * r.x + f.tx, y: f.sy * r.y + f.ty, size: r.size * Math.abs(f.sy) })),
  };
}

export interface TextDiff {
  expected: number;
  candidate: number;
  /** Expected strings present anywhere on the candidate page (multiset). */
  multisetMatched: number;
  /** Expected strings present at the same place (within tolerance). */
  positionalMatched: number;
  missing: TextRun[];
  extra: Array<{ text: string; x: number; y: number }>;
}

export function compareText(exp: TextRun[], cand: Array<{ text: string; x: number; y: number }>, tol = 2.5): TextDiff {
  const pool = new Map<string, Array<{ text: string; x: number; y: number; used: boolean }>>();
  for (const c of cand) { const k = normText(c.text); if (!k) continue; pool.set(k, [...(pool.get(k) ?? []), { ...c, used: false }]); }
  const multi = new Map<string, number>();
  for (const [k, v] of pool) multi.set(k, v.length);
  let multisetMatched = 0, positionalMatched = 0;
  const missing: TextRun[] = [];
  for (const e of exp) {
    const k = normText(e.text);
    const left = multi.get(k) ?? 0;
    if (left > 0) { multisetMatched++; multi.set(k, left - 1); }
    const cands = pool.get(k) ?? [];
    const hit = cands.find((c) => !c.used && Math.abs(c.x - e.x) <= tol && Math.abs(c.y - e.y) <= tol);
    if (hit) { hit.used = true; positionalMatched++; } else missing.push(e);
  }
  const extra = [...pool.values()].flat().filter((c) => !c.used).map(({ text, x, y }) => ({ text, x, y }));
  return { expected: exp.length, candidate: cand.length, multisetMatched, positionalMatched, missing, extra };
}

/** Length-weighted share of `a`'s ink that lies within `tol` of some segment of `b`. */
export function segmentCoverage(a: PdfSegment[], b: PdfSegment[], tol = 0.8, step = 1): { length: number; covered: number } {
  const CELL = 4;
  const grid = new Map<string, PdfSegment[]>();
  for (const s of b) {
    const x0 = Math.floor((Math.min(s.x1, s.x2) - tol) / CELL), x1 = Math.floor((Math.max(s.x1, s.x2) + tol) / CELL);
    const y0 = Math.floor((Math.min(s.y1, s.y2) - tol) / CELL), y1 = Math.floor((Math.max(s.y1, s.y2) + tol) / CELL);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 40000) continue;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const k = `${x},${y}`; const l = grid.get(k); if (l) l.push(s); else grid.set(k, [s]); }
  }
  const near = (px: number, py: number) => {
    const l = grid.get(`${Math.floor(px / CELL)},${Math.floor(py / CELL)}`);
    if (!l) return false;
    for (const s of l) {
      const vx = s.x2 - s.x1, vy = s.y2 - s.y1, L2 = vx * vx + vy * vy;
      const t = L2 ? Math.max(0, Math.min(1, ((px - s.x1) * vx + (py - s.y1) * vy) / L2)) : 0;
      if (Math.hypot(px - (s.x1 + t * vx), py - (s.y1 + t * vy)) <= tol) return true;
    }
    return false;
  };
  let length = 0, covered = 0;
  for (const s of a) {
    const L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    const n = Math.max(1, Math.ceil(L / step));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const w = L / (n + 1);
      length += w;
      if (near(s.x1 + t * (s.x2 - s.x1), s.y1 + t * (s.y2 - s.y1))) covered += w;
    }
  }
  return { length, covered };
}

/** Flatten a display list's paths and arcs into segments for coverage tests. */
export function itemsToSegments(items: Array<{ t: string; pts?: Array<[number, number]>; closed?: boolean; cx?: number; cy?: number; r?: number; a0?: number; a1?: number; dash?: number[] }>): PdfSegment[] {
  const out: PdfSegment[] = [];
  for (const it of items) {
    if (it.t === "path" && it.pts) {
      const pts = it.closed ? [...it.pts, it.pts[0]] : it.pts;
      for (let i = 1; i < pts.length; i++) out.push({ x1: pts[i - 1][0], y1: pts[i - 1][1], x2: pts[i][0], y2: pts[i][1], dashed: Boolean(it.dash), w: 0.35 });
    } else if (it.t === "arc" && it.r != null) {
      const n = Math.max(2, Math.ceil(Math.abs(it.a1! - it.a0!) / 0.2));
      for (let i = 1; i <= n; i++) {
        const s = it.a0! + ((it.a1! - it.a0!) * (i - 1)) / n, e = it.a0! + ((it.a1! - it.a0!) * i) / n;
        out.push({ x1: it.cx! + it.r * Math.cos(s), y1: it.cy! + it.r * Math.sin(s), x2: it.cx! + it.r * Math.cos(e), y2: it.cy! + it.r * Math.sin(e), dashed: false, w: 0.35 });
      }
    }
  }
  return out;
}

export const TITLE_LABELS = ["CAD FILE NO.", "DRAWING NUMBER", "REV", "DATE", "CUSTOMER", "SUPPLIER", "DESCRIPTION", "S.O. NO.", "JOB ORDER NO.", "S.O. NUMBER", "TYPE", "SIZE", "LOC", "DWN:", "CHK:", "APV:", "REASON FOR CHANGE", "DATE OF CHANGE"];

export function titleElementsPresent(runs: Array<{ text: string }>): number {
  const set = new Set(runs.map((r) => normText(r.text)));
  return TITLE_LABELS.filter((l) => set.has(l)).length;
}
