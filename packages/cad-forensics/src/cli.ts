// Forensic engineering build for one module.
//   npx tsx packages/cad-forensics/src/cli.ts --in <dir with .CAD> --out <dir> [--module M10] [--zip <archive>]
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { toSvg, writePdf } from "@infi90/cad-engine";
import { buildScene, type ArchiveTime } from "./scene";
import { buildDocument } from "./render/document";
import { verifyDocument } from "./verify";
import { goldenDigest } from "./golden";

const args = process.argv.slice(2);
const opt = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const inDir = opt("in");
const outDir = opt("out");
if (!inDir || !outDir) {
  console.error("usage: cli.ts --in <dir> --out <dir> [--module NAME] [--zip archive.zip]");
  process.exit(2);
}
const walk = (d: string): string[] =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.cad$/i.test(e.name) ? [path.join(d, e.name)] : []));
const files = walk(inDir).sort();
const cads = files.map((p) => ({ name: path.basename(p), data: fs.readFileSync(p) }));
const module = opt("module") ?? path.basename(path.resolve(inDir));

const archiveTimes = new Map<string, ArchiveTime>();
const zip = opt("zip");
if (zip) {
  for (const e of new AdmZip(zip).getEntries()) if (/\.CAD$/i.test(e.name)) archiveTimes.set(e.name.toUpperCase(), { entry: e.entryName, mtime: e.header.time });
} else {
  for (const f of files) archiveTimes.set(path.basename(f).toUpperCase(), { entry: path.relative(path.dirname(path.resolve(inDir)), f).replace(/\\/g, "/"), mtime: fs.statSync(f).mtime });
}

const t0 = Date.now();
const { scene, reconstructed } = buildScene({ module, cads, extractDir: inDir, archiveTimes });
fs.mkdirSync(outDir, { recursive: true });
const write = (name: string, data: unknown) => fs.writeFileSync(path.join(outDir, name), JSON.stringify(data, null, 1));
write("scene_graph.json", { ...scene, entities: undefined });
write("entities.json", scene.entities);
write("function_blocks.json", scene.function_blocks);
write("sub_blocks.json", scene.sub_blocks);
write("terminals.json", scene.terminals);
write("specifications.json", scene.specifications);
write("wires.json", scene.wires);
write("connections.json", scene.connections);
write("references.json", scene.references);
write("channels.json", scene.channels);
write("unresolved.json", scene.unresolved);
console.log(`${module}: built in ${Date.now() - t0} ms`);
const c = (xs: unknown[]) => xs.length;
console.log({
  sheets: c(scene.sheets),
  entities: c(scene.entities),
  function_blocks: c(scene.function_blocks),
  sub_blocks: c(scene.sub_blocks),
  terminals: c(scene.terminals),
  specifications: c(scene.specifications),
  wires: c(scene.wires),
  connections: c(scene.connections),
  references: c(scene.references),
  channels: c(scene.channels),
  unresolved: c(scene.unresolved),
});
const v = scene.terminal_validation;
console.log("terminal methods", v.by_method);
console.log(`pitch-slot vs explicit: ${v.pitch_slot_agree}/${v.pitch_slot_checked} agree; rotated skipped ${v.rotated_blocks_skipped}`);
if (v.pitch_slot_disagree.length) console.log("disagreements (first 10)", v.pitch_slot_disagree.slice(0, 10));
const lab = scene.terminals.filter((t) => t.label);
console.log("labelled terminals by association", lab.reduce<Record<string, number>>((a, t) => ((a[t.association] = (a[t.association] ?? 0) + 1), a), {}));
console.log("labelled terminals with position", lab.filter((t) => t.page_xy).length, "of", lab.length);
console.log("unresolved by kind", scene.unresolved.reduce<Record<string, number>>((a, u) => ((a[u.kind] = (a[u.kind] ?? 0) + 1), a), {}));

const t1 = Date.now();
const doc = buildDocument(scene, reconstructed);
const pdf = writePdf(doc.pages, `${module} engineering CAD sheets`, { layers: doc.layers, outline: doc.outline });
fs.writeFileSync(path.join(outDir, `${module}_CAD_Engineering.pdf`), pdf);
const svgDir = path.join(outDir, "svg");
fs.mkdirSync(svgDir, { recursive: true });
for (const [file, items] of doc.drawingItems) fs.writeFileSync(path.join(svgDir, file.replace(/\.CAD$/i, ".svg")), toSvg(items, file));
write("annotations.json", doc.annotations);
write("coverage_matrix.json", { coverage: doc.coverage, not_rendered: doc.notRendered, annotation_not_drawn: doc.annotationSkipped, page_map: doc.pageMap });
console.log(`document: ${doc.pageMap.total} pages (drawing ${doc.pageMap.drawing.length}, detail from ${doc.pageMap.detailStart}, annex from ${doc.pageMap.annexStart}), ${(pdf.length / 1e6).toFixed(1)} MB in ${Date.now() - t1} ms`);
console.log("annotations", doc.annotations.reduce<Record<string, number>>((a, r) => ((a[`${r.kind}|${r.layer}`] = (a[`${r.kind}|${r.layer}`] ?? 0) + 1), a), {}), "not drawn", doc.annotationSkipped.length);
console.table(doc.coverage.map(({ notes, ...r }) => r));
const defects = verifyDocument(scene, doc);
write("verification.json", { defects_total: defects.length, by_kind: defects.reduce<Record<string, number>>((a, d) => ((a[d.kind] = (a[d.kind] ?? 0) + 1), a), {}), defects });
console.log(`verification: ${defects.length} defects`, defects.slice(0, 8));
const goldenOut = opt("golden");
if (goldenOut) {
  fs.mkdirSync(path.dirname(goldenOut), { recursive: true });
  fs.writeFileSync(goldenOut, JSON.stringify(goldenDigest(scene, doc, defects), null, 1));
  console.log(`golden digest -> ${goldenOut}`);
}
