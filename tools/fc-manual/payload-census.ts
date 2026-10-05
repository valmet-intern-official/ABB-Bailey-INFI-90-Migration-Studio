// Census of trailer payload sizes per function code across a CAD corpus.
//   npx tsx tools/fc-manual/payload-census.ts <dir> [<dir>...]
import fs from "node:fs";
import path from "node:path";
import { decodeTrailer } from "../../packages/cad-engine/src/records/trailer";

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.cad$/i.test(e.name)) yield p;
  }
}

const hist = new Map<number, Map<number, number>>();
const examples = new Map<string, string>();
let files = 0;
for (const root of process.argv.slice(2)) {
  for (const f of walk(root)) {
    files++;
    const buf = fs.readFileSync(f);
    const t = decodeTrailer(buf);
    for (const s of t.specifications) {
      const payload = s.lengthBytes - 6;
      const m = hist.get(s.functionCode) ?? new Map<number, number>();
      m.set(payload, (m.get(payload) ?? 0) + 1);
      hist.set(s.functionCode, m);
      const key = `${s.functionCode}:${payload}`;
      if (!examples.has(key)) {
        examples.set(key, `${path.basename(f)} blk=${s.blockNumber} ${buf.subarray(s.offset + 6, s.offset + s.lengthBytes).toString("hex")}`);
      }
    }
  }
}
console.log(`files=${files}`);
for (const fc of [...hist.keys()].sort((a, b) => a - b)) {
  const m = hist.get(fc)!;
  const parts = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p}B x${n}`);
  console.log(`FC ${String(fc).padStart(3)}: ${parts.join(", ")}`);
  for (const [p] of m) console.log(`        ${p}B e.g. ${examples.get(`${fc}:${p}`)}`);
}
