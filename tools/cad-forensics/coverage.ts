/**
 * Byte-level decode coverage across the entire corpus.
 *
 * Reports what fraction of every .CAD file the schema actually explains, and
 * where the remainder sits, so "recovered everything" is a measurement rather
 * than a claim.
 */
import fs from "node:fs";
import path from "node:path";
import { decodeRecordStream } from "@infi90/cad-engine";
import { cadCorpus } from "./lib/walk";

let files = 0;
let total = 0;
let header = 0;
let recordB = 0;
let trailer = 0;
let residual = 0;
let padding = 0;
let recs = 0;
let unknownRecs = 0;
let desync = 0;

const byKind = new Map<string, number>();
const byType = new Map<number, { n: number; residual: number }>();
const unresolvedCount = new Map<string, number>();
const worst: Array<{ file: string; residual: number }> = [];

for (const f of cadCorpus()) {
  const buf = fs.readFileSync(f);
  const { records, coverage, clean } = decodeRecordStream(buf);
  files++;
  total += coverage.totalBytes;
  header += coverage.headerBytes;
  recordB += coverage.recordBytes;
  trailer += coverage.trailerBytes;
  residual += coverage.residualBytes;
  padding +=
    coverage.totalBytes -
    coverage.headerBytes -
    coverage.recordBytes -
    coverage.trailerBytes;
  if (!clean) desync++;

  for (const r of records) {
    recs++;
    byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
    if (r.kind === "unknown") unknownRecs++;
    const t = byType.get(r.type) ?? { n: 0, residual: 0 };
    t.n++;
    if (r.residualHex) t.residual++;
    byType.set(r.type, t);
    for (const u of r.unresolved) {
      unresolvedCount.set(u, (unresolvedCount.get(u) ?? 0) + 1);
    }
  }
  if (coverage.residualBytes > 0) {
    worst.push({ file: path.basename(f), residual: coverage.residualBytes });
  }
}

const explained = header + recordB - residual + trailer + padding;

console.log("=".repeat(92));
console.log("DECODE COVERAGE — ENTIRE CAD CORPUS");
console.log("=".repeat(92));
console.log(`files                 ${files}`);
console.log(`records               ${recs}`);
console.log(`files with desync     ${desync}`);
console.log("");
console.log(`total bytes           ${total}`);
console.log(`  file headers        ${header}   (${pct(header)})`);
console.log(`  record stream       ${recordB}   (${pct(recordB)})`);
console.log(`  trailer             ${trailer}   (${pct(trailer)})`);
console.log(`  inter-record pad    ${padding}   (${pct(padding)})`);
console.log("");
console.log(`record bytes explained by a schema field: ${recordB - residual} / ${recordB}`);
console.log(
  `  unexplained non-zero record bytes: ${residual}  (${((residual / recordB) * 100).toFixed(4)}% of record stream)`
);
console.log(`files with any residue: ${worst.length}`);
console.log("");
console.log("records by decoded kind:");
for (const [k, n] of [...byKind].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(12)} ${String(n).padStart(8)}  ${((n / recs) * 100).toFixed(2)}%`);
}
console.log("");
console.log("per record type: count / records carrying residue");
for (const [t, v] of [...byType].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  type ${String(t).padStart(2)}  ${String(v.n).padStart(8)}  residue in ${v.residual}`);
}
console.log("");
console.log("fields present but not confidently interpreted:");
for (const [u, n] of [...unresolvedCount].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${u.padEnd(22)} ${String(n).padStart(8)}`);
}
if (worst.length > 0) {
  console.log("\nlargest residues:");
  for (const w of worst.sort((a, b) => b.residual - a.residual).slice(0, 10)) {
    console.log(`  ${w.file}  ${w.residual} bytes`);
  }
}

function pct(v: number): string {
  return `${((v / total) * 100).toFixed(2)}%`;
}
