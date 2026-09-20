/**
 * Geometry hypothesis test.
 *
 * Hypothesis (from LBR body evidence, where primitives carry literal
 * coordinates in the same numeric range):
 *
 *   record header words w3,w4,w5,w6 = bounding box (x1, y1, x2, y2)
 *   the two uint16 following the 8-byte symbol name = insertion point (x, y)
 *
 * Falsifiable predictions:
 *   P1  x1 <= x2 and y1 <= y2 for essentially every name-bearing record
 *   P2  (x2-x1, y2-y1) is constant for a given symbol name — a symbol has a
 *       fixed size wherever it is placed
 *   P3  the insertion point lies within or on the bounding box
 *
 * P2 is the strong one: nothing about arbitrary pointer values would make
 * width/height stable per symbol name across thousands of unrelated sheets.
 */
import fs from "node:fs";
import path from "node:path";

const HEADER_SIZE = 256;

interface Instance {
  file: string;
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  insX: number;
  insY: number;
}

function findTrailer(buf: Buffer): number | null {
  const idx = buf.indexOf(Buffer.from("BCCo\xC5", "latin1"), HEADER_SIZE);
  return idx === -1 ? null : idx;
}

function collect(file: string, sink: Instance[]) {
  const buf = fs.readFileSync(file);
  const limit = findTrailer(buf) ?? buf.length;
  let off = HEADER_SIZE;

  while (off + 4 <= limit) {
    if (buf.readUInt16LE(off) === 0) {
      off += 2;
      continue;
    }
    const lengthWords = buf.readUInt16LE(off + 2);
    const lengthBytes = lengthWords * 2;
    if (lengthWords < 4 || off + lengthBytes > limit) break;

    const end = off + lengthBytes;
    const nameSlot = off + 14;
    if (nameSlot + 12 <= end) {
      const raw = buf.subarray(nameSlot, nameSlot + 8).toString("latin1");
      if (/^[\x20-\x7E]{8}$/.test(raw) && /[A-Za-z0-9]/.test(raw.trim())) {
        sink.push({
          file: path.basename(file),
          name: raw.trimEnd(),
          x1: buf.readUInt16LE(off + 6),
          y1: buf.readUInt16LE(off + 8),
          x2: buf.readUInt16LE(off + 10),
          y2: buf.readUInt16LE(off + 12),
          insX: buf.readUInt16LE(nameSlot + 8),
          insY: buf.readUInt16LE(nameSlot + 10),
        });
      }
    }
    off = end;
  }
}

function expand(target: string): string[] {
  const st = fs.statSync(target);
  if (st.isFile()) return [target];
  return fs
    .readdirSync(target, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? expand(path.join(target, e.name))
        : e.name.toUpperCase().endsWith(".CAD")
          ? [path.join(target, e.name)]
          : []
    );
}

const targets = process.argv.slice(2).flatMap(expand);
const all: Instance[] = [];
for (const f of targets) {
  try {
    collect(f, all);
  } catch {
    /* unreadable file — ignore for this statistical test */
  }
}

console.log(`files            ${targets.length}`);
console.log(`named instances  ${all.length}`);

// ---- P1: box ordering
const ordered = all.filter((i) => i.x1 <= i.x2 && i.y1 <= i.y2);
console.log(
  `\nP1 x1<=x2 && y1<=y2   ${ordered.length}/${all.length} (${((ordered.length / all.length) * 100).toFixed(2)}%)`
);

// ---- P2: per-name size stability
const sizes = new Map<string, Map<string, number>>();
for (const i of all) {
  const key = `${i.x2 - i.x1}x${i.y2 - i.y1}`;
  if (!sizes.has(i.name)) sizes.set(i.name, new Map());
  const m = sizes.get(i.name)!;
  m.set(key, (m.get(key) ?? 0) + 1);
}

let stable = 0;
let dominant = 0;
let total = 0;
for (const [, m] of sizes) {
  const counts = [...m.values()].sort((a, b) => b - a);
  const sum = counts.reduce((a, b) => a + b, 0);
  total += sum;
  dominant += counts[0];
  if (m.size === 1) stable++;
}
console.log(
  `\nP2 symbol names with a single exact size   ${stable}/${sizes.size} (${((stable / sizes.size) * 100).toFixed(1)}%)`
);
console.log(
  `P2 instances matching their name's most common size  ${dominant}/${total} (${((dominant / total) * 100).toFixed(2)}%)`
);

// ---- P3: insertion point inside box
const inside = all.filter(
  (i) => i.insX >= i.x1 && i.insX <= i.x2 && i.insY >= i.y1 && i.insY <= i.y2
);
console.log(
  `\nP3 insertion point within bbox   ${inside.length}/${all.length} (${((inside.length / all.length) * 100).toFixed(2)}%)`
);

// ---- P2b: size stability treating w/h as unordered, i.e. allowing rotation
const oriented = new Map<string, Map<string, number>>();
for (const i of all) {
  const w = i.x2 - i.x1;
  const h = i.y2 - i.y1;
  const key = `${Math.min(w, h)}/${Math.max(w, h)}`;
  if (!oriented.has(i.name)) oriented.set(i.name, new Map());
  const m = oriented.get(i.name)!;
  m.set(key, (m.get(key) ?? 0) + 1);
}
let oStable = 0;
let oDominant = 0;
let oTotal = 0;
for (const [, m] of oriented) {
  const counts = [...m.values()].sort((a, b) => b - a);
  oTotal += counts.reduce((a, b) => a + b, 0);
  oDominant += counts[0];
  if (m.size === 1) oStable++;
}
console.log(
  `\nP2b rotation-normalised: names with single size  ${oStable}/${oriented.size} (${((oStable / oriented.size) * 100).toFixed(1)}%)`
);
console.log(
  `P2b instances matching dominant size  ${oDominant}/${oTotal} (${((oDominant / oTotal) * 100).toFixed(2)}%)`
);

// ---- coordinate ranges (reduce, not spread — 431k args overflows the stack)
const range = (pick: (i: Instance) => number[]) =>
  all.reduce(
    (acc, i) => {
      for (const v of pick(i)) {
        if (v < acc[0]) acc[0] = v;
        if (v > acc[1]) acc[1] = v;
      }
      return acc;
    },
    [Infinity, -Infinity]
  );
const [xMin, xMax] = range((i) => [i.x1, i.x2]);
const [yMin, yMax] = range((i) => [i.y1, i.y2]);
console.log(`\ncoordinate range  X ${xMin}..${xMax}   Y ${yMin}..${yMax}`);

console.log(`\nper-symbol size table (top 25 by instance count)`);
const byCount = [...sizes].sort(
  (a, b) =>
    [...b[1].values()].reduce((x, y) => x + y, 0) - [...a[1].values()].reduce((x, y) => x + y, 0)
);
console.log(`  name          n        sizes (w x h : count)`);
for (const [name, m] of byCount.slice(0, 25)) {
  const n = [...m.values()].reduce((a, b) => a + b, 0);
  const list = [...m]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k}:${v}`)
    .join("  ");
  console.log(`  ${name.padEnd(12)} ${String(n).padStart(6)}   ${list}`);
}
