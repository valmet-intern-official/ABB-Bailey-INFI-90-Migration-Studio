/**
 * Positional validation of drawn annotations against the vendor plot
 * (validation only — nothing read here feeds the generated model).
 *
 * Per sheet, the expected page is aligned to the generated drawing page by a
 * least-squares affine fit over source text records whose text is unique on
 * both pages. Each annotation (S label, N+k address, caption) is then mapped
 * into expected-page space and classified:
 *   CONFIRMED    the same text is drawn within TOL pt of the mapped anchor
 *   WRONG_TEXT   a different token of the same category sits there instead
 *   MISPLACED    the text exists on the expected page but only farther away
 *   NOT_IN_PLOT  the vendor plot has no such text on that page
 *
 *   npx tsx tools/cad-gap/position-check.mts <expected.pdf> <forensic out dir> [out.json]
 */
import fs from "node:fs";
import path from "node:path";
import { readPdfText, type TextRun } from "./pdf-text.mts";

const [expectedPdf, dir, outFile = path.join(dir, "position_check.json")] = process.argv.slice(2);
const TOL = 3;
const COURIER = 0.6;

type Ann = { kind: string; id: string; text: string; page_xy: [number, number]; layer: string };
type Ent = { id: string; file: string; type: string; text: string | null; page_xy: [number, number] };
const annotations: Ann[] = JSON.parse(fs.readFileSync(path.join(dir, "annotations.json"), "utf8"));
const entities: Ent[] = JSON.parse(fs.readFileSync(path.join(dir, "entities.json"), "utf8"));
const scene = JSON.parse(fs.readFileSync(path.join(dir, "scene_graph.json"), "utf8")) as { sheets: Array<{ file: string; page: number }> };
const terminals: Array<{ id: string; association_method: string }> = JSON.parse(fs.readFileSync(path.join(dir, "terminals.json"), "utf8"));
const methodOf = new Map(terminals.map((t) => [t.id, t.association_method]));

const exp = await readPdfText(expectedPdf);
const expByFile = new Map<string, (typeof exp)[number]>();
for (const p of exp) {
  const r = p.runs.find((x) => /[0-9A-Z]{5,8}\.CAD/i.test(x.text));
  const m = r && /([0-9A-Z]{5,8}\.CAD)/i.exec(r.text);
  if (m) expByFile.set(m[1].toUpperCase(), p);
}

const fileOfAnn = (a: Ann) => a.id.split(":")[0];
const annByFile = new Map<string, Ann[]>();
for (const a of annotations) if (a.kind !== "plot_stamp") annByFile.set(fileOfAnn(a), [...(annByFile.get(fileOfAnn(a)) ?? []), a]);
const textsByFile = new Map<string, Ent[]>();
for (const e of entities) if (e.type === "text" && e.text && e.text.trim().length >= 3) textsByFile.set(e.file, [...(textsByFile.get(e.file) ?? []), e]);

// Tokens of expected runs with their own start x (split on spaces at Courier-like pitch of the run).
type Tok = { text: string; start: [number, number]; end: [number, number] };
function tokens(runs: TextRun[], angle: number): Tok[] {
  const out: Tok[] = [];
  // per-character advance from runs without whitespace (padded runs carry trailing blanks of unknown width)
  const ratios = runs.filter((r) => Math.abs(r.angle - angle) <= 1 && !/\s/.test(r.text) && r.text.length >= 2 && r.h > 0).map((r) => r.w / r.text.length / r.h).sort((p, q) => p - q);
  const advPerH = ratios.length ? ratios[ratios.length >> 1] : 0.6;
  for (const r of runs) {
    if (Math.abs(r.angle - angle) > 1) continue;
    const a = (r.angle * Math.PI) / 180;
    const c = Math.cos(a), s = Math.sin(a);
    const parts = r.text.split(/(\s+)/);
    const per = /\s/.test(r.text) ? advPerH * r.h : r.w / Math.max(1, r.text.length);
    let off = 0;
    for (const p of parts) {
      if (p.trim()) out.push({ text: p, start: [r.x + off * per * c, r.y + off * per * s], end: [r.x + (off + p.length) * per * c, r.y + (off + p.length) * per * s] });
      off += p.length;
    }
  }
  return out;
}

const results: Array<Record<string, unknown>> = [];
const summary: Record<string, Record<string, number>> = {};
const fits: Array<{ file: string; anchors: number; max_residual: number | null }> = [];
for (const sh of scene.sheets) {
  const page = expByFile.get(sh.file.toUpperCase());
  const anns = annByFile.get(sh.file) ?? [];
  if (!page || !anns.length) continue;
  const texts = textsByFile.get(sh.file) ?? [];
  const pairs: Array<{ x: number; y: number; X: number; Y: number; angle: number }> = [];
  for (const t of texts) {
    const s = t.text!.trim();
    if (texts.filter((u) => u.text!.trim() === s).length !== 1) continue;
    const hits = page.runs.filter((r) => r.text.trim() === s);
    if (hits.length !== 1) continue;
    pairs.push({ x: t.page_xy[0], y: t.page_xy[1], X: hits[0].x, Y: hits[0].y, angle: hits[0].angle });
  }
  const angles = new Map<number, number>();
  for (const p of pairs) angles.set(Math.round(p.angle), (angles.get(Math.round(p.angle)) ?? 0) + 1);
  const textAngle = [...angles].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  if (pairs.length < 3) {
    fits.push({ file: sh.file, anchors: pairs.length, max_residual: null });
    continue;
  }
  const ax = lsq(pairs, "X"), ay = lsq(pairs, "Y");
  const map = (x: number, y: number): [number, number] => [ax[0] * x + ax[1] * y + ax[2], ay[0] * x + ay[1] * y + ay[2]];
  const resid = pairs.map((p) => Math.hypot(map(p.x, p.y)[0] - p.X, map(p.x, p.y)[1] - p.Y));
  const maxRes = Math.max(...resid);
  fits.push({ file: sh.file, anchors: pairs.length, max_residual: Math.round(maxRes * 100) / 100 });
  if (maxRes > 2) continue;
  const toks = tokens(page.runs, textAngle);
  for (const a of anns) {
    // S labels are end-anchored, N+k addresses start-anchored, captions either side
    const [X, Y] = map(a.page_xy[0], a.page_xy[1]);
    const same = toks.filter((t) => t.text === a.text);
    const pts = (t: Tok) => (a.kind === "s_label" ? [t.end] : a.kind === "caption" ? [t.start, t.end] : [t.start]);
    const d = (t: Tok) => Math.min(...pts(t).map((p) => Math.hypot(p[0] - X, p[1] - Y)));
    const best = same.map((t) => ({ t, d: d(t) })).sort((p, q) => p.d - q.d)[0];
    // offset to the nearest same-text token, in source units on our page (k = 0.2125875 pt/unit)
    const delta = (() => {
      if (!best) return null;
      const p = pts(best.t).sort((u, v) => Math.hypot(u[0] - X, u[1] - Y) - Math.hypot(v[0] - X, v[1] - Y))[0];
      const det = ax[0] * ay[1] - ax[1] * ay[0];
      const dx = p[0] - ax[2], dy = p[1] - ay[2];
      const ox = (ay[1] * dx - ax[1] * dy) / det, oy = (-ay[0] * dx + ax[0] * dy) / det;
      return [Math.round((ox - a.page_xy[0]) / 0.2125875), Math.round((oy - a.page_xy[1]) / 0.2125875)];
    })();
    let cls: string;
    let other: string | null = null;
    if (best && best.d <= TOL) cls = "CONFIRMED";
    else {
      const re = a.kind === "s_label" ? /^S\d+$/ : a.kind === "sub_block_number" ? /^\d{1,5}$/ : /^[A-Z/]{1,4}$/;
      const near = toks.filter((t) => re.test(t.text)).map((t) => ({ t, d: d(t) })).filter((x) => x.d <= TOL).sort((p, q) => p.d - q.d)[0];
      if (near) { cls = "WRONG_TEXT"; other = near.t.text; }
      else cls = best ? "MISPLACED" : "NOT_IN_PLOT";
    }
    const method = methodOf.get(a.id) ?? null;
    const key = `${a.kind}|${a.layer}${method ? `|${method}` : ""}`;
    summary[key] = summary[key] ?? { CONFIRMED: 0, WRONG_TEXT: 0, MISPLACED: 0, NOT_IN_PLOT: 0 };
    summary[key][cls]++;
    if (cls !== "CONFIRMED") results.push({ file: sh.file, id: a.id, kind: a.kind, text: a.text, layer: a.layer, method, class: cls, expected_text_here: other, nearest_same_text_pt: best ? Math.round(best.d * 100) / 100 : null, delta_source_units: delta });
  }
}

const report = { tolerance_pt: TOL, fits, summary, non_confirmed: results };
fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
console.log(`sheets fitted ${fits.filter((f) => f.max_residual != null && f.max_residual <= 2).length}/${fits.length}; max residual ${Math.max(...fits.map((f) => f.max_residual ?? 0)).toFixed(2)} pt`);
console.table(summary);
console.log(`wrote ${outFile}`);

function lsq(pairs: Array<{ x: number; y: number; X: number; Y: number; angle: number }>, target: "X" | "Y"): number[] {
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const v = [0, 0, 0];
  for (const p of pairs) {
    const r = [p.x, p.y, 1];
    for (let i = 0; i < 3; i++) {
      v[i] += r[i] * p[target];
      for (let j = 0; j < 3; j++) M[i][j] += r[i] * r[j];
    }
  }
  const A = M.map((r, i) => [...r, v[i]]);
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let k = i + 1; k < 3; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
    [A[i], A[p]] = [A[p], A[i]];
    for (let k = 0; k < 3; k++) {
      if (k === i) continue;
      const f = A[k][i] / A[i][i];
      for (let j = i; j < 4; j++) A[k][j] -= f * A[i][j];
    }
  }
  return [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
}
