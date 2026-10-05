import fs from "node:fs";
import { decodeM1 } from "../src/decoder/scanner";
const dir = "Guiding Material/Test 1 Data - Graphics/M10";
const f = process.argv[2];
const d = decodeM1(fs.readFileSync(dir + "/" + f), f);
const g = (id: number) => d.records[id - 1];
let n = 0;
for (const r of d.records) {
  if (r.className !== "ModInst") continue;
  const x = r.decoded as any;
  const t = g(x.transformRef);
  const props = x.props.map((p: any) => `${p.key}=${JSON.stringify((g(p.valueRef)?.decoded as any)?.value)}`).join(" ");
  const td = t?.decoded as any;
  const tr = t?.className === "Scal2d" ? `S tx=${(td.tx/65536).toFixed(3)} ty=${(td.ty/65536).toFixed(3)} sx=${td.sx.toFixed(4)} sy=${td.sy.toFixed(4)}` : t ? `M ${JSON.stringify(td)}` : "none";
  console.log(`#${r.id} ${x.templateName} | ${tr} | s2=${x.slot2 ? JSON.stringify(g(x.slot2).decoded) : "-"} | ${props.slice(0, 160)}`);
  if (++n > +(process.argv[3] ?? 40)) break;
}
