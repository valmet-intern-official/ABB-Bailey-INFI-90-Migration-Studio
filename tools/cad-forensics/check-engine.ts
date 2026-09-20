/**
 * End-to-end check of the production decoder path:
 *   buffer -> decodeCadSheet -> renderEngineeringSvg
 * plus the full parseCadFile pipeline the web app actually calls.
 */
import fs from "node:fs";
import path from "node:path";
import { decodeCadSheet, renderEngineeringSvg } from "@infi90/cad-engine";
import { parseCadFile } from "@infi90/parsers";

const outDir = path.join(process.cwd(), "tools", "cad-forensics", "out", "engine");
fs.mkdirSync(outDir, { recursive: true });

for (const file of process.argv.slice(2)) {
  const buf = fs.readFileSync(file);
  const name = path.basename(file);

  const model = decodeCadSheet(buf, name);
  const sheet = parseCadFile(buf, name);

  console.log("=".repeat(78));
  console.log(name);
  console.log("=".repeat(78));
  console.log(`  page            ${model.page.width} x ${model.page.height}`);
  console.log(`  sheetId         ${model.sheetId}`);
  console.log(`  title           ${model.title ?? "(none)"}`);
  console.log(
    `  blocks          ${model.stats.blockCount}   connections ${model.stats.connectionCount}   ` +
      `tags ${model.stats.tagCount}   xrefs ${model.stats.crossRefCount}`
  );
  console.log(`  dangling wires  ${model.stats.unresolvedConnections}`);
  console.log(`  annotations     ${model.annotations.length}`);
  console.log(`  status          ${model.validation.status}`);

  const wired = model.connections.filter((c) => c.sourceBlockId && c.targetBlockId);
  console.log(`  wires attached at BOTH ends: ${wired.length}/${model.connections.length}`);
  for (const c of wired.slice(0, 6)) {
    const a = model.blocks.find((b) => b.id === c.sourceBlockId);
    const b = model.blocks.find((x) => x.id === c.targetBlockId);
    console.log(`     ${a?.functionCode ?? "?"}  ->  ${b?.functionCode ?? "?"}`);
  }

  const byFc = new Map<string, number>();
  for (const b of model.blocks) {
    const k = b.functionCode ?? "?";
    byFc.set(k, (byFc.get(k) ?? 0) + 1);
  }
  console.log(
    `  symbols: ${[...byFc]
      .sort((x, y) => y[1] - x[1])
      .map(([k, v]) => `${k}x${v}`)
      .join(" ")}`
  );

  console.log(
    `  pipeline: sheet.functionBlocks=${sheet.functionBlocks.length} ioRefs=${sheet.ioRefs.length} ` +
      `model.blocks=${sheet.engineeringModel?.blocks.length ?? 0} method=${sheet.engineeringModel?.blocks[0]?.trace.sourceMethod ?? "-"}`
  );

  const svg = renderEngineeringSvg(model);
  fs.writeFileSync(path.join(outDir, `${path.basename(file, path.extname(file))}.svg`), svg);
  console.log(`  svg             ${svg.length} bytes`);
}
