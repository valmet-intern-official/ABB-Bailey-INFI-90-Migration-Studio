// Compares schema-decoded CAD trailer values with a vendor FC Spec Report (.LIS).
//   npx tsx tools/fc-manual/validate-lis.ts <module dir> <report.LIS>
import fs from "node:fs";
import path from "node:path";
import { decodeTrailer } from "../../packages/cad-engine/src/records/trailer";
import { decodePayload, getFunctionCode } from "../../packages/function-codes/src/index";

const [dir, lisPath] = process.argv.slice(2);

type LisBlock = { fc: number; sheet: string; specs: Map<number, { storage: string; value: string }> };
const lis = new Map<number, LisBlock>();
let cur: LisBlock | null = null;
for (const line of fs.readFileSync(lisPath, "latin1").split(/\r?\n/)) {
  const b = /^\s*Block\s+(\d+):\s+FC\s+(\d+)\s+rev\s+\d+:\s+Sheet\s+(\S+):/.exec(line);
  if (b) {
    cur = { fc: +b[2], sheet: b[3], specs: new Map() };
    lis.set(+b[1], cur);
    continue;
  }
  const s = /^\s+S(\d+)\s+(?:TO\s+)?([A-Z]\d?)\s+(\S+)/.exec(line);
  if (s && cur) cur.specs.set(+s[1], { storage: s[2], value: s[3] });
}

const cad = new Map<number, { file: string; fc: number; payload: Uint8Array }>();
const dup = new Map<number, string[]>();
for (const f of fs.readdirSync(dir).filter((n) => /\.cad$/i.test(n)).sort()) {
  const buf = fs.readFileSync(path.join(dir, f));
  for (const s of decodeTrailer(buf).specifications) {
    const prev = cad.get(s.blockNumber);
    if (prev) dup.set(s.blockNumber, [...(dup.get(s.blockNumber) ?? [prev.file]), f]);
    cad.set(s.blockNumber, { file: f, fc: s.functionCode, payload: buf.subarray(s.offset + 6, s.offset + s.lengthBytes) });
  }
}
console.log(`block numbers defined in more than one file: ${dup.size}`, [...dup].slice(0, 10).map(([b, fs]) => `${b}:${fs.join("+")}`).join(" "));

const stats = { blocks: 0, fcMismatch: 0, layout: new Map<string, number>(), specs: 0, equal: 0, differ: 0, missingInLis: 0, missingInCad: 0 };
const diffs: string[] = [];
for (const [blk, c] of cad) {
  const l = lis.get(blk);
  if (!l) continue;
  stats.blocks++;
  if (l.fc !== c.fc) {
    stats.fcMismatch++;
    diffs.push(`blk ${blk}: FC cad=${c.fc} lis=${l.fc}`);
    continue;
  }
  const schema = getFunctionCode(c.fc);
  if (!schema) continue;
  const d = decodePayload(schema, c.payload);
  stats.layout.set(d.status, (stats.layout.get(d.status) ?? 0) + 1);
  for (const s of d.specs) {
    const ref = l.specs.get(s.number);
    if (!ref) {
      stats.missingInLis++;
      continue;
    }
    stats.specs++;
    const same = ref.value === s.raw_value_text || Number(ref.value) === s.normalized_value;
    if (same) stats.equal++;
    else {
      stats.differ++;
      if (diffs.length < 60) diffs.push(`blk ${blk} FC${c.fc} S${s.number} ${s.type}/${ref.storage}: cad=${s.raw_value_text} lis=${ref.value} (${c.file})`);
    }
  }
  for (const n of l.specs.keys()) if (!d.specs.some((s) => s.number === n) && d.status === "DECODED") stats.missingInCad++;
}
const lisOnly = [...lis.keys()].filter((b) => !cad.has(b));
console.log({ ...stats, layout: Object.fromEntries(stats.layout), lisBlocks: lis.size, cadBlocks: cad.size, lisOnly: lisOnly.length });
console.log("lis-only blocks (first 20):", lisOnly.slice(0, 20).map((b) => `${b}:FC${lis.get(b)!.fc}`).join(" "));
for (const x of diffs) console.log("  " + x);
