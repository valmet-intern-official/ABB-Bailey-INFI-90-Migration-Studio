/**
 * Phase 1 record-grammar validator.
 *
 * Hypothesis derived from hex evidence in 30705C8A.CAD:
 *   - bytes 0..255 are a file header (library binding at 0x90)
 *   - each record begins with uint16 LE `type`, then uint16 LE `lengthWords`
 *   - record occupies `lengthWords * 2` bytes including the 4-byte prefix
 *
 * This tool does NOT interpret record payloads. It only tests whether the
 * length chain walks from the header to EOF without desynchronising. A clean
 * walk across many files is what promotes the grammar from ASSUMED to CONFIRMED.
 */
import fs from "node:fs";
import path from "node:path";

const HEADER_SIZE = 256;

interface ScannedRecord {
  offset: number;
  type: number;
  lengthWords: number;
  lengthBytes: number;
  /** 8-byte space-padded symbol name when the record carries one. */
  name?: string;
  /** Raw header words w2..w6. Meaning still UNKNOWN — do not interpret yet. */
  headerWords: number[];
  strings: string[];
}

interface ScanResult {
  file: string;
  size: number;
  ok: boolean;
  records: ScannedRecord[];
  /** Regions the walk could not attribute to a record. */
  gaps: Array<{ offset: number; length: number; reason: string }>;
  trailerOffset: number | null;
}

function readStrings(buf: Buffer, from: number, to: number, minLen = 2): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = from; i < to; i++) {
    const b = buf[i];
    if (b >= 32 && b <= 126) cur += String.fromCharCode(b);
    else {
      if (cur.length >= minLen) out.push(cur);
      cur = "";
    }
  }
  if (cur.length >= minLen) out.push(cur);
  return out;
}

/**
 * The trailer is a run of 0xC5-separated keyword tokens ("BCCo SPC LIST",
 * "BCCo ATR LIST", "END CAD FILE") closing the file. Locate its true start:
 * the earliest point from which only printable / NUL / 0xC5 bytes remain.
 */
/**
 * Trailer layout discovered in the fixtures:
 *   "BCCo<C5>SPC<C5>LIST\0"  + fixed-width entry table
 *   "BCCo<C5>ATR<C5>LIST\0"  + fixed-width entry table
 *   "END<C5>CAD<C5>FILE\0"
 * The record stream therefore ends at the first "BCCo<C5>" token.
 */
function findTrailer(buf: Buffer): number | null {
  const idx = buf.indexOf(Buffer.from("BCCo\xC5", "latin1"), HEADER_SIZE);
  return idx === -1 ? null : idx;
}

function scan(file: string): ScanResult {
  const buf = fs.readFileSync(file);
  const records: ScannedRecord[] = [];
  const gaps: ScanResult["gaps"] = [];
  const trailerOffset = findTrailer(buf);
  const limit = trailerOffset ?? buf.length;

  let off = HEADER_SIZE;
  let ok = true;

  while (off + 4 <= limit) {
    // Records are word-aligned and padded with NULs; skip filler.
    if (buf.readUInt16LE(off) === 0) {
      const gapStart = off;
      while (off + 2 <= limit && buf.readUInt16LE(off) === 0) off += 2;
      if (off > gapStart) {
        gaps.push({ offset: gapStart, length: off - gapStart, reason: "NUL padding" });
      }
      continue;
    }

    const type = buf.readUInt16LE(off);
    const lengthWords = buf.readUInt16LE(off + 2);
    const lengthBytes = lengthWords * 2;

    const plausible =
      lengthWords >= 4 && lengthBytes >= 8 && off + lengthBytes <= limit && type < 4096;

    if (!plausible) {
      gaps.push({
        offset: off,
        length: limit - off,
        reason: `desync: type=${type} lengthWords=${lengthWords}`,
      });
      ok = false;
      break;
    }

    const end = off + lengthBytes;
    // Offset 14 is the 8-byte symbol-name slot on name-bearing records.
    const nameSlot = off + 14;
    let name: string | undefined;
    if (nameSlot + 8 <= end) {
      const raw = buf.subarray(nameSlot, nameSlot + 8).toString("latin1");
      if (/^[\x20-\x7E]{8}$/.test(raw) && /[A-Z0-9]/i.test(raw.trim())) {
        name = raw.trimEnd();
      }
    }

    const headerWords: number[] = [];
    for (let w = off + 4; w + 2 <= Math.min(off + 14, end); w += 2) {
      headerWords.push(buf.readUInt16LE(w));
    }

    records.push({
      offset: off,
      type,
      lengthWords,
      lengthBytes,
      name,
      headerWords,
      strings: readStrings(buf, name ? nameSlot + 8 : off + 4, end),
    });

    off = end;
  }

  return { file, size: buf.length, ok, records, gaps, trailerOffset };
}

// ---------------------------------------------------------------- reporting

const args = process.argv.slice(2);
const jsonOut = args.find((a) => a.startsWith("--json="))?.slice(7);
const files = args.filter((a) => !a.startsWith("--"));

if (files.length === 0) {
  console.error("usage: tsx scan-records.ts [--json=out.json] <file.CAD|dir> [...]");
  process.exit(1);
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

const targets = files.flatMap(expand);
const results = targets.map(scan);

const clean = results.filter((r) => r.ok);
const typeHist = new Map<number, number>();
const nameCounts = new Map<string, number>();

for (const r of results) {
  for (const rec of r.records) {
    typeHist.set(rec.type, (typeHist.get(rec.type) ?? 0) + 1);
    if (rec.name) nameCounts.set(rec.name, (nameCounts.get(rec.name) ?? 0) + 1);
  }
}

console.log(`files scanned        ${results.length}`);
console.log(
  `clean length-chain   ${clean.length} (${((clean.length / results.length) * 100).toFixed(2)}%)`
);
console.log(`total records        ${results.reduce((a, r) => a + r.records.length, 0)}`);
console.log(`trailer found        ${results.filter((r) => r.trailerOffset !== null).length}`);

console.log(`\nrecord TYPE histogram`);
for (const [type, count] of [...typeHist].sort((a, b) => b[1] - a[1])) {
  console.log(`  type ${String(type).padStart(5)}  x${String(count).padStart(7)}`);
}

console.log(`\ndistinct symbol names: ${nameCounts.size}`);
console.log(`top symbol names`);
for (const [name, count] of [...nameCounts].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
  console.log(`  ${name.padEnd(12)} x${String(count).padStart(7)}`);
}

const failures = results.filter((r) => !r.ok);
if (failures.length > 0) {
  console.log(`\nFAILURES (${failures.length}) — first 20`);
  for (const f of failures.slice(0, 20)) {
    console.log(`  ${path.basename(f.file)} size=${f.size}`);
    for (const g of f.gaps.filter((x) => x.reason.startsWith("desync"))) {
      console.log(`     @${g.offset} ${g.reason}`);
    }
  }
}

if (jsonOut) {
  fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
  fs.writeFileSync(jsonOut, JSON.stringify(results, null, 2), "utf8");
  console.log(`\nwrote ${jsonOut}`);
}
