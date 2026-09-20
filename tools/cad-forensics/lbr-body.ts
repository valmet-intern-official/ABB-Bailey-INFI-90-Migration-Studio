/**
 * Dump and decode .LBR symbol bodies.
 *
 * Directory entry (CONFIRMED by offset chaining — each body offset equals the
 * previous offset plus the previous length, across every entry):
 *   +0  char[8] name
 *   +8  uint16  offsetHi   body offset = offsetHi * 256 + offsetLo
 *   +10 uint16  offsetLo
 *   +12 uint16  = 6
 *   +14 uint16  length     body length in bytes
 *
 *   npx tsx tools/cad-forensics/lbr-body.ts [LINE BOX1 AND2 ...]
 */
import fs from "node:fs";
import path from "node:path";
import { ascii, lbrCorpus } from "./lib/walk";

const DIR_START = 528;
const DIR_STRIDE = 16;

export interface LbrEntry {
  name: string;
  offset: number;
  length: number;
  tag: number;
}

export function readDirectory(buf: Buffer): LbrEntry[] {
  const out: LbrEntry[] = [];
  for (let at = DIR_START; at + DIR_STRIDE <= buf.length; at += DIR_STRIDE) {
    const raw = buf.subarray(at, at + 8).toString("latin1");
    if (!/^[\x20-\x7E]{8}$/.test(raw)) break;
    const name = raw.trim();
    if (name === "") break;
    const hi = buf.readUInt16LE(at + 8);
    const lo = buf.readUInt16LE(at + 10);
    const tag = buf.readUInt16LE(at + 12);
    const length = buf.readUInt16LE(at + 14);
    out.push({ name, offset: hi * 256 + lo, length, tag });
  }
  return out;
}

const file = lbrCorpus().find((f) => /7107LIB1/i.test(f)) ?? lbrCorpus()[0];
const buf = fs.readFileSync(file);
const dir = readDirectory(buf);

console.log(`${path.basename(file)}: ${dir.length} symbols in directory\n`);

// Verify the offset chain across the whole directory.
let chainOk = 0;
let chainBad = 0;
for (let i = 1; i < dir.length; i++) {
  if (dir[i].offset === dir[i - 1].offset + dir[i - 1].length) chainOk++;
  else chainBad++;
}
console.log(`offset chain: ${chainOk} consecutive, ${chainBad} breaks`);
const last = dir[dir.length - 1];
console.log(`body region: ${dir[0].offset}..${last.offset + last.length} of ${buf.length} bytes`);
console.log(`distinct tag values: ${[...new Set(dir.map((d) => d.tag))].join(",")}\n`);

const wanted = process.argv.slice(2);
const picks = wanted.length > 0 ? dir.filter((d) => wanted.includes(d.name)) : dir.slice(5, 8);

for (const e of picks) {
  const body = buf.subarray(e.offset, e.offset + e.length);
  console.log("=".repeat(96));
  console.log(`SYMBOL ${e.name}   offset=${e.offset} length=${e.length} tag=${e.tag}`);
  console.log("=".repeat(96));
  for (let i = 0; i < body.length; i += 16) {
    const row = body.subarray(i, i + 16);
    const u16: string[] = [];
    for (let j = 0; j + 2 <= row.length; j += 2) u16.push(String(row.readUInt16LE(j)).padStart(6));
    console.log(
      `  +${String(i).padStart(4)}  ${[...row].map((b) => b.toString(16).padStart(2, "0")).join(" ").padEnd(47)}  |${ascii(row).padEnd(16)}|${u16.join("")}`
    );
  }

  // Try the CAD record grammar inside the body.
  console.log("  -- record walk --");
  let off = 0;
  let guard = 0;
  while (off + 4 <= body.length && guard++ < 100) {
    if (body.readUInt16LE(off) === 0) {
      off += 2;
      continue;
    }
    const t = body.readUInt16LE(off);
    const lw = body.readUInt16LE(off + 2);
    if (lw < 2 || off + lw * 2 > body.length) {
      console.log(`     +${off}: type=${t} len=${lw} -> does not fit, stop`);
      break;
    }
    const w: number[] = [];
    for (let k = off; k + 2 <= off + lw * 2; k += 2) w.push(body.readUInt16LE(k));
    console.log(`     +${String(off).padStart(4)} type=${String(t).padStart(3)} len=${String(lw).padStart(3)}  ${w.slice(2).join(" ")}`);
    off += lw * 2;
  }
  console.log();
}
