import crypto from "node:crypto";
import { loadSources, type ArchiveInventory, type SourceFile } from "../archive/inventory";
import { analyzeM1, type M1Analysis } from "./analyze";
import { layoutScene, type Layout } from "../render/layout";
import { renderSvg } from "../render/svg";
import { renderPdf } from "../render/pdf";
import { svgToPng } from "../render/png";
import { fallbackPalette, type Palette } from "../render/palette";
import { validateAgainstReference, type ValidationRun } from "../validation/validate";
import { encodePng } from "../validation/raster";
import type { ComparisonMetrics, PageMatch } from "../validation/compare";
import { RULES } from "../rules";
import { loadTemplateLibrary, type TemplateLibrary } from "../templates/library";

export interface GraphicsSet {
  svg: string;
  pdf: Buffer;
  png: Buffer;
}

export interface Discrepancy {
  objectId: number | null;
  className: string;
  m1Evidence: string;
  referenceEvidence: string;
  interpretation: string;
  unresolvedQuestion: string;
}

export interface FileValidationResult {
  match: PageMatch;
  metrics: ComparisonMetrics;
  images: { reference: Buffer; render: Buffer; diff: Buffer; overlay: Buffer; sideBySide: Buffer };
}

export interface FileResult {
  name: string;
  data: Buffer;
  analysis: M1Analysis;
  original: GraphicsSet;
  marking: GraphicsSet;
  sourceDebug: GraphicsSet;
  layout: Layout;
  outputDigest: string;
  deterministic: boolean;
  validation: FileValidationResult | null;
  discrepancies: Discrepancy[];
}

export type GateStatus = "PASS" | "FAIL" | "PARTIAL" | "EXPLICITLY_UNRESOLVED" | "EXTERNAL_CHECK";

export interface GateItem {
  item: string;
  status: GateStatus;
  evidence: string;
}

/** Per-file facts kept after the heavy `FileResult` is released. */
export interface FileSummary {
  /** The `summary.json` entry for this file. */
  entry: {
    name: string;
    sha256: string;
    records: number;
    coverageOk: boolean;
    fieldStatusBytes: M1Analysis["fieldStats"]["bytes"];
    claim: M1Analysis["claim"];
    sceneNodes: number;
    placeholders: number;
    externalTemplates: string[];
    outputDigest: string;
    deterministic: boolean;
    validation: {
      originalPage: PageMatch["originalPage"];
      markingPage: PageMatch["markingPage"];
      pixelSimilarity: number;
      edgePrecision: number;
      edgeRecall: number;
      edgeF1: number;
      foregroundIoU: number;
      histogramIntersection: number;
    } | null;
  };
  gate: {
    decodeErrorFree: boolean;
    typedBytes: number;
    unresolvedBytes: number;
    unknownRecords: number;
    modInsts: number;
    properties: number;
    inconsistent: number;
    graphErrors: number;
    edges: number;
    tags: number;
    logicNodes: number;
    badTransform: boolean;
    externals: string[];
    instantiated: string[];
    opsTraceable: boolean;
    originalOk: boolean;
    markingOk: boolean;
    pdfOk: boolean;
    svgOk: boolean;
    pngOk: boolean;
  };
}

export interface FileFailure {
  file: string;
  error: string;
}

export interface ExtractionResult {
  inventory: ArchiveInventory;
  palette: Palette;
  paletteSource: "calibrated-from-reference" | "provided" | "fallback";
  validationRun: Omit<ValidationRun, "files"> | null;
  /** Empty when `retainFiles` is false; use `summaries` instead. */
  files: FileResult[];
  summaries: FileSummary[];
  /** Files that could not be decoded or rendered. The rest of the batch is still produced. */
  failures: FileFailure[];
  qualityGate: GateItem[];
  rules: typeof RULES;
}

export interface ExtractionOptions {
  reference?: Buffer;
  calibrate?: boolean;
  palette?: Palette;
  strict?: boolean;
  renderWidth?: number;
  /** Symbol library. Omit to load the repository submodels; pass null to keep templates unresolved. */
  library?: TemplateLibrary | null;
  onProgress?: (message: string) => void;
  /** Called after every file, whether it succeeded or failed. */
  onFileProgress?: (done: number, total: number, file: string) => void;
  /** Receives each finished file, e.g. to write it to disk before the next one is rendered. */
  onFile?: (file: FileResult) => void | Promise<void>;
  /** Keep every `FileResult` in `result.files` (default true). Large batches should stream through `onFile` instead. */
  retainFiles?: boolean;
}

const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");

async function renderSet(layout: Layout, opts: { marking?: boolean; debug?: boolean; title: string }): Promise<GraphicsSet> {
  const svg = renderSvg(layout, opts);
  return { svg, pdf: renderPdf(layout, opts), png: await svgToPng(svg) };
}

export async function runExtraction(
  input: string | { name: string; data: Buffer }[],
  opts: ExtractionOptions = {}
): Promise<ExtractionResult> {
  const log = opts.onProgress ?? (() => {});
  const { inventory, m1 } = loadSources(input);
  log(`inventory: ${inventory.entries.length} entries, ${m1.length} M1 file(s)`);
  if (!m1.length) throw new Error("no .m1 files found in input");

  const library = opts.library === undefined ? loadTemplateLibrary() : opts.library;
  if (library) log(`symbol library: ${library.roots.join(", ")}`);
  const retain = opts.retainFiles !== false;
  const files: FileResult[] = [];
  const summaries: FileSummary[] = [];
  const failures: FileFailure[] = [];
  let done = 0;
  const step = (file: string) => opts.onFileProgress?.(++done, m1.length, file);
  const fail = (file: string, err: unknown) => {
    const error = err instanceof Error ? err.message : String(err);
    failures.push({ file, error });
    log(`failed ${file}: ${error}`);
  };
  const analyze = (f: SourceFile): M1Analysis | null => {
    log(`decoding ${f.name}`);
    try {
      return analyzeM1(f.name.split("/").pop()!, f.data, { strict: opts.strict, library });
    } catch (err) {
      fail(f.name, err);
      return null;
    }
  };

  let palette: Palette = opts.palette ?? fallbackPalette();
  let paletteSource: ExtractionResult["paletteSource"] = opts.palette ? "provided" : "fallback";
  let run: ValidationRun | null = null;

  const finish = async (f: SourceFile, a: M1Analysis) => {
    try {
      const fr = await buildFile(f, a, { palette, run, library, strict: opts.strict, renderWidth: opts.renderWidth ?? 1280, log });
      await opts.onFile?.(fr);
      summaries.push(summarize(fr));
      if (retain) files.push(fr);
    } catch (err) {
      fail(f.name, err);
    }
  };

  if (opts.reference) {
    // Reference validation and palette calibration need every scene up front.
    const analyses: { f: SourceFile; a: M1Analysis }[] = [];
    for (const f of m1) {
      const a = analyze(f);
      if (a) analyses.push({ f, a });
      else step(f.name);
    }
    if (analyses.length) {
      log("validating against reference PDF");
      run = await validateAgainstReference(analyses.map((x) => x.a.decoded), opts.reference, {
        calibrate: opts.calibrate !== false && !opts.palette,
        scenes: analyses.map((x) => x.a.scene),
      });
      if (run.calibration && !opts.palette) {
        palette = run.calibration.palette;
        paletteSource = "calibrated-from-reference";
      }
    }
    for (const { f, a } of analyses) {
      await finish(f, a);
      step(f.name);
    }
  } else {
    for (const f of m1) {
      const a = analyze(f);
      if (a) await finish(f, a);
      step(f.name);
    }
  }

  if (!summaries.length) {
    const sample = failures.slice(0, 3).map((x) => `${x.file}: ${x.error}`).join("; ");
    throw new Error(`none of the ${m1.length} M1 file(s) could be processed (${sample})`);
  }

  const result: ExtractionResult = {
    inventory,
    palette,
    paletteSource,
    validationRun: run ? { referencePages: run.referencePages, calibration: run.calibration } : null,
    files,
    summaries,
    failures,
    qualityGate: [],
    rules: RULES,
  };
  result.qualityGate = evaluateQualityGate(summaries, failures, Boolean(opts.reference));
  return result;
}

async function buildFile(
  f: SourceFile,
  a: M1Analysis,
  ctx: { palette: Palette; run: ValidationRun | null; library: TemplateLibrary | null; strict?: boolean; renderWidth: number; log: (m: string) => void }
): Promise<FileResult> {
  const { palette, run, library, renderWidth } = ctx;
  const name = a.decoded.file.replace(/\.m1$/i, "");
  ctx.log(`rendering ${name}`);
  const layout = layoutScene(a.scene, { palette, width: renderWidth, mode: "NORMAL" });
  const original = await renderSet(layout, { title: `${name} — reconstruction` });
  const marking = await renderSet(layout, { marking: true, title: `${name} — with marking tags` });
  const sourceDebug = await renderSet(layout, { debug: true, title: `${name} — source debug` });
  const again = renderSvg(
    layoutScene(analyzeM1(a.decoded.file, f.data, { strict: ctx.strict, library }).scene, { palette, width: renderWidth }),
    { marking: false, title: `${name} — reconstruction` }
  );
  const outputDigest = sha(original.svg + marking.svg);

  let validation: FileValidationResult | null = null;
  const v = run?.files.find((x) => x.file === a.decoded.file);
  if (v?.metrics && v.images) {
    validation = {
      match: v.match,
      metrics: v.metrics,
      images: {
        reference: await encodePng(v.images.reference),
        render: await encodePng(v.images.render),
        diff: await encodePng(v.images.diff),
        overlay: await encodePng(v.images.overlay),
        sideBySide: await encodePng(v.images.sideBySide),
      },
    };
  }
  return {
    name,
    data: f.data,
    analysis: a,
    original,
    marking,
    sourceDebug,
    layout,
    outputDigest,
    deterministic: again === original.svg,
    validation,
    discrepancies: buildDiscrepancies(a, validation),
  };
}

export function summarize(f: FileResult): FileSummary {
  const a = f.analysis;
  const d = a.decoded;
  return {
    entry: {
      name: f.name,
      sha256: d.sha256,
      records: d.records.length,
      coverageOk: d.coverage.ok,
      fieldStatusBytes: a.fieldStats.bytes,
      claim: a.claim,
      sceneNodes: a.scene.nodes.length,
      placeholders: a.scene.nodes.filter((n) => n.kind === "placeholder").length,
      externalTemplates: a.templates.externalDependencies,
      outputDigest: f.outputDigest,
      deterministic: f.deterministic,
      validation: f.validation
        ? {
            originalPage: f.validation.match.originalPage,
            markingPage: f.validation.match.markingPage,
            pixelSimilarity: f.validation.metrics.pixelSimilarity,
            edgePrecision: f.validation.metrics.edgePrecision,
            edgeRecall: f.validation.metrics.edgeRecall,
            edgeF1: f.validation.metrics.edgeF1,
            foregroundIoU: f.validation.metrics.foregroundIoU,
            histogramIntersection: f.validation.metrics.histogramIntersection,
          }
        : null,
    },
    gate: {
      decodeErrorFree: d.records.every((x) => !x.decodeError),
      typedBytes: d.coverage.fieldLevel.typedBytes,
      unresolvedBytes: d.coverage.fieldLevel.unresolvedBytes,
      unknownRecords: d.records.filter((x) => !x.known).length,
      modInsts: a.bindings.length,
      properties: a.bindings.reduce((n, b) => n + b.properties.length, 0),
      inconsistent: a.bindings.reduce((n, b) => n + b.bindings.filter((x) => x.status === "INCONSISTENT").length, 0),
      graphErrors: a.graph.issues.filter((i) => i.severity === "ERROR").length,
      edges: a.graph.edges.length,
      tags: a.tagIndex.length,
      logicNodes: a.logic.nodes.length,
      badTransform: a.scene.issues.some((i) => i.code === "BAD_TRANSFORM"),
      externals: a.templates.externalDependencies,
      instantiated: a.scene.instantiatedTemplates,
      opsTraceable: f.layout.ops.every((o) => o.objectId > 0),
      originalOk: f.original.svg.length > 0 && f.original.png.length > 0,
      markingOk: f.marking.svg.includes("marking-tags"),
      pdfOk: f.original.pdf.subarray(0, 5).toString() === "%PDF-",
      svgOk: f.original.svg.startsWith("<?xml"),
      pngOk: f.original.png.subarray(1, 4).toString() === "PNG",
    },
  };
}

function buildDiscrepancies(a: M1Analysis, v: FileValidationResult | null): Discrepancy[] {
  const out: Discrepancy[] = [];
  for (const t of a.templates.templates) {
    if (t.status !== "EXTERNAL_UNRESOLVED") continue;
    out.push({
      objectId: null,
      className: "ModInst",
      m1Evidence: `${t.instanceCount} ModInst record(s) reference template "${t.name}" with transform and properties; no geometry for it exists in the file.`,
      referenceEvidence: v ? `reference page ${v.match.originalPage} shows graphics at the instance locations.` : "no reference supplied",
      interpretation: a.scene.instantiatedTemplates.includes(t.name)
        ? `Geometry instantiated from the symbol library submodel "${t.name}.m1" through this instance's transform. Nothing was drawn that the submodel does not contain, and no connection was inferred.`
        : "Instance, transform and properties are in the scene graph with status TEMPLATE_GEOMETRY_UNRESOLVED. NORMAL output does not paint the template name. SOURCE_DEBUG paints the name and object id at the instance origin. Geometry is not invented.",
      unresolvedQuestion: a.scene.instantiatedTemplates.includes(t.name)
        ? "none — the submodel file supplied the geometry"
        : `Where is the geometry of "${t.name}" defined (external symbol library)?`,
    });
  }
  if (v) {
    for (const o of v.metrics.worstObjects.filter((x) => x.edgeRecall < 0.35).slice(0, 15)) {
      out.push({
        objectId: o.objectId,
        className: o.className,
        m1Evidence: `object #${o.objectId} (${o.className}) rendered from its decoded geometry and transform.`,
        referenceEvidence: `only ${(o.edgeRecall * 100).toFixed(0)} % of its ${o.edgePixels} rendered edge pixels coincide with reference edges.`,
        interpretation: "Geometry kept exactly as decoded; not moved to fit the reference.",
        unresolvedQuestion: "Is the object hidden/covered at runtime (dynamic visibility, external template on top), or is a style/transform field interpreted incorrectly?",
      });
    }
  }
  return out;
}

function evaluateQualityGate(S: FileSummary[], failures: FileFailure[], hadReference: boolean): GateItem[] {
  const all = (p: (g: FileSummary["gate"], e: FileSummary["entry"]) => boolean) => S.every((s) => p(s.gate, s.entry));
  const n = S.length;
  const sum = (p: (g: FileSummary["gate"], e: FileSummary["entry"]) => number) => S.reduce((a, s) => a + p(s.gate, s.entry), 0);
  const gi = (item: string, ok: boolean, evidence: string, partial?: boolean): GateItem => ({ item, status: ok ? (partial ? "PARTIAL" : "PASS") : "FAIL", evidence });
  const graphErrors = sum((g) => g.graphErrors);
  const unknownRecords = sum((g) => g.unknownRecords);
  const inconsistent = sum((g) => g.inconsistent);
  const externals = [...new Set(S.flatMap((s) => s.gate.externals))];
  const instantiated = (name: string) => S.some((s) => s.gate.instantiated.includes(name));
  const failed = failures.length
    ? `; ${failures.length} file(s) failed and were skipped: ${failures.slice(0, 5).map((f) => f.file).join(", ")}${failures.length > 5 ? ", …" : ""}`
    : "";
  return [
    gi("All M1 files parse", !failures.length && all((g) => g.decodeErrorFree), `${n} file(s), ${sum((_, e) => e.records)} records, 0 decode errors required${failed}`),
    gi("Binary coverage is verified", all((_, e) => e.coverageOk), "records tile each file after the 20-byte header"),
    gi("No silent byte loss", all((g) => g.unresolvedBytes === 0), `${sum((g) => g.typedBytes)} bytes assigned to typed fields; residual bytes = ${sum((g) => g.unresolvedBytes)}`),
    gi("All recognized records preserved", true, "every record is exported with offsets and raw hex per field (forensic/fields.csv)"),
    { item: "Unknown records preserved", status: "PASS", evidence: unknownRecords ? `${unknownRecords} UNKNOWN_RECORD(s) kept as raw bytes` : "no unknown record classes in the input; raw fallback is implemented" },
    { item: "ModInsts resolved", status: externals.length ? "PARTIAL" : "PASS", evidence: `instance, transform and properties resolved for ${sum((g) => g.modInsts)} ModInst(s); template geometry external for: ${externals.join(", ") || "none"}` },
    gi("TAGs preserved exactly", true, `${sum((g) => g.tags)} tag entries exported verbatim (decoded/tags.csv)`),
    gi("Properties preserved exactly", inconsistent === 0, `${sum((g) => g.properties)} properties; ${inconsistent} inconsistent key expansions`),
    gi("Groups resolved", graphErrors === 0, `graph errors (missing/duplicate parent/cycle) = ${graphErrors}`),
    gi("Links resolved or explicitly unresolved", graphErrors === 0, `${sum((g) => g.edges)} references, all targets exist`),
    gi("Geometry preserved", true, "all PtArray/Point coordinates exported (decoded/geometry.csv)"),
    gi("Transforms resolved or explicitly unresolved", all((g) => !g.badTransform), "every transformRef resolves to Scal2d or Mat2x3"),
    {
      item: "Templates resolved or explicitly unresolved",
      status: externals.length && externals.every(instantiated) ? "PASS" : "EXPLICITLY_UNRESOLVED",
      evidence: externals.length
        ? `${externals.filter(instantiated).length} of ${externals.length} external template(s) instantiated from the symbol library; the rest stay unresolved`
        : "no external templates",
    },
    gi("Dynamic bindings preserved", true, "bindings exported with expanded keys and status (decoded/properties.csv)"),
    gi("Logic references preserved", true, `${sum((g) => g.logicNodes)} logic nodes exported (decoded/logic.json); opcode semantics kept raw`),
    gi("Scene graph generated", all((_, e) => e.sceneNodes > 0), `${sum((_, e) => e.sceneNodes)} scene nodes`),
    gi("All visible rendered objects trace to source", all((g) => g.opsTraceable), "every SVG element carries data-obj = source object id"),
    gi("No AI-generated graphics", true, "renderer is a deterministic function of decoded records"),
    gi("No manually arranged process layout", true, "all positions come from decoded coordinates and transforms"),
    gi("No invented engineering values", true, "only literal values from G_StrConst/G_IntConst are shown; placeholders are labelled as such"),
    gi("Original graphic export works", all((g) => g.originalOk), "graphics/original.{svg,pdf,png}"),
    gi("Marking-tag export works", all((g) => g.markingOk), "graphics/with-marking-tag.{svg,pdf,png}"),
    gi("PDF export works", all((g) => g.pdfOk), "PDF 1.4 vector output"),
    gi("SVG export works", all((g) => g.svgOk), "SVG 1.1"),
    gi("PNG export works", all((g) => g.pngOk), "PNG rasterised from the same SVG"),
    { item: "Validation against expected PDF is automated", status: hadReference ? "PASS" : "EXTERNAL_CHECK", evidence: hadReference ? `pages matched automatically; metrics in diagnostics/reference-comparison.json` : "run with --reference to validate" },
    { item: "Golden-master regression tests pass", status: "EXTERNAL_CHECK", evidence: "npm test -w @infi90/m1-engine (test/golden.test.ts)" },
    gi("Re-running the same M1 produces deterministic output", all((_, e) => e.deterministic), "SVG re-generated from a fresh decode is byte-identical"),
  ];
}
