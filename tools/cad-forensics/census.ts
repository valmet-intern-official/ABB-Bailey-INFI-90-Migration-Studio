/**
 * Archive-wide record census.
 *
 * For every record type, builds per-word-offset statistics across EVERY .CAD
 * file so field meanings can be read off evidence instead of guessed:
 *   - constant fields reveal format tags
 *   - wide-range fields in the coordinate band reveal geometry
 *   - small-cardinality fields reveal enums / flags
 *   - printable-run offsets reveal string slots
 *
 * Output: tools/cad-forensics/out/census.txt
 */
import fs from "node:fs";
import path from "node:path";
import { ascii, cadCorpus, stringRuns, walkRecords } from "./lib/walk";

const root = "input material (deduplicated)";
const files = cadCorpus();

const MAX_DISTINCT = 400;

interface FieldStat {
  count: number;
  zeros: number;
  min: number;
  max: number;
  distinct: Set<number>;
  overflow: boolean;
}

function newField(): FieldStat {
  return { count: 0, zeros: 0, min: Infinity, max: -Infinity, distinct: new Set(), overflow: false };
}

function observe(f: FieldStat, v: number) {
  f.count++;
  if (v === 0) f.zeros++;
  if (v < f.min) f.min = v;
  if (v > f.max) f.max = v;
  if (!f.overflow) {
    f.distinct.add(v);
    if (f.distinct.size > MAX_DISTINCT) f.overflow = true;
  }
}

interface TypeStat {
  count: number;
  lengths: Map<number, number>;
  fields: FieldStat[];
  /** How often a printable run starts at this record-relative offset. */
  stringAt: Map<number, number>;
  /** How often an 8-byte space-padded name sits at +14. */
  nameAt14: number;
  samples: Array<{ file: string; offset: number; words: number[]; text: string }>;
  /** Files this type appears in. */
  files: Set<string>;
}

const types = new Map<number, TypeStat>();

function typeStat(t: number): TypeStat {
  let s = types.get(t);
  if (!s) {
    s = {
      count: 0,
      lengths: new Map(),
      fields: [],
      stringAt: new Map(),
      nameAt14: 0,
      samples: [],
      files: new Set(),
    };
    types.set(t, s);
  }
  return s;
}

let totalFiles = 0;
let totalRecords = 0;
let desyncFiles = 0;
let noTrailer = 0;
let totalBytes = 0;
let recordBytes = 0;
let paddingBytes = 0;
let headerBytes = 0;
let trailerBytes = 0;

for (const file of files) {
  const buf = fs.readFileSync(file);
  const base = path.basename(file);
  const w = walkRecords(buf);
  totalFiles++;
  totalBytes += buf.length;
  headerBytes += Math.min(256, buf.length);
  paddingBytes += w.paddingBytes;
  trailerBytes += w.trailerOffset == null ? 0 : buf.length - w.trailerOffset;
  if (w.desyncAt != null) desyncFiles++;
  if (w.trailerOffset == null) noTrailer++;

  for (const r of w.records) {
    totalRecords++;
    recordBytes += r.lengthBytes;
    const s = typeStat(r.type);
    s.count++;
    s.files.add(base);
    s.lengths.set(r.lengthWords, (s.lengths.get(r.lengthWords) ?? 0) + 1);

    while (s.fields.length < r.words.length) s.fields.push(newField());
    for (let i = 0; i < r.words.length; i++) observe(s.fields[i], r.words[i]);

    for (const run of stringRuns(r.bytes, 3)) {
      s.stringAt.set(run.at, (s.stringAt.get(run.at) ?? 0) + 1);
    }
    if (r.bytes.length >= 22) {
      const nm = r.bytes.subarray(14, 22).toString("latin1");
      if (/^[\x20-\x7E]{8}$/.test(nm) && /[A-Za-z0-9]/.test(nm.trim())) s.nameAt14++;
    }
    if (s.samples.length < 4) {
      s.samples.push({ file: base, offset: r.offset, words: r.words, text: ascii(r.bytes) });
    }
  }
}

// ---------- report ----------
const L: string[] = [];
const say = (s = "") => L.push(s);

const COORD_LO = 100;
const COORD_HI = 16000;

function describe(f: FieldStat, idx: number): string {
  if (f.count === 0) return "unused";
  const d = f.overflow ? `>${MAX_DISTINCT}` : String(f.distinct.size);
  const zeroPct = ((f.zeros / f.count) * 100).toFixed(0);
  const vals = f.overflow
    ? ""
    : " {" +
      [...f.distinct]
        .sort((a, b) => a - b)
        .slice(0, 12)
        .join(",") +
      (f.distinct.size > 12 ? ",..}" : "}");

  let tag = "";
  if (!f.overflow && f.distinct.size === 1) tag = "CONST";
  else if (f.overflow && f.min >= COORD_LO && f.max <= COORD_HI) tag = "COORD?";
  else if (!f.overflow && f.distinct.size <= 16) tag = "ENUM?";
  else if (f.overflow) tag = "WIDE";
  else tag = "SPARSE";

  return `w${String(idx).padStart(2)} ${tag.padEnd(7)} n=${f.count} range=${f.min}..${f.max} distinct=${d} zero=${zeroPct}%${vals}`;
}

say("=".repeat(100));
say("CAD ARCHIVE RECORD CENSUS");
say("=".repeat(100));
say(`corpus               ${root}`);
say(`.CAD files           ${totalFiles}`);
say(`records              ${totalRecords}`);
say(`files desynced       ${desyncFiles}`);
say(`files w/o trailer    ${noTrailer}`);
say("");
say("BYTE ACCOUNTING (whole archive)");
const accounted = headerBytes + recordBytes + paddingBytes + trailerBytes;
say(`  total bytes        ${totalBytes}`);
say(`  header (256B/file) ${headerBytes}  (${((headerBytes / totalBytes) * 100).toFixed(2)}%)`);
say(`  record bytes       ${recordBytes}  (${((recordBytes / totalBytes) * 100).toFixed(2)}%)`);
say(`  inter-rec padding  ${paddingBytes}  (${((paddingBytes / totalBytes) * 100).toFixed(2)}%)`);
say(`  trailer bytes      ${trailerBytes}  (${((trailerBytes / totalBytes) * 100).toFixed(2)}%)`);
say(`  accounted          ${accounted}  (${((accounted / totalBytes) * 100).toFixed(2)}%)`);
say(`  UNACCOUNTED        ${totalBytes - accounted}`);
say("");

const ordered = [...types].sort((a, b) => b[1].count - a[1].count);
say("TYPE SUMMARY");
say("  type    count   files  name@14   lengths(words)");
for (const [t, s] of ordered) {
  const lens = [...s.lengths]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([l, c]) => `${l}x${c}`)
    .join(" ");
  say(
    `  ${String(t).padStart(4)} ${String(s.count).padStart(8)} ${String(s.files.size).padStart(6)} ` +
      `${((s.nameAt14 / s.count) * 100).toFixed(0).padStart(6)}%   ${lens}`
  );
}
say("");

for (const [t, s] of ordered) {
  say("=".repeat(100));
  say(`TYPE ${t}  —  ${s.count} records in ${s.files.size} files`);
  say("=".repeat(100));
  const lens = [...s.lengths].sort((a, b) => b[1] - a[1]);
  say(`lengthWords: ${lens.map(([l, c]) => `${l}(x${c})`).join(" ")}`);
  say(`8-byte name at +14: ${((s.nameAt14 / s.count) * 100).toFixed(1)}%`);
  const strAt = [...s.stringAt].sort((a, b) => b[1] - a[1]).slice(0, 10);
  say(
    `printable runs start at byte: ${strAt.map(([at, c]) => `+${at}(x${c})`).join(" ") || "(none)"}`
  );
  say("");
  for (let i = 0; i < s.fields.length && i < 40; i++) say("  " + describe(s.fields[i], i));
  say("");
  for (const smp of s.samples) {
    say(`  sample ${smp.file}@${smp.offset}`);
    say(`    words: ${smp.words.map((v, i) => `${i}:${v}`).join(" ")}`);
    say(`    ascii: "${smp.text}"`);
  }
  say("");
}

const outDir = path.join("tools", "cad-forensics", "out");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "census.txt"), L.join("\n"), "utf8");

// Console gets the summary only; the field detail is large.
console.log(L.slice(0, L.indexOf("TYPE SUMMARY") + 2 + ordered.length).join("\n"));
console.log(`\nfull census -> ${path.join(outDir, "census.txt")}  (${L.length} lines)`);
