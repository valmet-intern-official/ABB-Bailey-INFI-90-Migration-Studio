/** Fit source->Expected page transform per sheet and relate it to source extents. */
import path from "node:path";
import { decodeRecordStream } from "../../packages/cad-engine/src/index";
import { loadContext, TEST } from "./lib/context";
import { readPdf } from "./lib/pdf";
import { normalizePage } from "./lib/oracle";

const ctx = loadContext();
const pages = readPdf(path.join(TEST, "Expected Output.pdf")).map((p) => normalizePage(p, 90));
const byName = new Map(pages.map((p) => [p.cadName, p]));
const rows: string[] = [];
const stats = new Map<string, number>();
for (const f of ctx.cads) {
  const p = byName.get(f.name);
  if (!p) continue;
  const recs = decodeRecordStream(f.data).records;
  const texts = recs.filter((r) => r.kind === "text" && r.text && r.rotation === 0);
  const pairs: Array<[number, number, number, number]> = [];
  for (const r of texts) {
    const hits = p.runs.filter((x) => x.text === r.text!.trim());
    if (hits.length === 1) pairs.push([r.x1, r.y1, hits[0].x, hits[0].y]);
  }
  if (pairs.length < 3) { rows.push(`${f.name} too few pairs`); continue; }
  const fit = (i: number, j: number) => {
    const n = pairs.length, xs = pairs.map((q) => q[i]), ys = pairs.map((q) => q[j]);
    const mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
    let num = 0, den = 0;
    for (let k = 0; k < n; k++) { num += (xs[k] - mx) * (ys[k] - my); den += (xs[k] - mx) ** 2; }
    return { k: num / den, c: my - (num / den) * mx };
  };
  const fx = fit(0, 2), fy = fit(1, 3);
  // Source extent: every coordinate a record carries (symbols bbox, polyline vertices, text boxes).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of recs) {
    const xs = r.kind === "polyline" || r.kind === "primitive2" || r.kind === "primitive3" ? r.points.map((q) => q.x) : [r.x1, r.x2];
    const ys = r.kind === "polyline" || r.kind === "primitive2" || r.kind === "primitive3" ? r.points.map((q) => q.y) : [r.y1, r.y2];
    for (const x of xs) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    for (const y of ys) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  }
  const pxMin = fx.k * minX + fx.c, pxMax = fx.k * maxX + fx.c, pyMin = fy.k * minY + fy.c, pyMax = fy.k * maxY + fy.c;
  const key = `k=${fx.k.toFixed(4)},${fy.k.toFixed(4)}`;
  stats.set(key, (stats.get(key) ?? 0) + 1);
  rows.push(`${f.name} n=${pairs.length} kx=${fx.k.toFixed(5)} ky=${fy.k.toFixed(5)} ox=${fx.c.toFixed(2)} oy=${fy.c.toFixed(2)} ext=(${minX},${minY})-(${maxX},${maxY}) page ext x ${pxMin.toFixed(1)}..${pxMax.toFixed(1)} (c ${((pxMin + pxMax) / 2).toFixed(1)}) y ${pyMin.toFixed(1)}..${pyMax.toFixed(1)} (c ${((pyMin + pyMax) / 2).toFixed(1)})`);
}
console.log([...stats].sort((a, b) => b[1] - a[1]).slice(0, 8));
console.log(rows.filter((r) => !/ox=-169\.7\d oy=-148\.8\d/.test(r)).slice(0, 30).join("\n"));
console.log(`sheets with the standard offset: ${rows.filter((r) => /ox=-169\.7\d oy=-148\.8\d/.test(r)).length}/${rows.length}`);
console.log(rows.slice(0, 3).join("\n"));
