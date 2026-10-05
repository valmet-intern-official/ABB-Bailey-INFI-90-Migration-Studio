import fs from "node:fs";
import path from "node:path";
import { decodeM1 } from "../src/decoder/scanner";

const dir = process.argv[2];
const perClass = new Map<string, { n: number; unresolved: number; errors: number; tails: Map<number, number> }>();
for (const f of fs.readdirSync(dir).filter((x) => /\.m1$/i.test(x)).sort()) {
  const d = decodeM1(fs.readFileSync(path.join(dir, f)), f, { strict: false });
  const errs = d.records.filter((r) => r.decodeError);
  const rejected = d.markerCandidates.filter((m) => !m.accepted);
  const unknown = d.records.filter((r) => !r.known);
  console.log(
    `${f.padEnd(22)} size=${d.size} records=${d.records.length} coverage=${d.coverage.ok} ` +
      `typed=${d.coverage.fieldLevel.typedBytes} unresolved=${d.coverage.fieldLevel.unresolvedBytes} ` +
      `errors=${errs.length} unknownRecords=${unknown.length} rejectedMarkers=${rejected.length}`
  );
  for (const e of errs.slice(0, 3)) console.log(`   ERR #${e.index} ${e.className}: ${e.decodeError}`);
  for (const m of rejected) console.log(`   rejected ${m.name} @0x${m.offset.toString(16)}: ${m.reason}`);
  for (const r of d.records) {
    const st = perClass.get(r.className) ?? { n: 0, unresolved: 0, errors: 0, tails: new Map() };
    st.n++;
    st.unresolved += r.unresolvedBytes;
    if (r.decodeError) st.errors++;
    if (r.unresolvedBytes) st.tails.set(r.unresolvedBytes, (st.tails.get(r.unresolvedBytes) ?? 0) + 1);
    perClass.set(r.className, st);
  }
}
console.log("\nper class:");
for (const [k, v] of [...perClass].sort()) {
  const tails = [...v.tails].map(([a, b]) => `${a}B×${b}`).join(" ");
  console.log(`  ${k.padEnd(15)} n=${v.n} unresolvedBytes=${v.unresolved} errors=${v.errors} ${tails}`);
}
