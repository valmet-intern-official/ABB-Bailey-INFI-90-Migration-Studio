/**
 * Archive-wide hypothesis tests.
 *
 * Every layout rule proposed from a single file is re-tested here against the
 * WHOLE corpus. A rule is only promoted to CONFIRMED when it holds for ~100%
 * of instances; partial pass rates are reported so a rule that is actually
 * file-specific cannot masquerade as general.
 */
import fs from "node:fs";
import { cadCorpus, walkRecords } from "./lib/walk";

const SYMBOL_TYPES = new Set([6, 7, 8, 9, 10, 11, 12]);
const COORD_LO = 100;
const COORD_HI = 16000;

interface H {
  id: string;
  what: string;
  pass: number;
  fail: number;
  examples: string[];
}
const hs = new Map<string, H>();
function h(id: string, what: string): H {
  let x = hs.get(id);
  if (!x) {
    x = { id, what, pass: 0, fail: 0, examples: [] };
    hs.set(id, x);
  }
  return x;
}
function check(id: string, what: string, ok: boolean, detail: () => string) {
  const x = h(id, what);
  if (ok) x.pass++;
  else {
    x.fail++;
    if (x.examples.length < 5) x.examples.push(detail());
  }
}

const printableOrSpace = (b: Buffer) => [...b].every((c) => c >= 32 && c <= 126);
const allNul = (b: Buffer) => [...b].every((c) => c === 0);
/** Fields are padded with spaces in some files and NULs in others. */
const isPad = (c: number) => c === 0x20 || c === 0;
const blankField = (b: Buffer) => [...b].every(isPad);
/** Text then padding: printable run followed only by padding. */
const textThenPad = (b: Buffer) => {
  let i = 0;
  while (i < b.length && b[i] >= 32 && b[i] <= 126) i++;
  for (let j = i; j < b.length; j++) if (!isPad(b[j])) return false;
  return true;
};

const textHeights = new Map<number, number>();
const layerValues = new Map<number, number>();
const type6Block: number[] = [];

for (const f of cadCorpus()) {
  const buf = fs.readFileSync(f);
  const name = f.split(/[\\/]/).pop()!;
  const { records } = walkRecords(buf);

  for (const r of records) {
    const b = r.bytes;
    const u16 = (o: number) => (o + 2 <= b.length ? b.readUInt16LE(o) : -1);

    // ---- H-LAYER: word 2 is a small layer/level id on every record type
    layerValues.set(r.words[2], (layerValues.get(r.words[2]) ?? 0) + 1);
    check("H-LAYER", "w2 (layer) in 1..16", r.words[2] >= 1 && r.words[2] <= 16, () => `${name}@${r.offset} t${r.type} w2=${r.words[2]}`);

    if (r.type === 1) {
      // ---- H1: type 1 is a polyline; vertices = (len-4)/2
      const nPts = (r.lengthWords - 4) / 2;
      check("H1a", "type 1 length is even and yields whole vertices", Number.isInteger(nPts) && nPts >= 2, () => `${name}@${r.offset} len=${r.lengthWords}`);
      let inRange = true;
      for (let i = 0; i < nPts; i++) {
        const x = u16(8 + i * 4);
        const y = u16(10 + i * 4);
        if (x < COORD_LO || x > COORD_HI || y < COORD_LO || y > COORD_HI) inRange = false;
      }
      check("H1b", "type 1 all polyline vertices in coordinate band", inRange, () => `${name}@${r.offset} len=${r.lengthWords}`);
    }

    if (r.type === 2 || r.type === 3) {
      check("H2a", "types 2/3 are 7 words", r.lengthWords === 7, () => `${name}@${r.offset} t${r.type} len=${r.lengthWords}`);
      const ok = [3, 4, 5, 6].every((i) => r.words[i] >= COORD_LO && r.words[i] <= COORD_HI);
      check("H2b", "types 2/3 carry 2 points in w3..w6", ok, () => `${name}@${r.offset} t${r.type} ${r.words.slice(3, 7)}`);
    }

    if (r.type === 4) {
      check("H4a", "type 4 is 9 words", r.lengthWords === 9, () => `${name}@${r.offset} len=${r.lengthWords}`);
      const ok = [3, 4, 5, 6, 7, 8].every((i) => r.words[i] >= COORD_LO && r.words[i] <= COORD_HI);
      check("H4b", "type 4 carries 3 points in w3..w8", ok, () => `${name}@${r.offset} ${r.words.slice(3, 9)}`);
    }

    if (r.type === 5) {
      // ---- H5: text record: extent box, height at +14, string from +18
      check("H5a", "type 5 has at least 18 bytes of header", b.length >= 18, () => `${name}@${r.offset} len=${b.length}`);
      const ok = [3, 4, 5, 6].every((i) => r.words[i] >= COORD_LO && r.words[i] <= COORD_HI);
      check("H5b", "type 5 extent box in coordinate band", ok, () => `${name}@${r.offset} ${r.words.slice(3, 7)}`);
      // Bit 15 is a flag; the height is the low 15 bits.
      const raw = u16(14);
      const th = raw & 0x7fff;
      textHeights.set(th, (textHeights.get(th) ?? 0) + 1);
      check("H5c", "type 5 text height (low 15 bits) is a multiple of 5, 10..200", th % 5 === 0 && th >= 10 && th <= 200, () => `${name}@${r.offset} raw=${raw} h=${th}`);
      if (b.length > 18) {
        check("H5d", "type 5 payload from +18 is text then padding", textThenPad(b.subarray(18)), () => `${name}@${r.offset} "${b.subarray(18).toString("latin1")}"`);
      }
      check("H5e", "type 5 word at +16 is a rotation 0/90/180/270", [0, 90, 180, 270].includes(u16(16)), () => `${name}@${r.offset} w8=${u16(16)}`);
    }

    if (SYMBOL_TYPES.has(r.type)) {
      // ---- H6: shared symbol-instance header
      const nm = b.subarray(14, 22);
      check("H6a", "symbol types: 8-byte printable name at +14", nm.length === 8 && printableOrSpace(nm), () => `${name}@${r.offset} t${r.type}`);
      const [x1, y1, x2, y2] = [r.words[3], r.words[4], r.words[5], r.words[6]];
      check("H6b", "symbol types: bbox is ordered (x1<=x2, y1<=y2)", x1 <= x2 && y1 <= y2, () => `${name}@${r.offset} t${r.type} ${[x1, y1, x2, y2]}`);
      // Insertion is a placement origin, NOT necessarily inside the symbol's
      // own extent (border symbols place at the sheet origin), so the only
      // general claim is that it sits in the coordinate band.
      const ix = u16(22);
      const iy = u16(24);
      check(
        "H6c",
        "symbol types: insertion point is in the coordinate band",
        ix >= COORD_LO && ix <= COORD_HI && iy >= COORD_LO && iy <= COORD_HI,
        () => `${name}@${r.offset} t${r.type} ins=${ix},${iy}`
      );
      const rot = u16(26);
      check("H6d", "symbol types: rotation at +26 is 0/90/180/270", [0, 90, 180, 270].includes(rot), () => `${name}@${r.offset} t${r.type} rot=${rot}`);
    }

    if (r.type === 6) {
      const blk = u16(30);
      type6Block.push(blk);
      check("H7a", "type 6 word at +30 is a Bailey block number 1..9999", blk >= 1 && blk <= 9999, () => `${name}@${r.offset} blk=${blk}`);
    }

    if (r.type === 8) {
      // ---- H8: 30-byte tag at +30, fixed-format 10-byte reference at +60
      const tag = b.subarray(30, 60);
      check("H8a", "type 8: 30-byte tag field at +30 is text then padding", textThenPad(tag), () => `${name}@${r.offset} "${tag.toString("latin1")}"`);
      const ref = b.subarray(60, 70);
      const formatted = ref[4] === 0x2d && ref[7] === 0x2e;
      check("H8b", "type 8: reference at +60 is 'XXXX-NN.NN' or blank", blankField(ref) || formatted, () => `${name}@${r.offset} "${ref.toString("latin1")}"`);
      check("H8c", "type 8: trailing 4 bytes are zero", allNul(b.subarray(70)), () => `${name}@${r.offset}`);
    }

    if (r.type === 7) {
      // ---- H9: array of 40-byte reference entries from +32
      for (let off = 32; off + 40 <= b.length; off += 40) {
        const e = b.subarray(off, off + 40);
        // Unused array slots are blank in either padding convention.
        if (blankField(e)) continue;
        // An entry is a 10-byte reference (optionally blank) + a 30-byte tag,
        // i.e. the same pair as type 8 with the order reversed.
        const ref = e.subarray(0, 10);
        const tag = e.subarray(10, 40);
        const formatted = ref[4] === 0x2d && ref[7] === 0x2e;
        check("H9a", "type 7: entry reference is 'XXXX-NN.NN' or blank", blankField(ref) || formatted, () => `${name}@${r.offset}+${off} "${ref.toString("latin1")}"`);
        check("H9b", "type 7: entry tag is text then padding", textThenPad(tag), () => `${name}@${r.offset}+${off} "${tag.toString("latin1")}"`);
        check("H9d", "type 7: a populated entry has a tag, a reference, or both", !blankField(tag) || !blankField(ref), () => `${name}@${r.offset}+${off}`);
      }
      check("H9c", "type 7: entry array is a whole number of 40-byte slots", (b.length - 32) % 40 === 4 || (b.length - 32) % 40 === 0, () => `${name}@${r.offset} len=${b.length}`);
    }
  }
}

console.log("=".repeat(100));
console.log("ARCHIVE-WIDE HYPOTHESIS VERIFICATION");
console.log("=".repeat(100));
console.log(`${"id".padEnd(9)} ${"pass".padStart(9)} ${"fail".padStart(8)} ${"rate".padStart(8)}  hypothesis`);
for (const x of hs.values()) {
  const total = x.pass + x.fail;
  const rate = total === 0 ? 0 : (x.pass / total) * 100;
  const verdict = rate === 100 ? "CONFIRMED" : rate >= 99.9 ? "near-total" : "PARTIAL";
  console.log(
    `${x.id.padEnd(9)} ${String(x.pass).padStart(9)} ${String(x.fail).padStart(8)} ${rate.toFixed(3).padStart(7)}%  ${x.what}  [${verdict}]`
  );
  for (const e of x.examples) console.log(`              counter-example: ${e}`);
}

console.log("\nlayer (w2) distribution:");
console.log(
  "  " +
    [...layerValues]
      .sort((a, b) => a[0] - b[0])
      .map(([v, c]) => `${v}:${c}`)
      .join("  ")
);
console.log("\ntext heights (type 5):");
console.log(
  "  " +
    [...textHeights]
      .sort((a, b) => b[1] - a[1])
      .map(([v, c]) => `${v}:${c}`)
      .join("  ")
);
const blkSorted = type6Block.slice().sort((a, b) => a - b);
console.log(
  `\ntype 6 block numbers: n=${blkSorted.length} min=${blkSorted[0]} max=${blkSorted[blkSorted.length - 1]} median=${blkSorted[Math.floor(blkSorted.length / 2)]}`
);
