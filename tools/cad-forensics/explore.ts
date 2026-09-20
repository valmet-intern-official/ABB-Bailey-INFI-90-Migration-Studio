/**
 * Phase 1 exploratory forensics — NOT a parser.
 *
 * Purpose: surface raw byte evidence so the record grammar can be derived from
 * the files themselves rather than assumed. Emits annotated hex, a string table
 * with byte context, and pattern statistics.
 */
import fs from "node:fs";
import path from "node:path";

const PRINTABLE_MIN = 32;
const PRINTABLE_MAX = 126;

function isPrintable(b: number): boolean {
  return b >= PRINTABLE_MIN && b <= PRINTABLE_MAX;
}

function hex(b: number): string {
  return b.toString(16).padStart(2, "0").toUpperCase();
}

function hexDump(buf: Buffer, start: number, end: number): string {
  const lines: string[] = [];
  for (let off = start; off < end; off += 16) {
    const slice = buf.subarray(off, Math.min(off + 16, end));
    const bytes = [...slice].map(hex).join(" ").padEnd(47, " ");
    const ascii = [...slice]
      .map((b) => (isPrintable(b) ? String.fromCharCode(b) : "."))
      .join("");
    lines.push(`${off.toString(10).padStart(6, " ")}  ${bytes}  |${ascii}|`);
  }
  return lines.join("\n");
}

interface StringHit {
  offset: number;
  text: string;
  /** Bytes immediately before the string — candidate length/type prefix. */
  before: number[];
  /** Bytes immediately after the string — candidate terminator/padding. */
  after: number[];
}

function stringTable(buf: Buffer, minLen = 2): StringHit[] {
  const hits: StringHit[] = [];
  let cur = "";
  let curStart = -1;

  const flush = (endExclusive: number) => {
    if (cur.length >= minLen && curStart >= 0) {
      hits.push({
        offset: curStart,
        text: cur,
        before: [...buf.subarray(Math.max(0, curStart - 6), curStart)],
        after: [...buf.subarray(endExclusive, Math.min(buf.length, endExclusive + 6))],
      });
    }
    cur = "";
    curStart = -1;
  };

  for (let i = 0; i < buf.length; i++) {
    if (isPrintable(buf[i])) {
      if (curStart < 0) curStart = i;
      cur += String.fromCharCode(buf[i]);
    } else {
      flush(i);
    }
  }
  flush(buf.length);
  return hits;
}

function byteHistogram(buf: Buffer): Array<{ byte: number; count: number }> {
  const counts = new Array(256).fill(0);
  for (const b of buf) counts[b]++;
  return counts
    .map((count, byte) => ({ byte, count }))
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count);
}

/** Find byte sequences that repeat often — candidate record delimiters. */
function repeatedPatterns(buf: Buffer, width: number, minCount: number) {
  const seen = new Map<string, number[]>();
  for (let i = 0; i + width <= buf.length; i++) {
    const key = [...buf.subarray(i, i + width)].map(hex).join(" ");
    const list = seen.get(key);
    if (list) list.push(i);
    else seen.set(key, [i]);
  }
  return [...seen.entries()]
    .filter(([, offs]) => offs.length >= minCount)
    .map(([pattern, offs]) => ({ pattern, count: offs.length, firstOffsets: offs.slice(0, 12) }))
    .sort((a, b) => b.count - a.count);
}

function analyze(file: string, opts: { fullDump: boolean }) {
  const buf = fs.readFileSync(file);
  const name = path.basename(file);
  const out: string[] = [];
  const push = (s = "") => out.push(s);

  push("=".repeat(100));
  push(`FILE        ${name}`);
  push(`PATH        ${file}`);
  push(`SIZE        ${buf.length} bytes`);
  push("=".repeat(100));

  push();
  push("--- FIRST 256 BYTES ---");
  push(hexDump(buf, 0, Math.min(256, buf.length)));

  push();
  push("--- LAST 64 BYTES ---");
  push(hexDump(buf, Math.max(0, buf.length - 64), buf.length));

  const strings = stringTable(buf);
  push();
  push(`--- STRING TABLE (${strings.length} runs, minLen=2) ---`);
  push("  offset  len  before(6B)               after(6B)                text");
  for (const s of strings) {
    const before = s.before.map(hex).join(" ").padEnd(23, " ");
    const after = s.after.map(hex).join(" ").padEnd(23, " ");
    push(
      `${s.offset.toString().padStart(8)}  ${String(s.text.length).padStart(3)}  ${before}  ${after}  ${JSON.stringify(s.text)}`
    );
  }

  const hist = byteHistogram(buf);
  push();
  push("--- TOP 24 BYTE VALUES ---");
  for (const h of hist.slice(0, 24)) {
    const ch = isPrintable(h.byte) ? ` '${String.fromCharCode(h.byte)}'` : "";
    push(`  0x${hex(h.byte)}${ch.padEnd(5)} count=${h.count}`);
  }

  for (const width of [2, 3, 4]) {
    const pats = repeatedPatterns(buf, width, Math.max(4, Math.floor(buf.length / 400)));
    push();
    push(`--- REPEATED ${width}-BYTE PATTERNS (top 15) ---`);
    for (const p of pats.slice(0, 15)) {
      push(`  ${p.pattern.padEnd(14)} x${String(p.count).padStart(4)}  @ ${p.firstOffsets.join(",")}`);
    }
  }

  if (opts.fullDump) {
    push();
    push("--- FULL HEX DUMP ---");
    push(hexDump(buf, 0, buf.length));
  }

  return out.join("\n");
}

const args = process.argv.slice(2);
const fullDump = args.includes("--full");
const files = args.filter((a) => !a.startsWith("--"));

if (files.length === 0) {
  console.error("usage: tsx explore.ts [--full] <file.CAD> [...]");
  process.exit(1);
}

const reports = files.map((f) => analyze(f, { fullDump }));
const outDir = path.join(process.cwd(), "tools", "cad-forensics", "out");
fs.mkdirSync(outDir, { recursive: true });

for (let i = 0; i < files.length; i++) {
  const dest = path.join(
    outDir,
    `${path.basename(files[i], path.extname(files[i]))}${fullDump ? ".full" : ""}.txt`
  );
  fs.writeFileSync(dest, reports[i], "utf8");
  console.log(`wrote ${dest}`);
}
