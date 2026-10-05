import fs from "node:fs";
import path from "node:path";
import { parseLbrLibrary } from "../../packages/cad-engine/src/lbr/library.ts";

const want = (process.argv[3] ?? "NOT,OR2,B1,AO/L,SR,AND2,ON/OFF,TD-DIG,H/L,AIS,RI/OD,RI/OI,PRD4,EXEXEC,SEGCRM,TSTALM,MSDVDR").split(",");
const dir = process.argv[2];
const files: string[] = [];
const walk = (d: string) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (/\.LBR$/i.test(e.name)) files.push(f);
  }
};
walk(dir);
for (const f of files) {
  const lib = parseLbrLibrary(fs.readFileSync(f), path.basename(f));
  const hits = want.filter((w) => lib.symbols.has(w.toUpperCase()));
  console.log(`${path.relative(dir, f)} symbols=${lib.symbols.size} unclean=${lib.uncleanBodies.length} has=[${hits.join(",")}]`);
  const s = lib.symbols.get("NOT");
  if (s) {
    console.log("  NOT texts:", s.records.filter((r) => r.kind === "text").map((r) => r.text));
  }
}
