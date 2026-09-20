/**
 * Where the remaining unexplained bytes sit.
 *
 * Groups residual bytes by record type and byte offset, so the last gaps in
 * the schema can be closed by evidence rather than by guessing.
 */
import fs from "node:fs";
import { decodeRecordStream } from "@infi90/cad-engine";
import { cadCorpus } from "./lib/walk";

// offset -> { count, values }
const byType = new Map<number, Map<number, { n: number; vals: Map<number, number> }>>();
const samples = new Map<number, string[]>();

for (const f of cadCorpus()) {
  const buf = fs.readFileSync(f);
  const { records } = decodeRecordStream(buf);
  for (const r of records) {
    if (!r.residualHex) continue;
    let m = byType.get(r.type);
    if (!m) {
      m = new Map();
      byType.set(r.type, m);
    }
    for (const part of r.residualHex.split(" ")) {
      const [o, h] = part.split(":");
      const off = Number(o);
      const val = parseInt(h, 16);
      let e = m.get(off);
      if (!e) {
        e = { n: 0, vals: new Map() };
        m.set(off, e);
      }
      e.n++;
      if (e.vals.size < 30) e.vals.set(val, (e.vals.get(val) ?? 0) + 1);
    }
    const s = samples.get(r.type) ?? [];
    if (s.length < 6) {
      // Show the whole record as ascii + the residual map together.
      const slice = buf.subarray(r.offset, r.offset + r.lengthBytes);
      let asc = "";
      for (const c of slice) asc += c >= 32 && c <= 126 ? String.fromCharCode(c) : ".";
      s.push(`${f.split(/[\\/]/).pop()}@${r.offset} "${asc}"\n        residue: ${r.residualHex}`);
      samples.set(r.type, s);
    }
  }
}

for (const [t, m] of [...byType].sort((a, b) => a[0] - b[0])) {
  console.log("=".repeat(90));
  console.log(`TYPE ${t} — residual byte offsets`);
  console.log("=".repeat(90));
  for (const [off, e] of [...m].sort((a, b) => a[0] - b[0])) {
    const vals = [...e.vals]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([v, c]) => {
        const ch = v >= 32 && v <= 126 ? `'${String.fromCharCode(v)}'` : "";
        return `0x${v.toString(16).padStart(2, "0")}${ch}x${c}`;
      })
      .join(" ");
    console.log(`  +${String(off).padStart(3)}  n=${String(e.n).padStart(7)}  ${vals}`);
  }
  console.log("\n  samples:");
  for (const s of samples.get(t) ?? []) console.log(`    ${s}`);
  console.log();
}
