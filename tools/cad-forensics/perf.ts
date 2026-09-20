/**
 * Where does the time go?
 *
 * Measures each stage of the ingestion path separately so optimisation targets
 * are chosen from evidence rather than assumption.
 */
import fs from "node:fs";
import path from "node:path";
import {
  correlateSheets,
  decodeCadSheet,
  decodeRecordStream,
  decodeTrailer,
  renderEngineeringSvg,
} from "@infi90/cad-engine";
import { parseCadFile } from "@infi90/parsers";
import type { EngineeringSheetModel } from "@infi90/core";
import { cadCorpus } from "./lib/walk";

const all = cadCorpus();
// A module-sized sample matches what the app ingests per session.
const sample = all.filter((f) => /[\\/]M5[\\/]/i.test(f));
const files = sample.length >= 100 ? sample : all.slice(0, 243);
console.log(`sample: ${files.length} sheets (module-sized, as the app ingests)\n`);

const bufs = files.map((f) => ({ name: path.basename(f), buf: fs.readFileSync(f) }));

function time<T>(label: string, fn: () => T): T {
  const t0 = process.hrtime.bigint();
  const out = fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`  ${label.padEnd(34)} ${ms.toFixed(1).padStart(9)} ms   ${(ms / files.length).toFixed(3)} ms/sheet`);
  return out;
}

console.log("stage timings:");
time("readFileSync (already warm)", () => bufs.map((b) => b.buf.length));
time("decodeRecordStream", () => bufs.map((b) => decodeRecordStream(b.buf).records.length));
time("decodeTrailer", () => bufs.map((b) => decodeTrailer(b.buf).specifications.length));
const models = time("decodeCadSheet (full model)", () =>
  bufs.map((b) => decodeCadSheet(b.buf, b.name))
);
time("correlateSheets (whole set, once)", () => correlateSheets(models as EngineeringSheetModel[]));
time("renderEngineeringSvg", () => models.map((m) => renderEngineeringSvg(m).length));
const sheets = time("parseCadFile (full app path)", () =>
  bufs.map((b) => parseCadFile(b.buf, b.name))
);

const totalBytes = bufs.reduce((n, b) => n + b.buf.length, 0);
const blocks = sheets.reduce((n, s) => n + (s.engineeringModel?.blocks.length ?? 0), 0);
const withSpecs = sheets.reduce(
  (n, s) => n + s.functionBlocks.filter((f) => f.s1 != null || f.s2 != null).length,
  0
);
const withFc = sheets.reduce(
  (n, s) => n + s.functionBlocks.filter((f) => f.functionCodeNumber != null).length,
  0
);

console.log(`\nsample bytes            ${totalBytes.toLocaleString()}`);
console.log(`blocks decoded          ${blocks.toLocaleString()}`);
console.log(`functionBlocks rows     ${sheets.reduce((n, s) => n + s.functionBlocks.length, 0)}`);
console.log(`  carrying an FC number ${withFc}`);
console.log(`  carrying S1/S2 specs  ${withSpecs}`);

// Whole-corpus throughput for the record + model path.
const t0 = process.hrtime.bigint();
let n = 0;
for (const f of all) {
  decodeCadSheet(fs.readFileSync(f), path.basename(f));
  n++;
}
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`\nwhole corpus: ${n} sheets in ${(ms / 1000).toFixed(2)} s  (${(ms / n).toFixed(2)} ms/sheet)`);
