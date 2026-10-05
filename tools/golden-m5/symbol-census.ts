/**
 * Which symbol names do the M5 sheets place, and which library (if any)
 * defines each one? Libraries are searched across the whole repository.
 */
import fs from "node:fs";
import path from "node:path";
import { decodeRecordStream, readLibraryName } from "../../packages/cad-engine/src/index";

const m5 = process.argv[2] ?? "Test/work/M5/M5";
const libs: string[] = [];
const walk = (d: string) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!/node_modules|\.git|\.next/.test(e.name)) walk(p); }
    else if (/\.LBR$/i.test(e.name)) libs.push(p);
  }
};
walk(".");

const BLOCK = 512;
function dirNames(buf: Buffer): string[] {
  const out: string[] = [];
  for (let b = 1; b * BLOCK < buf.length; b++) {
    const base = b * BLOCK;
    const count = buf.readUInt16LE(base + 14);
    if (buf.readUInt16LE(base + 12) !== 1 || count < 1 || count > 31) continue;
    const local: string[] = [];
    let ok = true;
    for (let i = 0; i < count; i++) {
      const at = base + 16 + i * 16;
      const raw = buf.subarray(at, at + 8).toString("latin1");
      if (!/^[\x20-\x7E]{8}$/.test(raw) || buf.readUInt16LE(at + 12) !== 6) { ok = false; break; }
      local.push(raw.trim());
    }
    if (ok) out.push(...local);
  }
  return out;
}

const defined = new Map<string, string[]>();
for (const l of libs) {
  const names = dirNames(fs.readFileSync(l));
  console.log(`${l}  entries=${names.length}`);
  for (const n of names) defined.set(n, [...(defined.get(n) ?? []), path.basename(l)]);
}

const used = new Map<string, number>();
const libBinding = new Map<string, number>();
for (const f of fs.readdirSync(m5).filter((f) => /\.CAD$/i.test(f))) {
  const buf = fs.readFileSync(path.join(m5, f));
  const lib = readLibraryName(buf) ?? "?";
  libBinding.set(lib, (libBinding.get(lib) ?? 0) + 1);
  for (const r of decodeRecordStream(buf).records) {
    if (r.kind !== "symbol" || !r.symbolName) continue;
    used.set(r.symbolName, (used.get(r.symbolName) ?? 0) + 1);
  }
}
console.log(`\nlibrary bindings: ${[...libBinding].map(([k, v]) => `${k}:${v}`).join(" ")}`);
console.log(`distinct symbols placed in M5: ${used.size}`);
const rows = [...used].sort((a, b) => b[1] - a[1]);
for (const [n, c] of rows) console.log(`${n.padEnd(10)} ${String(c).padStart(6)}  ${(defined.get(n) ?? ["-- NOT IN ANY LIBRARY --"]).join(",")}`);
