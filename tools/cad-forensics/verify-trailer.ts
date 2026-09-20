/**
 * Archive-wide verification of the SPC LIST trailer decoder.
 *
 * The decisive test is the length chain: if the entry layout is right, walking
 * it from the section header lands exactly on the following section token in
 * every file. A wrong layout desynchronises and fails loudly.
 *
 * Second test: block numbers in the trailer should correspond to the block
 * numbers carried by type 6 records in the same file. Agreement across the
 * archive means the two independent sources describe the same blocks.
 */
import fs from "node:fs";
import path from "node:path";
import { decodeRecordStream, decodeTrailer } from "@infi90/cad-engine";
import { cadCorpus } from "./lib/walk";

let files = 0;
let withSpc = 0;
let chainClean = 0;
let desync = 0;
let entries = 0;
let specValues = 0;
let unexplained = 0;
let residualEntries = 0;

const fcHistogram = new Map<number, number>();
const headerSizes = new Map<number, number>();
const blockRangeBad: string[] = [];
const desyncExamples: string[] = [];

// Agreement between trailer block numbers and type 6 record block numbers.
let recordBlocks = 0;
let recordBlocksInTrailer = 0;
let trailerBlocks = 0;
let trailerBlocksInRecords = 0;

const floatHistogram = new Map<string, number>();

for (const f of cadCorpus()) {
  const buf = fs.readFileSync(f);
  files++;
  const t = decodeTrailer(buf);
  if (!t.present) continue;
  withSpc++;
  if (t.sectionHeaderBytes != null) {
    headerSizes.set(t.sectionHeaderBytes, (headerSizes.get(t.sectionHeaderBytes) ?? 0) + 1);
  }
  if (t.chainClean) chainClean++;
  else {
    desync++;
    if (desyncExamples.length < 8) {
      desyncExamples.push(`${path.basename(f)}: ${t.diagnostics[0] ?? "no clean stop"}`);
    }
  }
  entries += t.specifications.length;
  unexplained += t.unexplainedBytes;

  const tSet = new Set<number>();
  for (const s of t.specifications) {
    specValues += s.specs.length;
    if (s.residualHex) residualEntries++;
    fcHistogram.set(s.functionCode, (fcHistogram.get(s.functionCode) ?? 0) + 1);
    tSet.add(s.blockNumber);
    // Bailey block addresses run 1..9999.
    if (s.blockNumber < 1 || s.blockNumber > 9999) {
      if (blockRangeBad.length < 8) {
        blockRangeBad.push(`${path.basename(f)}@${s.offset} block=${s.blockNumber}`);
      }
    }
    for (const c of s.specs) {
      // Bucket float values to see whether they look like engineering numbers.
      const v = c.float;
      const key = !Number.isFinite(v)
        ? "non-finite"
        : v === 0
          ? "0"
          : Math.abs(v) < 1e-6
            ? "denormal/tiny"
            : Math.abs(v) > 1e9
              ? "huge"
              : Number.isInteger(v)
                ? "integer"
                : "fractional";
      floatHistogram.set(key, (floatHistogram.get(key) ?? 0) + 1);
    }
  }

  const rSet = new Set<number>();
  for (const r of decodeRecordStream(buf).records) {
    if (r.blockNumber != null) rSet.add(r.blockNumber);
  }
  for (const b of rSet) {
    recordBlocks++;
    if (tSet.has(b)) recordBlocksInTrailer++;
  }
  for (const b of tSet) {
    trailerBlocks++;
    if (rSet.has(b)) trailerBlocksInRecords++;
  }
}

const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(2)}%`);

console.log("=".repeat(92));
console.log("SPC LIST TRAILER — ARCHIVE-WIDE VERIFICATION");
console.log("=".repeat(92));
console.log(`files                        ${files}`);
console.log(`files with an SPC LIST       ${withSpc}  (${pct(withSpc, files)})`);
console.log(`entry chain ends exactly on the next section token`);
console.log(`                             ${chainClean}  (${pct(chainClean, withSpc)})  [CONFIRMED if 100%]`);
console.log(`files with a desync          ${desync}`);
console.log(`specification entries        ${entries}`);
console.log(`specification values         ${specValues}`);
console.log(`entries with residual bytes  ${residualEntries}`);
console.log(`unexplained trailer bytes    ${unexplained}`);
console.log("");
console.log("solved section-header sizes (bytes between token and first entry):");
for (const [h, n] of [...headerSizes].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${String(h).padStart(3)} bytes  ${String(n).padStart(6)} files`);
}
console.log("");
console.log(`block numbers outside 1..9999: ${blockRangeBad.length === 0 ? "none" : blockRangeBad.length}`);
for (const e of blockRangeBad) console.log(`   ${e}`);
console.log("");
console.log("cross-check against type 6 record block numbers:");
console.log(`  record block numbers also in the trailer   ${recordBlocksInTrailer}/${recordBlocks}  (${pct(recordBlocksInTrailer, recordBlocks)})`);
console.log(`  trailer block numbers also in the records   ${trailerBlocksInRecords}/${trailerBlocks}  (${pct(trailerBlocksInRecords, trailerBlocks)})`);
console.log("");
console.log("specification value shapes:");
for (const [k, n] of [...floatHistogram].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(16)} ${String(n).padStart(8)}  ${pct(n, specValues)}`);
}
console.log("");
console.log(`distinct function codes decoded from source: ${fcHistogram.size}`);
const fcs = [...fcHistogram].sort((a, b) => b[1] - a[1]);
console.log("  most common:");
for (const [fc, n] of fcs.slice(0, 24)) {
  console.log(`    FC ${String(fc).padStart(4)}  ${String(n).padStart(7)} blocks`);
}
const outOfRange = fcs.filter(([fc]) => fc < 1 || fc > 250);
console.log(`  function codes outside 1..250: ${outOfRange.length}${outOfRange.length ? ` e.g. ${outOfRange.slice(0, 8).map(([f, n]) => `${f}(x${n})`).join(" ")}` : ""}`);
for (const e of desyncExamples) console.log(`  desync: ${e}`);
