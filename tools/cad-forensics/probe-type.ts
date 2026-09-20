/**
 * Exact byte-layout probe for one record type.
 *
 * Prints a labelled byte map per sample, drawn from many different files, so
 * field boundaries can be read off directly rather than inferred from a
 * concatenated ASCII rendering.
 *
 *   npx tsx tools/cad-forensics/probe-type.ts 8 [samples]
 */
import fs from "node:fs";
import path from "node:path";
import { ascii, cadCorpus, walkRecords } from "./lib/walk";

const wantType = Number(process.argv[2] ?? 8);
const wantSamples = Number(process.argv[3] ?? 10);

const files = cadCorpus();
const samples: Array<{ file: string; offset: number; bytes: Buffer }> = [];
const seenFiles = new Set<string>();

for (const f of files) {
  if (samples.length >= wantSamples) break;
  const buf = fs.readFileSync(f);
  const { records } = walkRecords(buf);
  const hits = records.filter((r) => r.type === wantType);
  if (hits.length === 0) continue;
  // One sample per file maximises structural variety.
  if (seenFiles.has(path.basename(f))) continue;
  seenFiles.add(path.basename(f));
  for (const h of hits.slice(0, 2)) {
    if (samples.length >= wantSamples) break;
    samples.push({ file: path.basename(f), offset: h.offset, bytes: h.bytes });
  }
}

console.log(`TYPE ${wantType} — ${samples.length} samples\n`);

for (const s of samples) {
  console.log("=".repeat(92));
  console.log(`${s.file} @${s.offset}   ${s.bytes.length} bytes`);
  console.log("=".repeat(92));

  // 16-byte rows with offset, hex, uint16 values and ascii.
  for (let i = 0; i < s.bytes.length; i += 16) {
    const row = s.bytes.subarray(i, Math.min(i + 16, s.bytes.length));
    const hex = [...row].map((b) => b.toString(16).padStart(2, "0")).join(" ");
    const u16: string[] = [];
    for (let j = 0; j + 2 <= row.length; j += 2) {
      u16.push(String(row.readUInt16LE(j)).padStart(5));
    }
    console.log(
      `  +${String(i).padStart(3)}  ${hex.padEnd(47)}  |${ascii(row).padEnd(16)}|  ${u16.join(" ")}`
    );
  }

  // Candidate text fields: any printable-or-space run of >= 4 bytes.
  const runs: Array<{ at: number; len: number; text: string }> = [];
  let start = -1;
  for (let i = 0; i <= s.bytes.length; i++) {
    const b = i < s.bytes.length ? s.bytes[i] : 0;
    const printable = b >= 32 && b <= 126;
    if (printable && start === -1) start = i;
    if (!printable && start !== -1) {
      if (i - start >= 4) {
        runs.push({ at: start, len: i - start, text: s.bytes.subarray(start, i).toString("latin1") });
      }
      start = -1;
    }
  }
  for (const r of runs) {
    console.log(`   text +${r.at}..+${r.at + r.len - 1} (${r.len}B) "${r.text}"`);
  }
  console.log();
}
