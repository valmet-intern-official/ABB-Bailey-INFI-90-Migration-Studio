/**
 * Writes CURRENT_GRAPHICS_GAP_REPORT.json from the M1 corpus.
 * The expected PDF is not copied into the scene; this report only counts
 * what the decoder can and cannot draw.
 */
import fs from "node:fs";
import path from "node:path";
import { corpusFiles, REPO_ROOT } from "../test/corpus";
import { analyzeM1 } from "../src/pipeline/analyze";

const screens = [
  ["1302-131pms01", "MENU_DETAILS", "1/2"],
  ["1303-131pml01", "MENU_INTERLOCKS", "3/4"],
  ["1304-131pmt01", "MENU_TRENDS", "5/6"],
  ["1305-131pmq01", "MENU_SEQUENCES", "7/8"],
  ["1311-131ps01", "PROCESS_DETAIL", "9/10"],
  ["1312-131ps02", "PROCESS_DETAIL", "11/12"],
  ["1313-131ps03", "PROCESS_DETAIL", "13/14"],
  ["1314-131ps04", "PROCESS_DETAIL", "15/16"],
  ["1323-131ps1323", "PROCESS_OVERVIEW", "17/18"],
  ["1324-131ps24", "PROCESS_OVERVIEW", "19/20"],
] as const;

const files = corpusFiles();
const byName = new Map(files.map((f) => [f.name.replace(/\.m1$/i, "").toLowerCase(), f]));
const pages = screens.map(([stem, kind, pages]) => {
  const hit = [...byName.entries()].find(([n]) => n.startsWith(stem.toLowerCase()));
  if (!hit) return { stem, kind, pages, present: false };
  const a = analyzeM1(hit[1].name, hit[1].data);
  const placeholders = a.scene.nodes.filter((n) => n.kind === "placeholder");
  const shapes = a.scene.nodes.filter((n) => n.kind === "shape").length;
  const texts = a.scene.nodes.filter((n) => n.kind === "text").length;
  return {
    stem,
    file: hit[1].name,
    classification: kind,
    referencePages: pages,
    classificationEvidence: "file stem and reference-page pairing from the supplied expected graphics PDF; classification does not add content",
    records: a.decoded.records.length,
    sceneNodes: a.scene.nodes.length,
    sourceShapes: shapes,
    sourceTexts: texts,
    templateInstances: placeholders.length,
    templateGeometryUnresolved: placeholders.length,
    externalTemplates: a.templates.externalDependencies,
    tags: a.tagIndex.length,
    present: true,
  };
});

const report = {
  generatedFrom: "M1 corpus decode; expected PDF is an oracle and is not a geometry source",
  centralDefect: "NORMAL output previously painted ModInst template resource names (iiu_stain_*, dupont_MenuPB) at instance origins. Those names are resource references. Template geometry is not stored in these M1 files.",
  correction: "NORMAL draws source geometry, source text, each instance's engineering tag, and menu captions. Template resource names are painted only in graphics/source-debug.svg. Unresolved instances remain in the scene graph as TEMPLATE_GEOMETRY_UNRESOLVED. No symbol geometry is invented.",
  remainingGap: "Pipes, equipment symbols, menu buttons and value faces that live inside the external templates cannot be drawn until those template libraries are supplied. Edge recall against the expected PDF stays low for that reason.",
  pages,
};

const out = path.join(REPO_ROOT, "packages/m1-engine/CURRENT_GRAPHICS_GAP_REPORT.json");
fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
console.log(`wrote ${out}`);
