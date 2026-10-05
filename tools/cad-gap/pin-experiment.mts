/**
 * Placement experiment (validation only): for a set of sheets, align the
 * expected plot to source coordinates through tokens both PDFs share, then
 * report where the vendor drew each S label relative to the block insertion
 * point, next to the CAD pin template and the manual symbol label layout.
 */
import fs from "node:fs";
import path from "node:path";
import { reconstructModule } from "../../packages/cad-engine/src/reconstruct/pipeline.ts";
import { pageTransform } from "../../packages/cad-engine/src/reconstruct/render.ts";
import { getFunctionCode } from "../../packages/function-codes/src/index.ts";
import { readPdfText } from "./pdf-text.mts";

const [expectedPdf, extractDir, ...sheetNames] = process.argv.slice(2);
const walk = (d: string): string[] =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.cad$/i.test(e.name) ? [path.join(d, e.name)] : []));
const all = walk(extractDir).sort();
const cads = all.map((p) => ({ name: path.basename(p), data: fs.readFileSync(p) }));
const rec = reconstructModule({ cads, extractDir });
const exp = await readPdfText(expectedPdf);

for (const want of sheetNames) {
  const sheet = rec.sheets.find((s) => s.filename.toUpperCase() === want.toUpperCase())!;
  const page = exp.find((p) => p.runs.some((r) => r.text.toUpperCase().includes(want.toUpperCase())))!;
  const tf = pageTransform(sheet.drawing);
  // anchors: source text records with unique text on both sides
  const src = sheet.drawing.texts.filter((t) => t.text.trim().length >= 4);
  const pairs: Array<{ sx: number; sy: number; ex: number; ey: number }> = [];
  for (const t of src) {
    const txt = t.text.trim();
    if (src.filter((u) => u.text.trim() === txt).length !== 1) continue;
    const hits = page.runs.filter((r) => r.text.trim() === txt);
    if (hits.length !== 1) continue;
    pairs.push({ sx: t.bbox.x1, sy: t.bbox.y1, ex: hits[0].x, ey: hits[0].y });
  }
  // fit expected = A * source + b (6-param affine, least squares)
  const fit = (target: "ex" | "ey") => {
    // normal equations for [sx, sy, 1]
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const v = [0, 0, 0];
    for (const p of pairs) {
      const r = [p.sx, p.sy, 1];
      for (let i = 0; i < 3; i++) {
        v[i] += r[i] * p[target];
        for (let j = 0; j < 3; j++) M[i][j] += r[i] * r[j];
      }
    }
    return solve3(M, v);
  };
  const ax = fit("ex"), ay = fit("ey");
  const toExp = (x: number, y: number) => [ax[0] * x + ax[1] * y + ax[2], ay[0] * x + ay[1] * y + ay[2]];
  // inverse
  const det = ax[0] * ay[1] - ax[1] * ay[0];
  const toSrc = (X: number, Y: number) => {
    const dx = X - ax[2], dy = Y - ay[2];
    return [(ay[1] * dx - ax[1] * dy) / det, (-ay[0] * dx + ax[0] * dy) / det];
  };
  const resid = pairs.map((p) => Math.hypot(toExp(p.sx, p.sy)[0] - p.ex, toExp(p.sx, p.sy)[1] - p.ey));
  console.log(`\n=== ${want} expected p${page.page} anchors=${pairs.length} maxResid=${Math.max(...resid).toFixed(2)}pt scale=${Math.hypot(ax[0], ay[0]).toFixed(5)} pt/unit (current ${tf.k})`);
  for (const b of sheet.drawing.functionBlocks) {
    if (b.functionCode == null) continue;
    const schema = getFunctionCode(b.functionCode);
    const tpl = sheet.drawing.pins.filter((p) => p.blockId === b.id);
    // expected S-labels near this block (within its bbox expanded)
    const near = page.runs
      .map((r) => ({ r, s: toSrc(r.x, r.y) }))
      .filter(({ r, s }) => /^S\d+$|^N\/A$|^STA$|^[A-Z]{1,4}$|^\d{2,5}$|^\(\d+\)$/.test(r.text.trim()) && s[0] >= b.sourceBBox.x1 - 120 && s[0] <= b.sourceBBox.x2 + 120 && s[1] >= b.sourceBBox.y1 - 60 && s[1] <= b.sourceBBox.y2 + 60);
    console.log(`-- ${b.symbolName} FC${b.functionCode} #${b.blockNumber} rot=${b.rotation} ins=(${b.insertion.x},${b.insertion.y}) bbox=${b.sourceBBox.x1},${b.sourceBBox.y1},${b.sourceBBox.x2},${b.sourceBBox.y2} (${b.sourceBBox.x2 - b.sourceBBox.x1}x${b.sourceBBox.y2 - b.sourceBBox.y1})`);
    console.log(`   CAD pins: ${tpl.map((p) => `${p.pinName}(${p.relX},${p.relY})${p.connected ? "*" : ""}`).join(" ")}`);
    console.log(`   manual in=${schema?.symbol.inputs.join(",")} out=${schema?.symbol.outputs.join(",")}`);
    console.log(`   manual items: ${schema?.symbol.items.map((i) => `${i.s.replace(/ /g, "")}@${i.x},${i.y}`).join(" ")}`);
    console.log(`   expected near: ${near.map(({ r, s }) => `${r.text.trim()}@(${Math.round(s[0] - b.insertion.x)},${Math.round(s[1] - b.insertion.y)})`).join(" ")}`);
  }
}

function solve3(M: number[][], v: number[]): number[] {
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
