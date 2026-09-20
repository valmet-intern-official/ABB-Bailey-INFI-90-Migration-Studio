/**
 * SCAD 5.3 `.LBR` symbol library forensics.
 *
 * Goal: determine the directory entry structure so `CAD record name -> symbol
 * primitives` becomes resolvable, and so pin/extent data can disambiguate the
 * coordinate words in the CAD record header.
 */
import fs from "node:fs";
import path from "node:path";

const file = process.argv[2];
const buf = fs.readFileSync(file);

const hex = (b: number) => b.toString(16).padStart(2, "0").toUpperCase();

function dump(start: number, end: number, label: string) {
  console.log(`\n--- ${label}  [${start}..${end}) ---`);
  for (let off = start; off < Math.min(end, buf.length); off += 16) {
    const slice = buf.subarray(off, Math.min(off + 16, end, buf.length));
    const bytes = [...slice].map(hex).join(" ").padEnd(47, " ");
    const ascii = [...slice]
      .map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : "."))
      .join("");
    console.log(`${String(off).padStart(7)}  ${bytes}  |${ascii}|`);
  }
}

console.log("=".repeat(90));
console.log(`${path.basename(file)}   ${buf.length} bytes`);
console.log("=".repeat(90));
console.log(`banner: ${JSON.stringify(buf.subarray(0, 32).toString("latin1"))}`);

dump(0, 128, "HEADER");
dump(496, 560, "PRE-DIRECTORY / DIRECTORY START");

// Test the 16-byte directory-entry hypothesis and look for usable pointers.
console.log("\n--- DIRECTORY AS 16-BYTE ENTRIES (name + 8 bytes) ---");
console.log("  offset  name      rest(8B)                 u32a       u32b     u16s");
const DIR_START = 528;
const rows: Array<{ off: number; name: string; u32a: number; u32b: number }> = [];
for (let off = DIR_START; off < DIR_START + 16 * 40 && off + 16 <= buf.length; off += 16) {
  const name = buf.subarray(off, off + 8).toString("latin1");
  const rest = buf.subarray(off + 8, off + 16);
  const u32a = rest.readUInt32LE(0);
  const u32b = rest.readUInt32LE(4);
  const u16s = [0, 2, 4, 6].map((i) => rest.readUInt16LE(i));
  rows.push({ off, name, u32a, u32b });
  console.log(
    `${String(off).padStart(8)}  ${JSON.stringify(name).padEnd(12)} ${[...rest].map(hex).join(" ")}  ${String(u32a).padStart(10)} ${String(u32b).padStart(10)}  ${u16s.join(",")}`
  );
}

// A directory of pointers should be in range and broadly ascending.
const inRange = (v: number) => v > 0 && v < buf.length;
for (const [label, pick] of [
  ["u32a", (r: (typeof rows)[0]) => r.u32a],
  ["u32b", (r: (typeof rows)[0]) => r.u32b],
] as const) {
  const vals = rows.map(pick);
  const good = vals.filter(inRange).length;
  let ascending = 0;
  for (let i = 1; i < vals.length; i++) if (vals[i] >= vals[i - 1]) ascending++;
  console.log(
    `\n${label}: in-range ${good}/${vals.length}, ascending ${ascending}/${vals.length - 1}`
  );
}

// Locate where the directory stops looking like 8-byte padded names.
let dirEnd = DIR_START;
for (let off = DIR_START; off + 16 <= buf.length; off += 16) {
  const name = buf.subarray(off, off + 8).toString("latin1");
  if (!/^[A-Z0-9][\x20-\x7E]{7}$/i.test(name)) break;
  dirEnd = off + 16;
}
console.log(`\ndirectory appears to end at ${dirEnd}  (${(dirEnd - DIR_START) / 16} entries)`);
dump(dirEnd - 32, dirEnd + 96, "DIRECTORY END / BODY START");
