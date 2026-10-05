import fs from "node:fs";
import path from "node:path";
import { decodeM1 } from "../src/decoder/scanner";
import { buildObjectGraph } from "../src/objects/graph";

const [dir, file] = process.argv.slice(2);
const d = decodeM1(fs.readFileSync(path.join(dir, file)), file);
const g = buildObjectGraph(d);
for (const v of g.idAllocation.violations) {
  const r = g.byId.get(v.recordId)!;
  console.log("violation", v, r.className);
}
for (const i of g.issues.filter((x) => x.code === "ORPHAN")) {
  const r = g.byId.get(i.objectId!)!;
  console.log("orphan", r.id, r.className, "offset", r.offset, JSON.stringify(r.decoded).slice(0, 200));
  const prev = g.byId.get(r.id - 1)!;
  console.log("   prev", prev.id, prev.className, prev.refs.map((x) => `${x.field}->${x.targetId}`).join(" "));
}
