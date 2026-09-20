/**
 * Determine the primitive-record stride and phase inside .LBR symbol bodies.
 *
 * Rather than assume a boundary, this scores every (stride, phase) pair by how
 * consistently a fixed tail repeats, and reports the best fit per symbol. A
 * single stride/phase that wins across many symbols is a real layout; a
 * different answer per symbol means the model is wrong.
 */
import fs from "node:fs";
import path from "node:path";
import { ascii, lbrCorpus } from "./lib/walk";
import { readDirectory } from "./lbr-body";

const file = lbrCorpus().find((f) => /7107LIB1/i.test(f))!;
const buf = fs.readFileSync(file);
const dir = readDirectory(buf);

interface Fit {
  stride: number;
  phase: number;
  rows: number;
  /** Number of byte columns that are identical in every row. */
  constCols: number;
  score: number;
}

function bestFit(body: Buffer): Fit | null {
  let best: Fit | null = null;
  for (let stride = 8; stride <= 32; stride += 2) {
    for (let phase = 0; phase < stride; phase++) {
      const rows = Math.floor((body.length - phase) / stride);
      if (rows < 3) continue;
      let constCols = 0;
      for (let c = 0; c < stride; c++) {
        const v = body[phase + c];
        let same = true;
        for (let r = 1; r < rows; r++) {
          if (body[phase + r * stride + c] !== v) {
            same = false;
            break;
          }
        }
        if (same) constCols++;
      }
      // Favour many constant columns and full use of the body.
      const used = (rows * stride) / body.length;
      const score = constCols * used;
      if (!best || score > best.score) best = { stride, phase, rows, constCols, score };
    }
  }
  return best;
}

console.log(`${path.basename(file)} — stride/phase fit per symbol\n`);
console.log("symbol     len  stride phase rows constCols");
const tally = new Map<string, number>();

for (const e of dir) {
  const body = buf.subarray(e.offset, e.offset + e.length);
  const fit = bestFit(body);
  if (!fit) {
    console.log(`${e.name.padEnd(10)} ${String(e.length).padStart(4)}  (too short)`);
    continue;
  }
  console.log(
    `${e.name.padEnd(10)} ${String(e.length).padStart(4)}  ${String(fit.stride).padStart(5)} ${String(fit.phase).padStart(5)} ${String(fit.rows).padStart(4)} ${String(fit.constCols).padStart(8)}`
  );
  tally.set(`${fit.stride}/${fit.phase}`, (tally.get(`${fit.stride}/${fit.phase}`) ?? 0) + 1);
}

console.log("\nstride/phase frequency:");
for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n} symbols`);

// Show the winning layout applied to a few symbols.
for (const name of ["LINE", "BOX1", "BOX2", "DIP2W"]) {
  const e = dir.find((d) => d.name === name);
  if (!e) continue;
  const body = buf.subarray(e.offset, e.offset + e.length);
  const fit = bestFit(body)!;
  console.log(`\n${"=".repeat(80)}\n${name}  len=${e.length}  stride=${fit.stride} phase=${fit.phase}\n${"=".repeat(80)}`);
  for (let r = 0; r < fit.rows; r++) {
    const row = body.subarray(fit.phase + r * fit.stride, fit.phase + (r + 1) * fit.stride);
    const u16: string[] = [];
    for (let j = 0; j + 2 <= row.length; j += 2) u16.push(String(row.readUInt16LE(j)).padStart(6));
    console.log(`  r${String(r).padStart(2)}  ${[...row].map((b) => b.toString(16).padStart(2, "0")).join(" ")}  |${ascii(row)}|${u16.join("")}`);
  }
  const head = body.subarray(0, fit.phase);
  if (head.length) console.log(`  prefix(${head.length}): ${[...head].map((b) => b.toString(16).padStart(2, "0")).join(" ")}`);
}
