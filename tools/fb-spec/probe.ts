// Exploratory statistics for function-block extraction on one module directory.
//   npx tsx tools/fb-spec/probe.ts <module dir>
import fs from "node:fs";
import path from "node:path";
import { reconstructModule } from "../../packages/cad-engine/src/reconstruct/pipeline";
import { decodeTrailer } from "../../packages/cad-engine/src/records/trailer";
import { getFunctionCode } from "../../packages/function-codes/src/index";

const dir = process.argv[2];
const cads = fs.readdirSync(dir).filter((n) => /\.cad$/i.test(n)).sort().map((n) => ({ name: n, data: fs.readFileSync(path.join(dir, n)) }));
const r = reconstructModule({ cads, extractDir: dir });
let drawn = 0, withBn = 0, withFc = 0, trailerEntries = 0, trailerUndrawn = 0;
const pinMatch = { equal: 0, differ: 0, noSymbol: 0 };
const differ: string[] = [];
for (const s of r.sheets) {
  const d = s.drawing;
  const t = decodeTrailer(cads.find((c) => c.name === d.file)!.data);
  trailerEntries += t.specifications.length;
  const drawnBns = new Set(d.functionBlocks.map((b) => b.blockNumber));
  trailerUndrawn += t.specifications.filter((x) => !drawnBns.has(x.blockNumber)).length;
  for (const b of d.functionBlocks) {
    drawn++;
    if (b.blockNumber != null) withBn++;
    if (b.functionCode == null) continue;
    withFc++;
    const sch = getFunctionCode(b.functionCode);
    const left = d.pins.filter((p) => p.blockId === b.id && p.side === "left");
    if (!sch || !sch.symbol.inputs.length) { pinMatch.noSymbol++; continue; }
    if (left.length === sch.symbol.inputs.length) pinMatch.equal++;
    else {
      pinMatch.differ++;
      if (differ.length < 25) differ.push(`${d.file} ${b.symbolName} FC${b.functionCode} blk${b.blockNumber}: left=${left.map((p) => p.pinName).join(",")} manual=${sch.symbol.inputs.join(",")}`);
    }
  }
}
console.log({ sheets: r.sheets.length, drawn, withBn, withFc, trailerEntries, trailerUndrawn, pinMatch, libs: r.librariesLoaded });
for (const x of differ) console.log("  " + x);
