import fs from "node:fs";
import { decodeRecordStream, decodeTrailer } from "../../packages/cad-engine/src/index";

const file = process.argv[2];
const buf = fs.readFileSync(file);
const { records, coverage, clean } = decodeRecordStream(buf);
console.log(`${file} bytes=${buf.length} records=${records.length} clean=${clean} residual=${coverage.residualBytes}`);
for (const r of records) {
  const base = `@${r.offset} t${r.type} L${r.layer} len=${r.lengthBytes}`;
  if (r.kind === "polyline") console.log(`${base} POLY style=${r.style} ${r.points.map((p) => `${p.x},${p.y}`).join(" ")}`);
  else if (r.kind === "text") console.log(`${base} TEXT (${r.x1},${r.y1})-(${r.x2},${r.y2}) h=${r.textHeight}${r.textHeightFlag ? "*" : ""} rot=${r.rotation} '${r.text}'`);
  else if (r.kind === "symbol")
    console.log(`${base} SYM ${r.symbolName} bbox=(${r.x1},${r.y1})-(${r.x2},${r.y2}) ins=${r.insertionX},${r.insertionY} rot=${r.rotation} flags=${r.flags}${r.blockNumber != null ? ` blk=${r.blockNumber}` : ""}${r.tag ? ` tag='${r.tag}'` : ""}${r.reference ? ` ref=${r.reference}` : ""}${r.entries ? ` entries=${JSON.stringify(r.entries)}` : ""}${r.reserved ? ` reserved=${JSON.stringify(r.reserved)}` : ""}`);
  else console.log(`${base} ${r.kind} ${r.points.map((p) => `${p.x},${p.y}`).join(" ")} reserved=${JSON.stringify(r.reserved ?? [])}`);
}
const tr = decodeTrailer(buf);
console.log(`\ntrailer entries=${tr.entries?.length ?? "?"}`);
console.log(JSON.stringify(tr, (k, v) => (k === "raw" ? undefined : v)).slice(0, 3000));
