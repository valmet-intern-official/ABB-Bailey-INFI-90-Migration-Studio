/**
 * Decode the trailer section — 6.92% of every .CAD file, currently unread.
 *
 * The record stream ends at a "BCCo" token, after which the file carries
 * `BCCo SPC LIST` and `BCCo ATR LIST` sections. `SPC` almost certainly means
 * specification, making this the prime candidate for the function-block
 * S1..S15 values and function-code numbers that the vendor's plot shows but
 * the record stream does not contain.
 *
 * This analysis is oracle-guided: for `2061000A.CAD` the reference plot shows
 * block numbers 1050/1051/1055/1056 and function codes (12)(33)(35)(82)(90),
 * so we can search the trailer for those exact values and read the layout off
 * their positions instead of guessing.
 */
import fs from "node:fs";
import path from "node:path";
import { ascii, cadCorpus } from "./lib/walk";

const HEADER = 256;
const TOKEN = Buffer.from("BCCo", "latin1");

const target = process.argv[2] ?? "2061000A.CAD";
const file = cadCorpus().find((f) => path.basename(f).toUpperCase() === target.toUpperCase());
if (!file) {
  console.error(`not found: ${target}`);
  process.exit(1);
}
const buf = fs.readFileSync(file);
const start = buf.indexOf(TOKEN, HEADER);
const trailer = buf.subarray(start);

console.log(`${path.basename(file)}  ${buf.length} bytes`);
console.log(`trailer at ${start}, length ${trailer.length} (${((trailer.length / buf.length) * 100).toFixed(1)}%)\n`);

// ---- section tokens
console.log("section tokens:");
for (let i = 0; (i = trailer.indexOf(TOKEN, i)) !== -1; i += 1) {
  const label = trailer.subarray(i, i + 24).toString("latin1").replace(/[^\x20-\x7E]/g, ".");
  console.log(`  +${String(i).padStart(6)}  "${label}"`);
}
const endTok = trailer.indexOf(Buffer.from("END", "latin1"));
console.log(`  END token at +${endTok}\n`);

// ---- full hex dump of the first part of the trailer
console.log("trailer head:");
for (let i = 0; i < Math.min(trailer.length, 512); i += 16) {
  const row = trailer.subarray(i, i + 16);
  const u16: string[] = [];
  for (let j = 0; j + 2 <= row.length; j += 2) u16.push(String(row.readUInt16LE(j)).padStart(6));
  console.log(
    `  +${String(i).padStart(5)}  ${[...row].map((b) => b.toString(16).padStart(2, "0")).join(" ").padEnd(47)}  |${ascii(row).padEnd(16)}|${u16.join("")}`
  );
}

// ---- oracle-guided search: where do the known engineering values appear?
const wanted = [1050, 1051, 1055, 1056, 12, 33, 35, 82, 90];
console.log("\noracle-guided value search (uint16 LE) inside the trailer:");
for (const v of wanted) {
  const hits: number[] = [];
  for (let i = 0; i + 2 <= trailer.length; i += 1) {
    if (trailer.readUInt16LE(i) === v) hits.push(i);
  }
  console.log(
    `  ${String(v).padStart(5)}  ${String(hits.length).padStart(5)} hits  first: ${hits.slice(0, 12).map((h) => `+${h}`).join(" ")}`
  );
}

// ---- record-like structure test: is the trailer a chain of fixed entries?
console.log("\nfixed-stride scan (looking for a repeating entry size):");
for (const stride of [4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 32]) {
  // Score by how many byte columns stay constant across rows.
  const region = trailer.subarray(0, Math.min(trailer.length, stride * 200));
  const rows = Math.floor(region.length / stride);
  if (rows < 8) continue;
  let constCols = 0;
  for (let c = 0; c < stride; c++) {
    const v = region[c];
    let same = true;
    for (let r = 1; r < rows; r++) {
      if (region[r * stride + c] !== v) {
        same = false;
        break;
      }
    }
    if (same) constCols++;
  }
  console.log(`  stride ${String(stride).padStart(2)}  rows=${rows}  constantColumns=${constCols}`);
}

// ---- strings in the trailer
console.log("\nprintable runs in the trailer:");
let cur = "";
let at = 0;
const runs: Array<{ at: number; text: string }> = [];
for (let i = 0; i <= trailer.length; i++) {
  const c = i < trailer.length ? trailer[i] : 0;
  if (c >= 32 && c <= 126) {
    if (!cur) at = i;
    cur += String.fromCharCode(c);
  } else {
    if (cur.trim().length >= 2) runs.push({ at, text: cur });
    cur = "";
  }
}
for (const r of runs.slice(0, 40)) console.log(`  +${String(r.at).padStart(6)}  "${r.text}"`);
console.log(`  ... ${runs.length} runs total`);
