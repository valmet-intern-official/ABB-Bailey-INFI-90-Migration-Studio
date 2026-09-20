/**
 * Cross-validate the trailer's function codes against the record stream's
 * symbol names.
 *
 * The two come from independent structures: the symbol name sits at +14 of a
 * record-stream instance, the numeric function code sits in the SPC LIST
 * trailer, and they are joined only by the Bailey block address. If both
 * decodes are correct, each symbol name must map to one function code
 * consistently across the whole archive. Inconsistency would expose a
 * misaligned trailer.
 *
 * Also emits the recovered function-code table, which replaces the hand-written
 * map previously used in the engine.
 */
import fs from "node:fs";
import path from "node:path";
import { decodeRecordStream, decodeTrailer, specificationsByBlock } from "@infi90/cad-engine";
import { cadCorpus } from "./lib/walk";

/** symbolName -> fc -> count */
const nameToFc = new Map<string, Map<number, number>>();
let joined = 0;

for (const f of cadCorpus()) {
  const buf = fs.readFileSync(f);
  const trailer = decodeTrailer(buf);
  if (!trailer.chainClean) continue;
  const specs = specificationsByBlock(trailer);

  for (const r of decodeRecordStream(buf).records) {
    if (r.blockNumber == null || !r.symbolName) continue;
    const spec = specs.get(r.blockNumber);
    if (!spec) continue;
    joined++;
    const key = r.symbolName.trim().toUpperCase();
    let m = nameToFc.get(key);
    if (!m) {
      m = new Map();
      nameToFc.set(key, m);
    }
    m.set(spec.functionCode, (m.get(spec.functionCode) ?? 0) + 1);
  }
}

let consistent = 0;
let ambiguous = 0;
let totalObs = 0;
let dominantObs = 0;
const rows: Array<{ name: string; fc: number; n: number; purity: number; alts: string }> = [];

for (const [name, m] of nameToFc) {
  const entries = [...m].sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((n, e) => n + e[1], 0);
  const [fc, n] = entries[0];
  const purity = n / total;
  totalObs += total;
  dominantObs += n;
  if (entries.length === 1) consistent++;
  else ambiguous++;
  rows.push({
    name,
    fc,
    n: total,
    purity,
    alts: entries.slice(1, 4).map(([f, c]) => `${f}x${c}`).join(" "),
  });
}

rows.sort((a, b) => b.n - a.n);

console.log("=".repeat(92));
console.log("FUNCTION CODE CROSS-VALIDATION — trailer FC vs record-stream symbol name");
console.log("=".repeat(92));
console.log(`name/FC observations joined by block address  ${joined.toLocaleString()}`);
console.log(`distinct symbol names carrying a block number ${nameToFc.size}`);
console.log(`names mapping to exactly one function code    ${consistent}  (${((consistent / nameToFc.size) * 100).toFixed(1)}%)`);
console.log(`names with more than one function code        ${ambiguous}`);
console.log(
  `observations agreeing with their name's dominant FC  ${dominantObs.toLocaleString()}/${totalObs.toLocaleString()}  (${((dominantObs / totalObs) * 100).toFixed(2)}%)`
);
console.log("");
console.log("recovered function-code table (from source, most observed first):");
console.log("  symbol      FC   blocks  purity  other FCs seen");
for (const r of rows.slice(0, 60)) {
  console.log(
    `  ${r.name.padEnd(11)} ${String(r.fc).padStart(4)} ${String(r.n).padStart(7)}  ${(r.purity * 100).toFixed(0).padStart(5)}%  ${r.alts}`
  );
}

// Emit the table so the engine can use source-derived values.
const out = Object.fromEntries(
  rows.filter((r) => r.purity >= 0.9 && r.n >= 5).map((r) => [r.name, r.fc])
);
fs.mkdirSync(path.join("tools", "cad-forensics", "out"), { recursive: true });
fs.writeFileSync(
  path.join("tools", "cad-forensics", "out", "function-codes.json"),
  JSON.stringify(out, null, 2),
  "utf8"
);
console.log(`\n${Object.keys(out).length} high-confidence name->FC mappings -> tools/cad-forensics/out/function-codes.json`);
