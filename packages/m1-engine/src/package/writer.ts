import fs from "node:fs";
import path from "node:path";
import type { ExtractionResult, FileResult } from "../pipeline/run";
import { DECODER_REVISION } from "../decoder/scanner";
import {
  fieldsCsv,
  geometryCsv,
  groupsCsv,
  hexdump,
  linksCsv,
  propertiesCsv,
  recordIndexCsv,
  recordsCsv,
  stringsCsv,
  tagsCsv,
  transformsCsv,
} from "./exports";

export type OutputFile = { path: string; data: string | Buffer };

const json = (v: unknown) => JSON.stringify(v, (_, x) => (x instanceof Map ? Object.fromEntries(x) : x), 2) + "\n";

/** Scene JSON without the duplicated binding payloads (those live in bindings.json). */
function sceneJson(f: FileResult) {
  const s = f.analysis.scene;
  return {
    file: s.file,
    modelName: s.modelName,
    extent: s.extent,
    extentRule: s.extentRule,
    contentBBox: s.contentBBox,
    stats: s.stats,
    issues: s.issues,
    renderStack: s.nodes.map((n) => {
      const { bindings, ...rest } = n as typeof n & { bindings?: unknown };
      return rest;
    }),
  };
}

export function packageFiles(f: FileResult): OutputFile[] {
  const a = f.analysis;
  const d = a.decoded;
  const p = (s: string) => `${f.name}/${s}`;
  const out: OutputFile[] = [
    { path: p(`source/${d.file}`), data: f.data },
    { path: p("source/source-info.json"), data: json({ file: d.file, size: d.size, sha256: d.sha256, decoderRevision: DECODER_REVISION }) },
    { path: p("decoded/records.csv"), data: recordsCsv(d) },
    { path: p("decoded/strings.csv"), data: stringsCsv(d) },
    { path: p("decoded/tags.csv"), data: tagsCsv(a) },
    { path: p("decoded/properties.csv"), data: propertiesCsv(a) },
    { path: p("decoded/transforms.csv"), data: transformsCsv(a) },
    { path: p("decoded/geometry.csv"), data: geometryCsv(a) },
    { path: p("decoded/groups.csv"), data: groupsCsv(a) },
    { path: p("decoded/links.csv"), data: linksCsv(a) },
    { path: p("decoded/logic.json"), data: json(a.logic) },
    { path: p("decoded/scene-graph.json"), data: json(sceneJson(f)) },
    { path: p("decoded/templates.json"), data: json(a.templates) },
    { path: p("decoded/bindings.json"), data: json(a.bindings) },
    { path: p("graphics/original.svg"), data: f.original.svg },
    { path: p("graphics/original.pdf"), data: f.original.pdf },
    { path: p("graphics/original.png"), data: f.original.png },
    { path: p("graphics/with-marking-tag.svg"), data: f.marking.svg },
    { path: p("graphics/with-marking-tag.pdf"), data: f.marking.pdf },
    { path: p("graphics/with-marking-tag.png"), data: f.marking.png },
    { path: p("graphics/source-debug.svg"), data: f.sourceDebug.svg },
    { path: p("graphics/source-debug.pdf"), data: f.sourceDebug.pdf },
    { path: p("graphics/source-debug.png"), data: f.sourceDebug.png },
    { path: p("diagnostics/coverage.json"), data: json({ coverage: d.coverage, fieldStatus: a.fieldStats, claim: a.claim }) },
    { path: p("diagnostics/object-graph.json"), data: json({ rootId: a.graph.rootId, idAllocation: a.graph.idAllocation, roleEvidence: a.graph.roleEvidence, issues: a.graph.issues }) },
    { path: p("diagnostics/marker-candidates.json"), data: json(d.markerCandidates) },
    { path: p("diagnostics/palette-usage.json"), data: json(f.layout.colorUse) },
    { path: p("diagnostics/discrepancies.json"), data: json(f.discrepancies) },
    { path: p("diagnostics/unresolved-fields.csv"), data: fieldsCsv({ ...d, header: { ...d.header, fields: [] }, records: d.records.map((r) => ({ ...r, fields: r.fields.filter((x) => x.status === "UNRESOLVED") })) }) },
    { path: p("forensic/full-hexdump.txt"), data: hexdump(f.data, d) },
    { path: p("forensic/record-index.csv"), data: recordIndexCsv(d) },
    { path: p("forensic/fields.csv"), data: fieldsCsv(d) },
  ];
  if (f.validation) {
    const { metrics, match, images } = f.validation;
    out.push(
      { path: p("diagnostics/reference-comparison.json"), data: json({ match, metrics: { ...metrics, objectScores: undefined }, objectScores: metrics.objectScores }) },
      { path: p("diagnostics/reference.png"), data: images.reference },
      { path: p("diagnostics/diff.png"), data: images.diff },
      { path: p("diagnostics/overlay.png"), data: images.overlay },
      { path: p("diagnostics/side-by-side.png"), data: images.sideBySide }
    );
  }
  return out;
}

/** Run-level files (inventory, palette, quality gate, summary). Needs only `summaries`, not `files`. */
export function runSummaryFiles(r: ExtractionResult): OutputFile[] {
  const out: OutputFile[] = [
    { path: "archive-inventory.json", data: json(r.inventory) },
    { path: "palette.json", data: json({ source: r.paletteSource, ...r.palette }) },
    { path: "rules.json", data: json(r.rules) },
    { path: "quality-gate.json", data: json(r.qualityGate) },
    {
      path: "summary.json",
      data: json({
        decoderRevision: DECODER_REVISION,
        paletteSource: r.paletteSource,
        referencePages: r.validationRun?.referencePages ?? null,
        files: r.summaries.map((s) => s.entry),
        ...(r.failures.length ? { failures: r.failures } : {}),
      }),
    },
  ];
  if (r.validationRun?.calibration) out.push({ path: "palette-calibration.json", data: json({ rejected: r.validationRun.calibration.rejected, samples: r.validationRun.calibration.samples }) });
  return out;
}

export function runFiles(r: ExtractionResult): OutputFile[] {
  const out: OutputFile[] = [];
  for (const f of r.files) out.push(...packageFiles(f));
  out.push(...runSummaryFiles(r));
  return out;
}

export function writeOutputFiles(outDir: string, files: OutputFile[]): string[] {
  for (const f of files) {
    const target = path.join(outDir, f.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.data);
  }
  return files.map((f) => f.path);
}

/** Write one file's package, e.g. from `ExtractionOptions.onFile`. */
export function writeFilePackage(outDir: string, f: FileResult): string[] {
  return writeOutputFiles(outDir, packageFiles(f));
}

export function writeOutputPackage(outDir: string, r: ExtractionResult): string[] {
  return writeOutputFiles(outDir, runFiles(r));
}
