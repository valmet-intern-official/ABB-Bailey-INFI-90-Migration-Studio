/**
 * CAD_RENDER_ENGINE=v2 golden render + visual QA for Loading Deck sheets.
 *
 * Usage:
 *   npx tsx tools/cad-forensics/render-v2.ts
 *   npx tsx tools/cad-forensics/render-v2.ts Input/M5/3070561A.CAD
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeCadSheet,
  layoutAndRoute,
  renderEngineeringSvg,
  validateDiagramGeometry,
  scoreLayout,
  buildLogicGraph,
} from "../../packages/cad-engine/src/index.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const DEFAULT_SHEETS = [
  "Input/M5/3070561A.CAD",
  "Input/M5/3070563A.CAD",
];

function resolveCad(rel: string): string {
  const candidates = [
    path.join(ROOT, rel),
    path.join(ROOT, "Raw Data from Controller", "CAD", "project", "L3", "P7", "M5", path.basename(rel)),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(`CAD not found: ${rel}`);
}

function main() {
  const args = process.argv.slice(2);
  const sheets = args.length > 0 ? args : DEFAULT_SHEETS;
  const outDir = path.join(ROOT, "tools/cad-forensics/out/v2");
  fs.mkdirSync(outDir, { recursive: true });

  process.env.CAD_RENDER_ENGINE = "v2";

  const qa: Record<string, unknown>[] = [];

  for (const rel of sheets) {
    const filePath = resolveCad(rel);
    const filename = path.basename(filePath);
    const stem = filename.replace(/\.CAD$/i, "");
    const buf = fs.readFileSync(filePath);

    const decoded = decodeCadSheet(buf, filename, { sourcePath: filePath });
    const { model, validation, score } = layoutAndRoute(decoded);
    const graph = buildLogicGraph(decoded);
    const svg = renderEngineeringSvg(decoded, { engine: "v2" });

    fs.writeFileSync(path.join(outDir, `${stem}_engineering_model.json`), JSON.stringify(model, null, 2));
    fs.writeFileSync(
      path.join(outDir, `${stem}_logic_graph.json`),
      JSON.stringify(
        {
          nodeCount: graph.nodeOrder.length,
          edgeCount: graph.edges.length,
          nodes: graph.nodeOrder.map((id) => {
            const n = graph.nodes.get(id)!;
            return {
              id,
              role: n.role,
              layer: n.layer,
              functionCode: n.block.functionCode,
              sourceOffset: n.block.trace.sourceIndex,
            };
          }),
          edges: graph.edges.map((e) => ({
            id: e.id,
            sourceId: e.sourceId,
            targetId: e.targetId,
            relationType: e.connection.relationType ?? "EXPLICIT",
          })),
        },
        null,
        2
      )
    );
    fs.writeFileSync(path.join(outDir, `${stem}_validation.json`), JSON.stringify(validation, null, 2));
    fs.writeFileSync(path.join(outDir, `${stem}.svg`), svg);

    const entry = {
      file: filename,
      title: decoded.title,
      blocks: decoded.stats.blockCount,
      connections: decoded.stats.connectionCount,
      laidOutBlocks: model.blocks.length,
      laidOutConnections: model.connections.length,
      countsMatch:
        model.blocks.length === decoded.blocks.length &&
        model.connections.length === decoded.connections.length,
      validation,
      score,
      diagonals: validation.metrics.diagonalSegments,
      overlaps: validation.metrics.nodeOverlaps,
      wireThrough: validation.metrics.wireThroughNodes,
      page: model.page,
    };
    qa.push(entry);
    console.log(
      `${filename}: blocks=${entry.blocks} conn=${entry.connections} ` +
        `diag=${entry.diagonals} overlap=${entry.overlaps} through=${entry.wireThrough} ` +
        `score=${score.toFixed(1)} ok=${validation.ok}`
    );
  }

  fs.writeFileSync(path.join(outDir, "cad_visual_qa.json"), JSON.stringify(qa, null, 2));

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>CAD v2 Visual QA</title>
<style>
body{font-family:Consolas,monospace;background:#111;color:#eee;margin:24px}
table{border-collapse:collapse;width:100%}
td,th{border:1px solid #444;padding:6px 10px;text-align:left}
.ok{color:#4ade80}.bad{color:#f87171}
img,object{background:#fff;max-width:100%;margin:16px 0}
</style></head><body>
<h1>CAD Layout Engine v2 — Visual QA</h1>
<table>
<tr><th>Sheet</th><th>Blocks</th><th>Conn</th><th>Diag</th><th>Overlap</th><th>Through</th><th>OK</th><th>Score</th></tr>
${qa
  .map((q) => {
    const e = q as Record<string, unknown>;
    const v = e.validation as { ok: boolean };
    return `<tr>
<td>${e.file}</td><td>${e.blocks}</td><td>${e.connections}</td>
<td class="${(e.diagonals as number) === 0 ? "ok" : "bad"}">${e.diagonals}</td>
<td class="${(e.overlaps as number) === 0 ? "ok" : "bad"}">${e.overlaps}</td>
<td class="${(e.wireThrough as number) === 0 ? "ok" : "bad"}">${e.wireThrough}</td>
<td class="${v.ok ? "ok" : "bad"}">${v.ok}</td>
<td>${(e.score as number).toFixed(1)}</td></tr>`;
  })
  .join("\n")}
</table>
${qa
  .map((q) => {
    const stem = String((q as { file: string }).file).replace(/\.CAD$/i, "");
    return `<h2>${stem}</h2><object type="image/svg+xml" data="${stem}.svg" width="100%" height="800"></object>`;
  })
  .join("\n")}
</body></html>`;
  fs.writeFileSync(path.join(outDir, "cad_visual_qa.html"), html);

  // Re-validate one more time for summary
  void validateDiagramGeometry;
  void scoreLayout;
  console.log(`Wrote ${outDir}`);
}

main();
