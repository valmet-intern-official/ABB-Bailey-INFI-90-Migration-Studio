import fs from "node:fs";
import path from "node:path";
import { runExtraction } from "./pipeline/run";
import { writeOutputPackage } from "./package/writer";
import type { Palette } from "./render/palette";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const input = arg("input") ?? process.argv[2];
const out = arg("out") ?? "m1-output";
if (!input || input.startsWith("--")) {
  console.error("usage: m1-extract --input <file.m1|dir|archive.zip> --out <dir> [--reference expected.pdf] [--palette palette.json] [--no-calibrate] [--strict]");
  process.exit(2);
}

const reference = arg("reference");
const paletteFile = arg("palette");
const t0 = Date.now();
const result = await runExtraction(input, {
  reference: reference ? fs.readFileSync(reference) : undefined,
  palette: paletteFile ? (JSON.parse(fs.readFileSync(paletteFile, "utf8")) as Palette) : undefined,
  calibrate: !flag("no-calibrate"),
  strict: flag("strict"),
  onProgress: (m) => console.log(`· ${m}`),
});
const written = writeOutputPackage(out, result);
console.log(`\nwrote ${written.length} files to ${path.resolve(out)} in ${((Date.now() - t0) / 1000).toFixed(1)} s (palette: ${result.paletteSource})\n`);
for (const f of result.files) {
  const c = f.analysis.decoded.coverage;
  const v = f.validation?.metrics;
  console.log(
    `${f.name.padEnd(18)} records=${String(f.analysis.decoded.records.length).padStart(5)} coverage=${c.ok ? "OK" : "FAIL"} residual=${c.fieldLevel.unresolvedBytes}` +
      ` placeholders=${f.analysis.scene.nodes.filter((n) => n.kind === "placeholder").length}` +
      (v ? ` page=${f.validation!.match.originalPage}/${f.validation!.match.markingPage} edgeP=${v.edgePrecision.toFixed(3)} edgeR=${v.edgeRecall.toFixed(3)} pix=${v.pixelSimilarity.toFixed(3)}` : "")
  );
}
console.log("\nQUALITY GATE");
for (const g of result.qualityGate) console.log(`  [${g.status.padEnd(21)}] ${g.item} — ${g.evidence}`);
const failed = result.qualityGate.filter((g) => g.status === "FAIL");
if (failed.length) {
  console.error(`\n${failed.length} quality-gate item(s) FAILED`);
  process.exit(1);
}
