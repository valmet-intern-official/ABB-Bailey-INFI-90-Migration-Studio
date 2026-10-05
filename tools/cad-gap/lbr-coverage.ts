import fs from "node:fs";
import path from "node:path";
import { parseLbrLibrary } from "../../packages/cad-engine/src/lbr/library.ts";
import { decodeRecordStream } from "../../packages/cad-engine/src/records/decode.ts";

const libDir = process.argv[2];
const cadDir = process.argv[3];
const walk = (d: string, re: RegExp): string[] =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name), re) : re.test(e.name) ? [path.join(d, e.name)] : []));
const libs = walk(libDir, /\.LBR$/i)
  .filter((f, i, a) => a.findIndex((g) => path.basename(g) === path.basename(f)) === i)
  .map((f) => parseLbrLibrary(fs.readFileSync(f), path.basename(f)));
const placed = new Map<string, number>();
for (const f of walk(cadDir, /\.CAD$/i)) {
  for (const r of decodeRecordStream(fs.readFileSync(f)).records) {
    if (r.kind === "symbol" && r.symbolName) placed.set(r.symbolName.toUpperCase(), (placed.get(r.symbolName.toUpperCase()) ?? 0) + 1);
  }
}
let defined = 0, undefinedN = 0;
const rows: string[] = [];
for (const [name, n] of [...placed].sort((a, b) => b[1] - a[1])) {
  const hits = libs.filter((l) => l.symbols.has(name)).map((l) => l.name);
  if (hits.length) defined += n;
  else undefinedN += n;
  rows.push(`${String(n).padStart(5)} ${name.padEnd(10)} ${hits.join(",") || "-"}`);
}
console.log(`placed symbol instances: defined in some LBR ${defined}, undefined ${undefinedN}`);
console.log(rows.join("\n"));
