// Function-block specification extraction for one module directory.
//   npx tsx packages/fb-spec/src/cli.ts --in <dir with .CAD> --out <dir> [--module M10]
//        [--spec-report <file.LIS>] [--plot-text <pdf text json>] [--verify-report <file.VFY>]
import fs from "node:fs";
import path from "node:path";
import { decodedFingerprint, writeOutputs } from "./outputs";
import { runModule } from "./run";
import { parseSpecReport, parseVerifyReport, type VendorPlotText } from "./validate";

const args = process.argv.slice(2);
const opt = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const inDir = opt("in");
const outDir = opt("out");
if (!inDir || !outDir) {
  console.error("usage: cli.ts --in <dir> --out <dir> [--module NAME] [--spec-report F.LIS] [--plot-text F.json]");
  process.exit(2);
}
const walk = (d: string): string[] =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.cad$/i.test(e.name) ? [path.join(d, e.name)] : []));
const cads = walk(inDir).sort().map((p) => ({ name: path.basename(p), data: fs.readFileSync(p) }));
const module = opt("module") ?? path.basename(path.resolve(inDir));

const t0 = Date.now();
const first = runModule({ module, cads, extractDir: inDir });
const second = runModule({ module, cads, extractDir: inDir });
const fp1 = decodedFingerprint(first.result);
const fp2 = decodedFingerprint(second.result);

const specReportPath = opt("spec-report");
const plotPath = opt("plot-text");
const verifyPath = opt("verify-report");
const plotJson = plotPath ? (JSON.parse(fs.readFileSync(plotPath, "utf8")) as { source?: string; pages: VendorPlotText["pages"] }) : undefined;
const out = writeOutputs(first.result, {
  outDir,
  drawings: first.reconstructed.sheets.map((s) => ({ file: s.filename, items: s.items })),
  validation: {
    determinism: { first: fp1, second: fp2 },
    specReport: specReportPath ? parseSpecReport(fs.readFileSync(specReportPath, "latin1"), path.basename(specReportPath)) : undefined,
    plot: plotJson ? { source: path.basename(plotPath!), pages: plotJson.pages } : undefined,
    verifyReport: verifyPath ? parseVerifyReport(fs.readFileSync(verifyPath, "latin1"), path.basename(verifyPath)) : undefined,
  },
});
console.log(`${module}: ${first.result.blocks.length} blocks, ${first.result.specifications.length} specs, ${first.result.connections.length} connections in ${Date.now() - t0} ms`);
for (const c of out.validation.checks) console.log(`${c.pass ? "PASS" : "FAIL"} ${c.id} ${c.detail}`);
for (const [k, o] of Object.entries(out.validation.oracle)) {
  const summary = Object.fromEntries(Object.entries(o as Record<string, unknown>).filter(([, v]) => !Array.isArray(v)));
  console.log(`ORACLE ${k}`, JSON.stringify(summary));
}
for (const l of out.layout) console.log(`layout ${l.mode}: ${l.pages} pages, overlaps ${l.overlaps.length}, clipped ${l.clipped.length}, callouts ${l.callouts_placed} (+${l.callouts_frame_only.length} frame-only)`);
console.log(`wrote ${out.files.length} files to ${outDir}`);
process.exit(out.validation.passed ? 0 : 1);
