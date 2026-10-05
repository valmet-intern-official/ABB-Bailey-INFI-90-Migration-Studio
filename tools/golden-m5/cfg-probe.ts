import fs from "node:fs";

const buf = fs.readFileSync(process.argv[2] ?? "Test/work/M5/M5/32605.CFG");
const want = new Set((process.argv[3] ?? "").split(",").filter(Boolean).map(Number));
// Find the entry-chain start: the offset from which [len, blk, fc] chains to EOF padding.
let best = { start: -1, n: 0, end: 0 };
for (let start = Number(process.argv[4] ?? 512); start < Number(process.argv[4] ?? 512) + (process.argv[4] ? 2 : 88); start += 2) {
  let off = start, n = 0;
  while (off + 6 <= buf.length) {
    const len = buf.readUInt16LE(off);
    if (len === 0) break;
    if (len < 3 || off + len * 2 > buf.length) { n = -1; break; }
    off += len * 2; n++;
  }
  if (n > best.n) best = { start, n, end: off };
}
console.log(`chain start=${best.start} entries=${best.n} end=${best.end} fileLen=${buf.length} tailNonZero=${[...buf.subarray(best.end)].filter((b) => b).length}`);
let off = best.start;
const fcCount = new Map<number, number>();
const blocks = new Map<number, { fc: number; words: number[] }>();
while (off + 6 <= buf.length) {
  const len = buf.readUInt16LE(off);
  if (len === 0) break;
  const blk = buf.readUInt16LE(off + 2), fc = buf.readUInt16LE(off + 4);
  const words: number[] = [];
  for (let i = 3; i < len; i++) words.push(buf.readUInt16LE(off + i * 2));
  blocks.set(blk, { fc, words });
  fcCount.set(fc, (fcCount.get(fc) ?? 0) + 1);
  if (want.has(blk)) console.log(`blk ${blk} fc ${fc} len ${len} words [${words.join(",")}]`);
  off += len * 2;
}
console.log(`distinct blocks ${blocks.size}; FCs: ${[...fcCount].sort((a, b) => a[0] - b[0]).map(([f, n]) => `${f}:${n}`).join(" ")}`);
