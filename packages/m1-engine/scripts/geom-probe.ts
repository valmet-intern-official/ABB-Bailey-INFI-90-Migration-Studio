import fs from "node:fs";
import path from "node:path";
import { decodeM1 } from "../src/decoder/scanner";

const [dir, only] = process.argv.slice(2);
const counts: Record<string, Record<number, number>> = {};
const samples: Record<string, string[]> = {};
for (const f of fs.readdirSync(dir).filter((x) => /\.m1$/i.test(x)).sort()) {
  if (only && !f.startsWith(only)) continue;
  const d = decodeM1(fs.readFileSync(path.join(dir, f)), f);
  const get = (id: number) => d.records[id - 1];
  for (const r of d.records) {
    const dec = r.decoded as any;
    if (!dec?.geometry && !dec?.anchor) continue;
    const pts = (dec.geometry ?? dec.anchor).map((id: number) => get(id)?.decoded as any);
    const n = pts.map((p: any) => p?.count ?? 1).join("+");
    counts[r.className] ??= {};
    counts[r.className][n as any] = (counts[r.className][n as any] ?? 0) + 1;
    const s = (samples[r.className] ??= []);
    if (s.length < 5) {
      const tr = dec.transformRef ? get(dec.transformRef) : undefined;
      const s2 = dec.slot2 ? get(dec.slot2) : undefined;
      s.push(
        `${f.slice(0, 4)}#${r.id} pts=${JSON.stringify(pts.map((p: any) => p?.points ?? [p?.x, p?.y]))}` +
          (tr ? ` T(${tr.className})=${JSON.stringify(tr.decoded)}` : "") +
          (s2 ? ` S2=${JSON.stringify(s2.decoded)}` : "") +
          ` style=${JSON.stringify(dec.style)}` +
          (dec.startAngle !== undefined ? ` ang=${dec.startAngle},${dec.sweepAngle}` : "") +
          (dec.segments ? ` seg=${dec.segments.length} closed=${dec.closed}` : "")
      );
    }
  }
}
console.log(JSON.stringify(counts, null, 0));
for (const [k, v] of Object.entries(samples)) {
  console.log("==", k);
  for (const s of v) console.log("  ", s.slice(0, 600));
}
