/**
 * Archive-wide robustness check for the production decoder.
 * Every .CAD file must decode without throwing and yield placed geometry.
 */
import fs from "node:fs";
import path from "node:path";
import { correlateSheets, decodeCadSheet, renderEngineeringSvg } from "@infi90/cad-engine";
import type { EngineeringSheetModel } from "@infi90/core";
import { cadCorpus } from "./lib/walk";

const files = cadCorpus();
const models: EngineeringSheetModel[] = [];

let ok = 0;
let empty = 0;
let threw = 0;
let blocks = 0;
let wires = 0;
let dangling = 0;
let junctions = 0;
let withTitle = 0;
const errors: string[] = [];
const t0 = Date.now();

for (const f of files) {
  try {
    const model = decodeCadSheet(fs.readFileSync(f), path.basename(f));
    if (model.blocks.length === 0) {
      empty++;
      continue;
    }
    ok++;
    models.push(model);
    blocks += model.stats.blockCount;
    wires += model.connections.length;
    dangling += model.connections.filter((c) => !c.resolved).length;
    junctions += model.blocks.filter((b) => b.type === "Junction").length;
    if (model.title) withTitle++;
    // Render a sample to prove the SVG path is safe too.
    if (ok % 500 === 0) renderEngineeringSvg(model);
  } catch (err) {
    threw++;
    if (errors.length < 12) {
      errors.push(`${path.basename(f)}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

// Cross-sheet correlation needs the whole set, so it runs once at the end.
const corr = correlateSheets(models);

const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`files scanned        ${files.length}`);
console.log(`decoded with geometry ${ok}  (${((ok / files.length) * 100).toFixed(2)}%)`);
console.log(`no geometry           ${empty}`);
console.log(`threw                 ${threw}`);
console.log(`total blocks          ${blocks}`);
console.log(`  of which junctions  ${junctions}`);
console.log(`total wire records    ${wires}`);
console.log(
  `dangling wires        ${dangling}  (${((dangling / Math.max(1, wires)) * 100).toFixed(2)}% of records)`
);
console.log(`sheets with a title   ${withTitle}  (${((withTitle / ok) * 100).toFixed(1)}%)`);
console.log("");
console.log("cross-sheet correlation");
console.log(`  references            ${corr.references}`);
console.log(
  `  resolved by registry ${corr.resolvedByRegistry}  (${((corr.resolvedByRegistry / corr.references) * 100).toFixed(2)}%)`
);
console.log(
  `  resolved same-loop   ${corr.resolvedBySameLoop}  (${((corr.resolvedBySameLoop / corr.references) * 100).toFixed(2)}%)`
);
console.log(
  `  unresolved           ${corr.unresolved}  (${((corr.unresolved / corr.references) * 100).toFixed(2)}%)  target outside archive: ${corr.targetOutsideArchive}`
);
console.log(`  module prefixes learned ${corr.moduleMap.length}`);
console.log(`elapsed               ${secs}s`);
for (const e of errors) console.log(`  ERR ${e}`);
