/**
 * Per-type payload inspector. Dumps every word of records of the requested
 * types so field layouts can be read off directly.
 */
import fs from "node:fs";

const HEADER_SIZE = 256;
const file = process.argv[2];
const wanted = process.argv
  .slice(3)
  .map(Number)
  .filter((n) => Number.isFinite(n));

const buf = fs.readFileSync(file);
const trailer = buf.indexOf(Buffer.from("BCCo\xC5", "latin1"), HEADER_SIZE);
const limit = trailer === -1 ? buf.length : trailer;

interface R {
  offset: number;
  type: number;
  words: number[];
  text: string;
}
const recs: R[] = [];

let off = HEADER_SIZE;
while (off + 4 <= limit) {
  if (buf.readUInt16LE(off) === 0) {
    off += 2;
    continue;
  }
  const type = buf.readUInt16LE(off);
  const lengthWords = buf.readUInt16LE(off + 2);
  const end = off + lengthWords * 2;
  if (lengthWords < 4 || end > limit) break;

  const words: number[] = [];
  for (let w = off; w + 2 <= end; w += 2) words.push(buf.readUInt16LE(w));
  const text = buf
    .subarray(off, end)
    .toString("latin1")
    .replace(/[^\x20-\x7E]/g, ".");

  recs.push({ offset: off, type, words, text });
  off = end;
}

console.log(`${file}\n${recs.length} records, limit=${limit}\n`);

const counts = new Map<number, number>();
for (const r of recs) counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
console.log(
  "types: " +
    [...counts]
      .sort((a, b) => a[0] - b[0])
      .map(([t, c]) => `${t}:${c}`)
      .join("  ")
);

for (const t of wanted) {
  const group = recs.filter((r) => r.type === t);
  console.log(`\n${"=".repeat(96)}\nTYPE ${t} — ${group.length} records\n${"=".repeat(96)}`);

  // Length distribution first: a fixed length implies a fixed field layout.
  const byLen = new Map<number, number>();
  for (const r of group) byLen.set(r.words[1], (byLen.get(r.words[1]) ?? 0) + 1);
  console.log(
    `lengthWords: ${[...byLen]
      .sort((a, b) => b[1] - a[1])
      .map(([l, c]) => `${l}(x${c})`)
      .join(" ")}`
  );

  for (const r of group.slice(0, 14)) {
    // w0=type w1=len, then the rest
    const body = r.words
      .slice(2)
      .map((v, i) => `${i + 2}:${String(v).padStart(5)}`)
      .join(" ");
    console.log(`\n @${String(r.offset).padStart(6)}  ${body}`);
    if (/[A-Za-z0-9]{2}/.test(r.text.replace(/\./g, ""))) {
      console.log(`          text="${r.text}"`);
    }
  }
}
