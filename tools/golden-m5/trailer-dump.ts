import fs from "node:fs";
import { decodeRecordStream, decodeTrailer } from "../../packages/cad-engine/src/index";

const file = process.argv[2];
const buf = fs.readFileSync(file);
const tr = decodeTrailer(buf);
const recBlocks = new Set(decodeRecordStream(buf).records.filter((r) => r.blockNumber != null).map((r) => r.blockNumber));
console.log(`spc=${tr.spcOffset} atr=${tr.atrOffset} end=${tr.endOffset} entries=${tr.specifications.length}`);
for (const s of tr.specifications) {
  const vals = s.specs.map((c) => (c.likely === "float" ? Number(c.float.toPrecision(6)) : c.likely === "integer" ? c.words[0] : c.likely === "zero" ? 0 : `${c.words[0]}|${c.words[1]}`));
  console.log(`blk ${String(s.blockNumber).padStart(5)} fc ${String(s.functionCode).padStart(3)} ${recBlocks.has(s.blockNumber) ? "REC" : "---"} [${vals.join(", ")}]`);
}
if (tr.atrOffset != null && tr.endOffset != null) {
  const atr = buf.subarray(tr.atrOffset, tr.endOffset);
  console.log(`ATR ${atr.length} bytes: ${atr.toString("hex").match(/.{1,64}/g)?.join("\n    ")}`);
}
