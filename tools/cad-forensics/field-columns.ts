/**
 * Column analysis of fixed-width text fields.
 *
 * For a byte window inside a record type, reports the character-class
 * distribution at each column across the WHOLE corpus. Fixed sub-field
 * boundaries show up as sharp transitions (e.g. a column that is always '-'
 * or always a digit), which distinguishes a real layout from one file's
 * coincidence.
 *
 *   npx tsx tools/cad-forensics/field-columns.ts <type> <from> <len> [stride]
 */
import fs from "node:fs";
import { cadCorpus, walkRecords } from "./lib/walk";

const type = Number(process.argv[2] ?? 8);
const from = Number(process.argv[3] ?? 30);
const len = Number(process.argv[4] ?? 40);
const stride = Number(process.argv[5] ?? 0); // >0 repeats the window

const cls = (b: number) =>
  b === 0x20 ? " " : b >= 48 && b <= 57 ? "9" : b >= 65 && b <= 90 ? "A" : b >= 97 && b <= 122 ? "a" : b === 0 ? "." : "!";

const cols: Array<Map<string, number>> = Array.from({ length: len }, () => new Map());
const literal: Array<Map<string, number>> = Array.from({ length: len }, () => new Map());
let n = 0;
const examples: string[] = [];

for (const f of cadCorpus()) {
  const buf = fs.readFileSync(f);
  for (const r of walkRecords(buf).records) {
    if (r.type !== type) continue;
    const windows: number[] = [];
    if (stride > 0) {
      for (let o = from; o + len <= r.bytes.length; o += stride) windows.push(o);
    } else if (from + len <= r.bytes.length) {
      windows.push(from);
    }
    for (const off of windows) {
      const slice = r.bytes.subarray(off, off + len);
      // Skip all-NUL windows: unused array slots carry no layout evidence.
      if (slice.every((b) => b === 0)) continue;
      n++;
      for (let i = 0; i < len; i++) {
        const c = cls(slice[i]);
        cols[i].set(c, (cols[i].get(c) ?? 0) + 1);
        const ch = String.fromCharCode(slice[i]);
        const m = literal[i];
        if (m.size < 80) m.set(ch, (m.get(ch) ?? 0) + 1);
      }
      if (examples.length < 14) examples.push(slice.toString("latin1"));
    }
  }
}

console.log(`type ${type}, window +${from} len ${len}${stride ? ` stride ${stride}` : ""}`);
console.log(`windows analysed: ${n}\n`);

console.log("col  dominant                           always?");
for (let i = 0; i < len; i++) {
  const total = [...cols[i].values()].reduce((a, b) => a + b, 0) || 1;
  const dist = [...cols[i]]
    .sort((a, b) => b[1] - a[1])
    .map(([c, v]) => `${c}:${((v / total) * 100).toFixed(0)}%`)
    .join(" ");
  // A single literal character in every row means a separator.
  const lit = [...literal[i]].sort((a, b) => b[1] - a[1]);
  const fixed =
    lit.length > 0 && lit[0][1] === total ? `ALWAYS '${lit[0][0]}'` : lit.length <= 3 ? lit.map(([c, v]) => `'${c}'x${v}`).join(" ") : "";
  console.log(`${String(from + i).padStart(3)}  ${dist.padEnd(34)} ${fixed}`);
}

console.log("\nexamples:");
for (const e of examples) console.log(`  "${e}"`);
