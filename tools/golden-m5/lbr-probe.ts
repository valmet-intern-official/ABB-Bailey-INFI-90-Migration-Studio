import fs from "node:fs";

const file = process.argv[2];
const want = (process.argv[3] ?? "").split(",").filter(Boolean);
const buf = fs.readFileSync(file);
const BLOCK = 512;

interface Entry { name: string; dirAt: number; byte: number; words: number }
const entries: Entry[] = [];
for (let b = 1; b * BLOCK < buf.length; b++) {
  const base = b * BLOCK;
  const count = buf.readUInt16LE(base + 14);
  if (buf.readUInt16LE(base + 12) !== 1 || count < 1 || count > 31) continue;
  let ok = true;
  const local: Entry[] = [];
  for (let i = 0; i < count; i++) {
    const at = base + 16 + i * 16;
    const raw = buf.subarray(at, at + 8).toString("latin1");
    if (!/^[\x20-\x7E]{8}$/.test(raw) || buf.readUInt16LE(at + 12) !== 6) { ok = false; break; }
    const hi = buf.readUInt16LE(at + 8);
    const lo = buf.readUInt16LE(at + 10);
    const words = buf.readUInt16LE(at + 14);
    const byte = (hi - 1) * BLOCK + (lo - 1) * 2;
    if (byte + words * 2 > buf.length) { ok = false; break; }
    local.push({ name: raw.trim(), dirAt: at, byte, words });
  }
  if (ok) entries.push(...local);
}
console.log(`directory entries: ${entries.length}`);

const typeCounts = new Map<number, number>();
let clean = 0;
const bad: string[] = [];
for (const e of entries) {
  const h = e.byte;
  const hw = buf.readUInt16LE(h + 4);
  const bw = buf.readUInt16LE(h + 6);
  let off = h + hw * 2;
  const end = h + e.words * 2;
  let okChain = hw + bw === e.words;
  while (off + 4 <= end) {
    const t = buf.readUInt16LE(off);
    const l = buf.readUInt16LE(off + 2);
    if (t === 0 && l === 0) { off += 2; continue; }
    if (l < 3 || off + l * 2 > end) { okChain = false; break; }
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
    off += l * 2;
  }
  if (okChain && off === end) clean++;
  else bad.push(`${e.name}@${e.byte} hw=${hw} bw=${bw} words=${e.words} stop=${off - h}`);
}
console.log(`bodies chaining exactly: ${clean}/${entries.length}`);
console.log(`record types in bodies: ${[...typeCounts].sort((a, b) => a[0] - b[0]).map(([t, n]) => `${t}:${n}`).join(" ")}`);
if (bad.length) console.log(`non-clean (first 20):\n  ${bad.slice(0, 20).join("\n  ")}`);

const str = (at: number, n: number) => {
  let s = "";
  for (let i = 0; i < n; i++) { const c = buf[at + i]; s += c >= 32 && c < 127 ? String.fromCharCode(c) : "."; }
  return s;
};
for (const name of want) {
  const e = entries.find((x) => x.name === name);
  if (!e) { console.log(`\n## ${name}: not found`); continue; }
  const h = e.byte;
  const hw = buf.readUInt16LE(h + 4);
  const hdr: number[] = [];
  for (let i = 0; i < hw; i++) hdr.push(buf.readUInt16LE(h + i * 2));
  console.log(`\n## ${name} @${h} words=${e.words} header=[${hdr.join(",")}] name='${str(h + 16, 8)}'`);
  let off = h + hw * 2;
  const end = h + e.words * 2;
  while (off + 4 <= end) {
    const t = buf.readUInt16LE(off);
    const l = buf.readUInt16LE(off + 2);
    if (t === 0 && l === 0) { off += 2; continue; }
    const w: number[] = [];
    for (let i = 0; i < l; i++) w.push(buf.readUInt16LE(off + i * 2));
    const txt = t === 5 ? ` '${str(off + 18, l * 2 - 18)}'` : t >= 6 ? ` '${str(off + 14, 8)}'` : "";
    console.log(`  +${off - h} t=${t} len=${l} [${w.slice(2, 16).join(",")}${l > 16 ? ",…" : ""}]${txt}`);
    off += l * 2;
  }
}