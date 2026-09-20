/**
 * Decide the unit of the .LBR directory offset/length fields.
 *
 * The directory region (528..1024) overlaps the first computed body offset
 * (769), which is impossible, so the fields cannot be byte offsets. This
 * scores each candidate interpretation by how much of each symbol body is
 * covered by confirmed 16-byte line primitives — the correct unit should
 * explain most of the body, a wrong one almost none.
 */
import fs from "node:fs";
import path from "node:path";
import { lbrCorpus } from "./lib/walk";

const LINE_SIG = Buffer.from([0x01, 0x00, 0x08, 0x00, 0x02, 0x00, 0x00, 0x00]);

function readDirectory(buf: Buffer) {
  const out: Array<{ name: string; offset: number; length: number }> = [];
  for (let at = 528; at + 16 <= buf.length; at += 16) {
    const raw = buf.subarray(at, at + 8).toString("latin1");
    if (!/^[\x20-\x7E]{8}$/.test(raw)) break;
    const name = raw.trim();
    if (name === "") break;
    out.push({
      name,
      offset: buf.readUInt16LE(at + 8) * 256 + buf.readUInt16LE(at + 10),
      length: buf.readUInt16LE(at + 14),
    });
  }
  return out;
}

const file = lbrCorpus().find((f) => /7107LIB1/i.test(f))!;
const buf = fs.readFileSync(file);
const dir = readDirectory(buf);

/** How many bytes of [from, from+len) are covered by line primitives. */
function score(from: number, len: number): { hits: number; covered: number } {
  if (from < 0 || from + len > buf.length || len <= 0) return { hits: 0, covered: 0 };
  const body = buf.subarray(from, from + len);
  let hits = 0;
  for (let at = 0; at + 16 <= body.length; at += 2) {
    if (body.subarray(at + 8, at + 16).equals(LINE_SIG)) {
      hits++;
      at += 14;
    }
  }
  return { hits, covered: (hits * 16) / len };
}

const candidates: Array<{ label: string; map: (o: number, l: number) => [number, number] }> = [
  { label: "bytes (o, l)", map: (o, l) => [o, l] },
  { label: "words (o*2, l*2)", map: (o, l) => [o * 2, l * 2] },
  { label: "words offset only (o*2, l)", map: (o, l) => [o * 2, l] },
  { label: "bytes rebased to dir end", map: (o, l) => [1024 + o - dir[0].offset, l] },
  { label: "words rebased to dir end", map: (o, l) => [1024 + (o - dir[0].offset) * 2, l * 2] },
];

console.log(`${path.basename(file)} — ${dir.length} directory entries, file ${buf.length} bytes\n`);

for (const c of candidates) {
  let totalHits = 0;
  let withGeom = 0;
  let covSum = 0;
  let inRange = 0;
  for (const e of dir) {
    const [from, len] = c.map(e.offset, e.length);
    if (from >= 0 && from + len <= buf.length) inRange++;
    const s = score(from, len);
    totalHits += s.hits;
    covSum += s.covered;
    if (s.hits > 0) withGeom++;
  }
  console.log(
    `${c.label.padEnd(30)} inRange=${String(inRange).padStart(3)}/${dir.length}  ` +
      `symbolsWithGeometry=${String(withGeom).padStart(3)}  segments=${String(totalHits).padStart(5)}  ` +
      `meanCoverage=${((covSum / dir.length) * 100).toFixed(1)}%`
  );
}

// Best candidate detail, per symbol.
console.log("\nper-symbol under 'words (o*2, l*2)':");
for (const e of dir) {
  const s = score(e.offset * 2, e.length * 2);
  console.log(
    `  ${e.name.padEnd(10)} at ${String(e.offset * 2).padStart(7)} len ${String(e.length * 2).padStart(5)}  ` +
      `segments=${String(s.hits).padStart(4)}  coverage=${(s.covered * 100).toFixed(0)}%`
  );
}
