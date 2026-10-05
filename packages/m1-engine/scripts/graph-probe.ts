import fs from "node:fs";
import path from "node:path";
import { decodeM1 } from "../src/decoder/scanner";
import { buildObjectGraph } from "../src/objects/graph";

const dir = process.argv[2];
const agg = new Map<string, { count: number; targets: Record<string, number> }>();
for (const f of fs.readdirSync(dir).filter((x) => /\.m1$/i.test(x)).sort()) {
  const d = decodeM1(fs.readFileSync(path.join(dir, f)), f);
  const g = buildObjectGraph(d);
  const bySev = g.issues.reduce<Record<string, number>>((a, i) => ((a[`${i.severity}:${i.code}`] = (a[`${i.severity}:${i.code}`] ?? 0) + 1), a), {});
  console.log(`${f.padEnd(22)} edges=${g.edges.length} idChecks=${g.idAllocation.checked} idViolations=${g.idAllocation.violations.length} issues=${JSON.stringify(bySev)}`);
  for (const i of g.issues.filter((x) => x.severity === "ERROR").slice(0, 3)) console.log("   ", i.message);
  for (const e of g.roleEvidence) {
    const k = `${e.sourceClass}.${e.field}`;
    const a = agg.get(k) ?? { count: 0, targets: {} };
    a.count += e.count;
    for (const [t, n] of Object.entries(e.targets)) a.targets[t] = (a.targets[t] ?? 0) + n;
    agg.set(k, a);
  }
}
console.log("\nreference role evidence (all files):");
for (const [k, v] of [...agg].sort()) console.log(`  ${k.padEnd(34)} n=${v.count} → ${JSON.stringify(v.targets)}`);
