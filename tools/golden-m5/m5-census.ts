import fs from "node:fs";
import path from "node:path";
import { decodeRecordStream } from "../../packages/cad-engine/src/index";

const dir = process.argv[2] ?? "Test/work/M5/M5";
const types = new Map<string, number>();
const examples = new Map<string, string[]>();
const add = (k: string, ex: string) => {
  types.set(k, (types.get(k) ?? 0) + 1);
  const l = examples.get(k) ?? [];
  if (l.length < 4) l.push(ex);
  examples.set(k, l);
};
for (const f of fs.readdirSync(dir).filter((f) => /\.CAD$/i.test(f)).sort()) {
  const { records, clean } = decodeRecordStream(fs.readFileSync(path.join(dir, f)));
  if (!clean) console.log(`UNCLEAN ${f}`);
  for (const r of records) {
    if (r.kind === "polyline") add(`t1 style=${r.style} layer=${r.layer}`, `${f}@${r.offset} n=${r.points.length}`);
    else if (r.kind === "primitive2" || r.kind === "primitive3") add(`t${r.type} layer=${r.layer}`, `${f}@${r.offset} ${r.points.map((p) => `${p.x},${p.y}`).join(" ")}`);
    else if (r.kind === "text") add(`t5 layer=${r.layer} flag=${r.textHeightFlag ? 1 : 0} rot=${r.rotation}`, `${f}@${r.offset} '${r.text}'`);
    else if (r.kind === "symbol") add(`t${r.type} flags=${r.flags} rot=${r.rotation}`, `${f}@${r.offset} ${r.symbolName}`);
  }
}
for (const [k, v] of [...types].sort()) console.log(`${k.padEnd(36)} ${String(v).padStart(6)}   ${examples.get(k)!.join(" | ")}`);
