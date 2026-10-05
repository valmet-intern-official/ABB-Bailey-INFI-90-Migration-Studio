/**
 * M5 golden-master reconstruction and validation run.
 *
 *   npx tsx tools/golden-m5/run.ts
 *
 * Inputs : Test/M5.zip, Test/Tool Output.pdf, Test/Expected Output.pdf, and
 *          the symbol library the sheets bind to (found by name).
 * Outputs: Test/deliverables/*  (reports, SVG per sheet, corrected PDF)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { decodeRecordStream, decodeTrailer } from "../../packages/cad-engine/src/index";
import { buildDrawingSheet } from "../../packages/cad-engine/src/reconstruct/build";
import { applyZoneGrid, calibrateZoneGrid, resolveReferences } from "../../packages/cad-engine/src/reconstruct/resolve";
import { pageTransform, renderSheet, toSvg } from "../../packages/cad-engine/src/reconstruct/render";
import { writePdf } from "../../packages/cad-engine/src/reconstruct/pdf";
import { locateCfgEntries } from "../../packages/cad-engine/src/reconstruct/support";
import type { DrawingSheet } from "../../packages/cad-engine/src/reconstruct/types";
import { familyOf } from "../../packages/cad-engine/src/reconstruct/families";
import { assertSheet, libraryOffsets, type AssertionResult } from "./lib/assertions";
import { applyAffine, compareText, fitAffine, frameAffine, normText, segmentCoverage, textInliers, titleElementsPresent } from "./lib/compare";
import { loadContext, OUT, ROOT, TEST, type Context } from "./lib/context";
import { forensicInventory } from "./lib/forensic";
import { writeHtml } from "./lib/html";
import { normalizePage, type NormPage } from "./lib/oracle";
import { readPdf } from "./lib/pdf";
import { compareMasks, dilate, inkMask, MASK_STROKE, oracleSvg } from "./lib/raster";

const t0 = Date.now();
const log = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");
const writeJson = (name: string, data: unknown, pretty = true) => {
  const s = JSON.stringify(data, null, pretty ? 1 : 0);
  fs.writeFileSync(path.join(OUT, name), s);
  log(`wrote ${name} (${(s.length / 1e6).toFixed(2)} MB)`);
  return s;
};
fs.mkdirSync(path.join(OUT, "svg"), { recursive: true });
fs.mkdirSync(path.join(OUT, "visual"), { recursive: true });

const KEY_SHEETS = ["3260501A.CAD", "3260558A.CAD", "3260591A.CAD", "32605F4A.CAD", "32605Z6A.CAD"];
const ZONE_SEED = { dx: -35, dy: 2140, pitch: 100 };

// ======================================================================= build
function reconstruct(ctx: Context) {
  const specNames = ctx.support.vfy.specNames;
  const sheets = ctx.cads.map((f) => buildDrawingSheet(f.data, f.name, { registry: ctx.registry, templates: ctx.templates, zoneGrid: ZONE_SEED, specNames }));
  const calibration = calibrateZoneGrid(sheets, ctx.support.out);
  applyZoneGrid(sheets, calibration.grid);
  const registry = new Set([...ctx.support.refDescriptors, ...ctx.support.bndDescriptors].map((s) => normText(s).toUpperCase()));
  const modulePrefix = ctx.support.mhd.prefix ?? "BQ";
  const moduleStem = ctx.cads[0].name.slice(0, 5);
  resolveReferences(sheets, { modulePrefix, moduleStem, out: ctx.support.out, err: ctx.support.err, registry });
  const rendered = sheets.map((s) => renderSheet(s, ctx.registry));
  return { sheets, calibration, rendered, modulePrefix, moduleStem };
}

const ctx = loadContext();
log(`archive: ${ctx.files.length} files, ${ctx.cads.length} CAD; libraries: ${ctx.libraries.map((l) => l.path).join(", ")}`);
const run1 = reconstruct(ctx);
const { sheets, calibration, rendered } = run1;
log(`reconstructed ${sheets.length} sheets; zone grid ${JSON.stringify(calibration.grid)} agrees with I90XREF.OUT on ${calibration.agreeing}/${calibration.compared}`);

// ======================================================================= forensic
const forensic = forensicInventory(ctx.files);
const libUse = new Map<string, number>();
for (const s of sheets) for (const b of s.functionBlocks) if (b.glyph.status === "LIBRARY") libUse.set(b.symbolName, (libUse.get(b.symbolName) ?? 0) + 1);
writeJson("cad_forensic_report.json", {
  generated: "deterministic (no timestamp)",
  input: { zip: path.relative(ROOT, path.join(TEST, "M5.zip")), sha256: sha(fs.readFileSync(path.join(TEST, "M5.zip"))) },
  totals: {
    files: ctx.files.length,
    cadSheets: ctx.cads.length,
    byCategory: forensic.byCategory,
    records: sheets.reduce((a, s) => a + s.recordCount, 0),
    cleanRecordStreams: sheets.filter((s) => s.clean).length,
    unknownRecordEntries: sheets.reduce((a, s) => a + s.unknownRecords.length, 0),
  },
  symbolLibraries: ctx.libraries.map((l) => ({
    ...l,
    note: "not inside M5.zip; located in the controller project by the library name every CAD header binds to (offset 0x090)",
  })),
  securityFindings: forensic.files.filter((f) => (f as { security?: unknown }).security).map((f) => ({ file: f.name, ...(f as { security: object }).security })),
  files: forensic.files,
}, false);

// ======================================================================= CFG / VFY reconciliation
const anchors = sheets.flatMap((s) => s.functionBlocks.filter((b) => b.blockNumber != null && b.functionCode != null).map((b) => ({ blockNumber: b.blockNumber!, functionCode: b.functionCode!, sheet: s.id })));
const uniqAnchors = [...new Map(anchors.map((a) => [a.blockNumber, a])).values()];
const cfg = ctx.support.cfg ? locateCfgEntries(ctx.support.cfg, uniqAnchors) : { entries: new Map(), notFound: uniqAnchors, fcMismatch: [] };
const vfy = ctx.support.vfy;
const vfyChecks = vfy.blocks.map((vb) => {
  const s = sheets.find((x) => x.id === vb.sheet);
  const b = s?.functionBlocks.find((x) => x.blockNumber === vb.blockNumber);
  return { sheet: vb.sheet, blockNumber: vb.blockNumber, issue: vb.issue, vfySrcFc: vb.srcFc, vfyRefFc: vb.refFc, decodedFc: b?.functionCode ?? null, decodedOnSheet: Boolean(b), srcFcAgrees: vb.srcFc == null || b?.functionCode === vb.srcFc, cfgFc: cfg.entries.get(vb.blockNumber)?.functionCode ?? cfg.fcMismatch.find((m) => m.blockNumber === vb.blockNumber)?.cfgFc ?? null };
});
// Config-level corroboration of drawn block-to-block wiring (INFERRED evidence only).
let corrChecked = 0, corrHit = 0;
for (const s of sheets) {
  const pinById = new Map(s.pins.map((p) => [p.id, p]));
  const blockById = new Map(s.functionBlocks.map((b) => [b.id, b]));
  for (const n of s.nets) {
    const drivers = n.drivers.map((d) => pinById.get(d)).filter(Boolean).map((p) => blockById.get(p!.blockId)!).filter((b) => b.blockNumber != null);
    for (const sinkId of n.sinks) {
      const sp = pinById.get(sinkId);
      if (!sp) continue;
      const sb = blockById.get(sp.blockId);
      const e = sb?.blockNumber != null ? cfg.entries.get(sb.blockNumber) : undefined;
      if (!e) continue;
      for (const d of drivers) {
        corrChecked++;
        if (e.words.some((w: number) => w >= d.blockNumber! && w <= d.blockNumber! + 20)) corrHit++;
      }
    }
  }
}
const decodedBlocks = new Set(sheets.flatMap((s) => s.functionBlocks.filter((b) => b.blockNumber != null && b.functionCode != null).map((b) => b.blockNumber)));

// ======================================================================= models & graph
writeJson("cad_engineering_model.json", {
  schema: "packages/cad-engine/src/reconstruct/types.ts#DrawingSheet",
  statusLegend: { EXPLICIT: "stated by a source record or exact source-coordinate incidence", DERIVED: "computed deterministically from source records", INFERRED: "a convention applied to source data", UNRESOLVED: "not determined by the source; kept, never guessed" },
  zoneGrid: calibration,
  sheets,
}, false);

const logicGraph = sheets.map((s) => {
  const pinById = new Map(s.pins.map((p) => [p.id, p]));
  const connById = new Map(s.connections.map((c) => [c.id, c]));
  const nodes = [
    ...s.functionBlocks.map((b) => ({ id: b.id, type: "FunctionBlock", symbol: b.symbolName, fc: b.functionCode, block: b.blockNumber })),
    ...s.connectors.map((c) => ({ id: c.id, type: c.kind, tag: c.tag, reference: c.reference, zone: c.zone })),
  ];
  const edges: Array<Record<string, unknown>> = [];
  for (const n of s.nets) {
    const wires = n.connectionIds.map((id) => connById.get(id)!);
    const topology = wires.some((w) => w.relationStatus === "UNRESOLVED") ? "UNRESOLVED" : wires.some((w) => w.relationStatus === "DERIVED") ? "DERIVED" : "EXPLICIT";
    const terminals = [...n.pinIds, ...n.connectorIds];
    const dirStatus = (id: string) => (pinById.get(id) ? pinById.get(id)!.directionStatus : "EXPLICIT");
    if (n.drivers.length && n.sinks.length) {
      for (const d of n.drivers) for (const k of n.sinks) edges.push({ net: n.id, from: d, to: k, topology, direction: [dirStatus(d), dirStatus(k)].includes("INFERRED") ? "INFERRED" : "EXPLICIT", wires: n.connectionIds });
    } else if (terminals.length > 1) {
      for (let i = 1; i < terminals.length; i++) edges.push({ net: n.id, from: terminals[0], to: terminals[i], topology, direction: "UNRESOLVED", wires: n.connectionIds });
    }
  }
  return { sheet: s.file, nodes, nets: s.nets, edges };
});
const crossEdges = sheets.flatMap((s) => s.connectors.filter((c) => c.kind === "OREF" && c.resolution.targetConnectorId).map((c) => ({ from: c.id, to: c.resolution.targetConnectorId, status: c.resolution.status, relation: c.resolution.relation, reference: c.reference })));
writeJson("cad_logic_graph.json", { sheets: logicGraph, crossSheetEdges: crossEdges }, false);

// ======================================================================= reference report
const allConn = sheets.flatMap((s) => s.connectors.map((c) => ({ s, c })));
const tally = <T,>(xs: T[], f: (x: T) => string) => xs.reduce<Record<string, number>>((a, x) => ((a[f(x)] = (a[f(x)] ?? 0) + 1), a), {});
const errRows = ctx.support.err.map((e) => {
  const hit = allConn.find(({ s, c }) => s.id === e.sheet && (e.direction === "input" ? c.kind === "IREF" : c.kind === "OREF") && normText(c.tag ?? "").toUpperCase() === normText(e.description).toUpperCase());
  return { line: e.line, raw: e.raw, sheet: e.sheet, inArchive: sheets.some((s) => s.id === e.sheet), matchedConnector: hit?.c.id ?? null, decodedStatus: hit?.c.resolution.status ?? null, addressAgrees: hit ? `${run1.modulePrefix}${hit.s.id.slice(5, 7)}-${hit.c.zone}` === e.reference : null };
});
const outSheets = new Set(ctx.support.out.map((r) => r.sheet));
writeJson("cad_reference_resolution_report.json", {
  summary: {
    connectors: allConn.length,
    byKindStatus: tally(allConn, ({ c }) => `${c.kind}:${c.resolution.status}:${c.resolution.relation}`),
    byStatus: tally(allConn, ({ c }) => c.resolution.status),
    xrefOutConfirmedDestination: allConn.filter(({ s, c }) => s.crossSheetReferences.find((x) => x.connectorId === c.id)?.xrefOutConfirmed).length,
    outSourceZoneAgrees: allConn.filter(({ s, c }) => s.crossSheetReferences.find((x) => x.connectorId === c.id)?.outSourceZoneAgrees === true).length,
    outSourceZoneDisagrees: allConn.filter(({ s, c }) => s.crossSheetReferences.find((x) => x.connectorId === c.id)?.outSourceZoneAgrees === false).length,
    zoneCalibration: calibration,
    note: "I90XREF.XRF is dated 2012 while VFY/plot are 2017; zone disagreements with OUT cluster on whole sheets whose connectors were moved after the report, while the CAD's own addresses resolve to partners at the referenced zone.",
  },
  errReconciliation: {
    errRecords: errRows.length,
    inArchive: errRows.filter((r) => r.inArchive).length,
    sheetsNotInArchive: [...new Set(errRows.filter((r) => !r.inArchive).map((r) => r.sheet))],
    matchedToConnector: errRows.filter((r) => r.matchedConnector).length,
    decodedStatusOfMatched: tally(errRows.filter((r) => r.matchedConnector), (r) => r.decodedStatus ?? "none"),
    rows: errRows,
  },
  xrfReconciliation: {
    sheetsToProcess: ctx.support.xrf.sheetsToProcess,
    sheetsRead: ctx.support.xrf.sheetsRead.length,
    readButNotInArchive: ctx.support.xrf.sheetsRead.filter((x) => !sheets.some((s) => s.id === x)),
    inArchiveNotRead: sheets.filter((s) => !ctx.support.xrf.sheetsRead.includes(s.id)).map((s) => s.id),
    outSections: outSheets.size,
    blankDescriptions: ctx.support.xrf.blankDescriptions,
  },
  cfgReconciliation: {
    cfgPresent: Boolean(ctx.support.cfg),
    trailerBlocksAnchored: uniqAnchors.length,
    cfgEntriesFound: cfg.entries.size,
    cfgFcMismatch: cfg.fcMismatch,
    cfgNotFound: cfg.notFound.length,
    wiringCorroboration: { checkedDriverSinkPairs: corrChecked, sinkCfgSpecsContainDriverAddressWindow: corrHit, relation: "INFERRED (spec-slot semantics per FC not decoded)" },
  },
  vfyReconciliation: {
    vfyTotals: { source: vfy.sourceBlocksTotal, reference: vfy.referenceBlocksTotal, different: vfy.differentBlocksTotal },
    decodedDistinctBlocksWithFc: decodedBlocks.size,
    note: "VFY totals are validation evidence only; they count configuration blocks, not rendered page objects",
    differentBlocksListed: vfyChecks.length,
    decodedOnSameSheet: vfyChecks.filter((v) => v.decodedOnSheet).length,
    srcFcAgreesWithDecoded: vfyChecks.filter((v) => v.decodedOnSheet && v.srcFcAgrees).length,
    fcNamesHarvested: Object.keys(vfy.fcNames).length,
    blocks: vfyChecks,
  },
  connectors: allConn.map(({ s, c }) => ({ sheet: s.file, id: c.id, kind: c.kind, tag: c.tag, reference: c.reference, zone: c.zone, sourceOffset: c.source.offset, ...c.resolution, xref: s.crossSheetReferences.find((x) => x.connectorId === c.id) })),
});

// ======================================================================= symbol coverage
const symRows = new Map<string, { symbol: string; family: string; instances: number; glyph: string; library: string | null; fcs: Set<number>; templates: Set<string>; pinsWitnessed: number; pinsTemplateOnly: number; sheets: Set<string> }>();
for (const s of sheets) {
  for (const b of s.functionBlocks) {
    const r = symRows.get(b.symbolName) ?? { symbol: b.symbolName, family: b.family, instances: 0, glyph: b.glyph.status, library: b.glyph.library ?? null, fcs: new Set<number>(), templates: new Set<string>(), pinsWitnessed: 0, pinsTemplateOnly: 0, sheets: new Set<string>() };
    r.instances++;
    if (b.functionCode != null) r.fcs.add(b.functionCode);
    r.templates.add(`${b.sourceBBox.x2 - b.sourceBBox.x1}x${b.sourceBBox.y2 - b.sourceBBox.y1}`);
    const pins = s.pins.filter((p) => p.blockId === b.id);
    r.pinsWitnessed += pins.filter((p) => p.status === "EXPLICIT").length;
    r.pinsTemplateOnly += pins.filter((p) => p.status === "DERIVED").length;
    r.sheets.add(s.id);
    symRows.set(b.symbolName, r);
  }
  for (const c of s.connectors) {
    const r = symRows.get(c.symbolName) ?? { symbol: c.symbolName, family: familyOf(c.symbolName), instances: 0, glyph: "FALLBACK", library: null, fcs: new Set<number>(), templates: new Set<string>(), pinsWitnessed: 0, pinsTemplateOnly: 0, sheets: new Set<string>() };
    r.instances++;
    r.templates.add(`${c.sourceBBox.x2 - c.sourceBBox.x1}x${c.sourceBBox.y2 - c.sourceBBox.y1}`);
    r.pinsWitnessed += c.connectionIds.length ? 1 : 0;
    r.sheets.add(s.id);
    symRows.set(c.symbolName, r);
  }
  const jn = s.junctions.filter((j) => j.kind === "connected").length;
  if (jn) {
    const r = symRows.get("N90CNECT") ?? { symbol: "N90CNECT", family: "junction", instances: 0, glyph: "FALLBACK", library: null, fcs: new Set<number>(), templates: new Set<string>(), pinsWitnessed: 0, pinsTemplateOnly: 0, sheets: new Set<string>() };
    r.instances += jn;
    r.sheets.add(s.id);
    symRows.set("N90CNECT", r);
  }
}
const symbolCoverage = [...symRows.values()].sort((a, b) => b.instances - a.instances).map((r) => ({
  symbol: r.symbol,
  family: r.family,
  instances: r.instances,
  sheets: r.sheets.size,
  glyphStatus: r.glyph,
  library: r.library,
  functionCodes: [...r.fcs].sort((a, b) => a - b),
  fcNamesFromVfy: [...r.fcs].map((f) => vfy.fcNames[f]).filter(Boolean),
  sizeVariants: [...r.templates],
  pinTemplates: [...r.templates].map((t) => ctx.templates.get(`${r.symbol}|${t}`)).filter(Boolean).map((t) => ({ size: `${t!.width}x${t!.height}`, instancesInCorpus: t!.instances, pins: t!.pins })),
  pinsWitnessedByWires: r.pinsWitnessed,
  pinsFromTemplateOnly: r.pinsTemplateOnly,
  note: r.glyph === "LIBRARY" ? "authentic geometry from library" : "definition absent from every supplied .LBR: documented fallback glyph at source bbox with source-derived pins; NOT the proprietary symbol",
}));
const requested = ["AIS", "MFC/P", "M/A-M", "PID", "DELPID", "H/L", "NOT", "OR", "OR2", "OR4", "AND2", "AND4", "SR", "TD-DIG", "T-DIG", "DO/L", "AO/L", "AI/L", "DI/L", "RCM", "SUM", "REMSET", "DDRIVE", "APID", "AS0", "MSDVDR", "SEGCRM", "ON/OFF", "A"];
writeJson("cad_symbol_coverage_report.json", {
  summary: {
    distinctSymbols: symbolCoverage.length,
    instances: symbolCoverage.reduce((a, r) => a + r.instances, 0),
    libraryGlyphInstances: symbolCoverage.filter((r) => r.glyphStatus === "LIBRARY").reduce((a, r) => a + r.instances, 0),
    fallbackGlyphInstances: symbolCoverage.filter((r) => r.glyphStatus === "FALLBACK").reduce((a, r) => a + r.instances, 0),
    frameFromLibrary: sheets.filter((s) => s.frame.libraryResolved).length,
    missingNestedLibrarySymbols: [...new Set(rendered.flatMap((r) => r.stats.missingLibrarySymbols))],
    requestedFamilies: requested.map((n) => ({ symbol: n, present: symRows.has(n), instances: symRows.get(n)?.instances ?? 0, glyph: symRows.get(n)?.glyph ?? (n === "MFC/P" ? "not placed in M5 under this name" : "not placed in M5") })),
  },
  symbols: symbolCoverage,
});

// ======================================================================= render outputs
for (let i = 0; i < sheets.length; i++) fs.writeFileSync(path.join(OUT, "svg", `${sheets[i].id}.svg`), toSvg(rendered[i].items, sheets[i].file));
const pdf = writePdf(sheets.map((s, i) => ({ items: rendered[i].items, label: s.file })), "M5 source-faithful CAD reconstruction");
const pdfName = "M5_CAD_Reconstruction.pdf";
fs.writeFileSync(path.join(OUT, pdfName), pdf);
log(`wrote ${pdfName} (${(pdf.length / 1e6).toFixed(2)} MB, ${sheets.length} pages) and ${sheets.length} SVGs`);

// ======================================================================= oracle alignment
const expPages = readPdf(path.join(TEST, "Expected Output.pdf")).map((p) => normalizePage(p, p.unsupported.includes("Rotate 90") ? 90 : 0));
const toolPages = readPdf(path.join(TEST, "Tool Output.pdf")).map((p) => normalizePage(p, 0));
const newPdfPages = readPdf(path.join(OUT, pdfName)).map((p) => normalizePage(p, 0));
const pageOf = (pages: NormPage[]) => { const m = new Map<string, number>(); pages.forEach((p) => { if (p.cadName && !m.has(p.cadName)) m.set(p.cadName, p.index); }); return m; };
const expIdx = pageOf(expPages), toolIdx = pageOf(toolPages);
const rawNames = ctx.cads.map((c) => c.name);
const alignment = rawNames.map((n) => ({ cad: n, toolPage: toolIdx.get(n) ?? null, expectedPage: expIdx.get(n) ?? null }));
const expectedOnly = [...expIdx.keys()].filter((n) => !rawNames.includes(n));
const common = alignment.filter((a) => a.toolPage && a.expectedPage);
log(`alignment: ${common.length} common; raw-only ${alignment.filter((a) => !a.expectedPage).map((a) => a.cad).join(",")}; expected-only ${expectedOnly.join(",")}`);

// ======================================================================= per-page comparison
const RW = 1052, RH = 744;
const gapRows: string[][] = [];
const csvEsc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const perPage: Array<Record<string, any>> = [];
const allAssertions = new Map<string, AssertionResult>();
const archiveSheets = new Set(sheets.map((s) => s.file));
const connIndex = new Map(allConn.map(({ s, c }) => [c.id, { sheet: s.file, tag: c.tag }]));
const libNames = [...new Set(sheets.flatMap((s) => ["DBORDH", ...s.frame.components.map((c) => c.symbolName), ...s.functionBlocks.filter((b) => b.glyph.status === "LIBRARY").map((b) => b.symbolName)]))];
const nestedNames = (n: string, acc = new Set<string>()): Set<string> => { if (acc.has(n)) return acc; acc.add(n); for (const r of ctx.registry.get(n)?.references ?? []) nestedNames(r, acc); return acc; };
const allLibNames = [...new Set(libNames.flatMap((n) => [...nestedNames(n)]))];
const libOffs = libraryOffsets(ctx.registry, allLibNames);
const libTexts = new Set(allLibNames.flatMap((n) => (ctx.registry.get(n)?.records ?? []).filter((r) => r.kind === "text" && r.text).map((r) => r.text!)));

const categorize = (s: DrawingSheet, px: number, py: number, text: string) => {
  const tf = pageTransform(s);
  const sx = (px - tf.ox) / tf.k, sy = (py - tf.oy) / tf.k;
  // Vendor glyph captions (pin labels, S1..Sn) can extend past the bbox.
  const inB = (b: { x1: number; y1: number; x2: number; y2: number }, m = 40) => sx >= b.x1 - m && sx <= b.x2 + m && sy >= b.y1 - m && sy <= b.y2 + m;
  if (/\.CAD\s+\d\d:\d\d:\d\d/.test(text)) return { cat: "plot-stamp", obj: null as string | null };
  const blks = s.functionBlocks.filter((b) => inB(b.sourceBBox));
  const blk = blks.find((b) => b.glyph.status === "FALLBACK") ?? blks[0];
  if (blk) return { cat: blk.glyph.status === "FALLBACK" ? "glyph-internal (function library absent)" : "library-glyph", obj: blk.id };
  const con = s.connectors.find((c) => inB(c.sourceBBox));
  if (con) return { cat: "connector-internal (connector glyph absent)", obj: con.id };
  if (s.titleBlock.bbox && inB(s.titleBlock.bbox)) return { cat: "title-block", obj: null };
  return { cat: "other", obj: null };
};

for (const a of common) {
  const si = sheets.findIndex((s) => s.file === a.cad);
  const s = sheets[si];
  const items = rendered[si].items;
  const exp = expPages[a.expectedPage! - 1];
  const tool = toolPages[a.toolPage! - 1];
  const nw = newPdfPages[si];
  // The vendor re-fits some plots per page; both candidates are normalised
  // onto the expected page the same way, and the residual is reported.
  const toolFit = fitAffine(tool.runs, exp.runs);
  const toolN = toolFit ? applyAffine(tool, toolFit, exp.width, exp.height) : { ...tool, segments: [], runs: [] };
  // Only strings whose position is a source coordinate may anchor the fit.
  const sourceAnchors = new Set([...s.texts.map((t) => normText(t.text)), ...[...libTexts].map(normText)]);
  // Candidates: text consensus and the frame border; keep whichever agrees
  // with more source-positioned anchors.
  const cands = [fitAffine(nw.runs, exp.runs, sourceAnchors), frameAffine(nw.segments, exp.segments)].filter((f): f is NonNullable<typeof f> => Boolean(f));
  const scored = cands.map((f) => ({ f, q: textInliers(nw.runs, exp.runs, f, sourceAnchors) })).sort((x, y) => y.q.inliers - x.q.inliers);
  const newFit = scored[0] ? { ...scored[0].f, pairs: scored[0].q.pairs, inliers: scored[0].q.inliers, rms: scored[0].q.rms } : { sx: 1, sy: 1, tx: 0, ty: 0, pairs: 0, inliers: 0, rms: NaN };
  const nwN = applyAffine(nw, newFit, exp.width, exp.height);
  // Revision drift: do the golden master's block-number captions sit at the
  // archived blocks? Captions are mapped back to source coordinates.
  const tfp = pageTransform(s);
  const expByText = new Map<string, typeof exp.runs>();
  for (const r of exp.runs) { const k = normText(r.text); expByText.set(k, [...(expByText.get(k) ?? []), r]); }
  let capChecked = 0, capNear = 0;
  for (const b of s.functionBlocks) {
    if (b.blockNumber == null) continue;
    const rs = expByText.get(String(b.blockNumber));
    if (rs?.length !== 1) continue;
    capChecked++;
    const sx = ((rs[0].x - newFit.tx) / newFit.sx - tfp.ox) / tfp.k, sy = ((rs[0].y - newFit.ty) / newFit.sy - tfp.oy) / tfp.k;
    const B = b.sourceBBox;
    if (sx >= B.x1 - 80 && sx <= B.x2 + 120 && sy >= B.y1 - 80 && sy <= B.y2 + 80) capNear++;
  }
  const stamp = exp.runs.find((r) => /\.CAD\s+\d\d:\d\d:\d\d/.test(r.text))?.text ?? null;
  const tdNew = compareText(exp.runs, nwN.runs.map((r) => ({ text: r.text, x: r.x, y: r.y })));
  const tdTool = compareText(exp.runs, toolN.runs.map((r) => ({ text: r.text, x: r.x, y: r.y })));
  const tdToolMulti = compareText(exp.runs, tool.runs.map((r) => ({ text: r.text, x: r.x, y: r.y })), 1e9);
  const covNew = segmentCoverage(exp.segments, nwN.segments);
  const covNewRev = segmentCoverage(nwN.segments, exp.segments);
  const covTool = segmentCoverage(exp.segments, toolN.segments);
  const covToolRev = segmentCoverage(toolN.segments, exp.segments);
  const expSvg = oracleSvg(exp);
  const newSvg = toSvg(items, s.file);
  const mask = (p: NormPage, w: number, h: number) => inkMask(oracleSvg(p, { strokeWidth: MASK_STROKE }), w, h);
  const [mExp, mNew, mTool] = await Promise.all([mask(exp, RW, RH), mask(nwN, RW, RH), mask(toolN as NormPage, RW, RH)]);
  const visNew = compareMasks(mExp, mNew, RW, RH, 2);
  const visTool = compareMasks(mExp, mTool, RW, RH, 2);
  const visNew1 = compareMasks(mExp, mNew, RW, RH, 1);
  const visTool1 = compareMasks(mExp, mTool, RW, RH, 1);
  const ref = (r: { text: string }) => /^[A-Z0-9]{4}-\d\d\.\d\d$/.test(normText(r.text));
  const fcl = (r: { text: string }) => /^\(\d+\)$/.test(normText(r.text));
  const footer = /blocks:(\d+)\s+conn:(\d+)\s+tags:(\d+)\s+xref:(\d+)\s+unresolved:(\d+)/.exec(tool.runs.map((r) => r.text).join(" "));
  const missCats: Record<string, number> = {};
  for (const m of tdNew.missing) {
    const c = categorize(s, (m.x - newFit.tx) / newFit.sx, (m.y - newFit.ty) / newFit.sy, m.text);
    missCats[c.cat] = (missCats[c.cat] ?? 0) + 1;
    gapRows.push([a.cad, String(a.toolPage), String(a.expectedPage), c.obj ?? "", `TEXT_NOT_REPRODUCED:${c.cat}`, `'${m.text}' @(${m.x.toFixed(1)},${m.y.toFixed(1)})`, tdToolMulti.missing.includes(m) ? "absent" : "present (text only)", "absent at this position", c.cat.startsWith("glyph") || c.cat.startsWith("connector") ? "drawn by proprietary symbol definition absent from supplied libraries" : c.cat === "plot-stamp" ? "plotter stamp (path + time) not stored in CAD" : "not located in decoded source", c.cat.startsWith("glyph") ? "pin labels / glyph captions lost; engineering data preserved in model" : c.cat === "plot-stamp" ? "none (non-engineering)" : "review", c.cat.startsWith("glyph") || c.cat.startsWith("connector") ? "supply the SCAD function-symbol library (defines IREF/OREF/AND2/... glyphs)" : c.cat === "plot-stamp" ? "none" : "investigate", "REMAINING"]);
  }
  const toolMissSet = new Set(tdToolMulti.missing);
  for (const e of exp.runs) {
    if (!toolMissSet.has(e) || tdNew.missing.includes(e)) continue;
    gapRows.push([a.cad, String(a.toolPage), String(a.expectedPage), "", ref(e) ? "XREF_ADDRESS_MISSING_IN_TOOL" : "TEXT_MISSING_IN_TOOL", `'${e.text}'`, "absent", "reproduced at source position", "decoded source record", ref(e) ? "cross-sheet endpoint address lost in tool" : "engineering text lost in tool", "source decode (done)", "FIXED_IN_NEW"]);
  }
  for (const b of s.functionBlocks.filter((x) => x.glyph.status === "FALLBACK")) {
    const pins = s.pins.filter((p) => p.blockId === b.id);
    gapRows.push([a.cad, String(a.toolPage), String(a.expectedPage), b.id, "SYMBOL_GLYPH_FALLBACK", `${b.symbolName} (${b.functionCode ?? "?"}) blk ${b.blockNumber ?? "-"} proprietary glyph`, "generic box", `fallback '${b.family}' glyph at source bbox; ${pins.length} pins (${pins.filter((p) => p.connected).length} wired) at source coordinates`, `symbol '${b.symbolName}' absent from ${ctx.libraries.map((l) => l.name).join(",")}; record @${b.source.offset}`, "glyph shape only; identity, FC, block number, pins preserved", "supply function-symbol library", "REMAINING"]);
  }
  for (const c of s.connectors.filter((x) => x.resolution.status === "UNRESOLVED" || x.resolution.status === "AMBIGUOUS")) {
    gapRows.push([a.cad, String(a.toolPage), String(a.expectedPage), c.id, `REFERENCE_${c.resolution.status}`, `${c.kind} '${c.tag}' ${c.reference ?? "(blank)"}`, "", c.resolution.evidence.join("; "), `record @${c.source.offset}`, "signal continuity cannot be proven from source", "source data correction / missing sheet", "REMAINING (kept traceable)"]);
  }
  for (const w of s.connections.filter((x) => x.relationStatus === "UNRESOLVED")) {
    gapRows.push([a.cad, String(a.toolPage), String(a.expectedPage), w.id, "WIRE_ENDPOINT_UNRESOLVED", w.points.map((p) => `${p.x},${p.y}`).join(" "), "", "drawn verbatim, not attached", `type-1 record @${w.source.offset}`, "likely drawn graphic (arrow hatch/tick), not a signal", "none (kept)", "REMAINING (kept traceable)"]);
  }
  const res = assertSheet(s, decodeRecordStream(ctx.cads[si].data).records, items, libOffs, libTexts, new Set(decodeTrailer(ctx.cads[si].data).specifications.map((x) => x.functionCode)), connIndex, archiveSheets);
  for (const r of res) {
    const acc = allAssertions.get(r.name) ?? { name: r.name, checked: 0, violations: 0, examples: [] };
    acc.checked += r.checked; acc.violations += r.violations; acc.examples.push(...r.examples.slice(0, 5 - acc.examples.length).map((e) => `${s.id}: ${e}`));
    allAssertions.set(r.name, acc);
  }
  const sig = s.connections.filter((c) => c.connectionType === "signal");
  const jk = tally(s.junctions, (j) => j.kind);
  perPage.push({
    cad: a.cad, toolPage: a.toolPage, expectedPage: a.expectedPage,
    pageSize: { expected: `${exp.width}x${exp.height}`, tool: `${tool.width}x${tool.height}`, new: `${nw.width}x${nw.height}` },
    vectorPrimitives: { expected: exp.paintedPaths, tool: tool.paintedPaths, new: nw.paintedPaths },
    textBlocks: { expected: exp.runs.length, tool: tool.runs.length, new: nw.runs.length },
    textChars: { expected: exp.runs.reduce((x, r) => x + r.text.replace(/\s/g, "").length, 0), tool: tool.runs.reduce((x, r) => x + r.text.replace(/\s/g, "").length, 0), new: nw.runs.reduce((x, r) => x + r.text.replace(/\s/g, "").length, 0) },
    textRecall: { newMultiset: tdNew.multisetMatched / Math.max(1, tdNew.expected), newPositional: tdNew.positionalMatched / Math.max(1, tdNew.expected), toolMultiset: tdToolMulti.multisetMatched / Math.max(1, tdNew.expected), toolPositionalAfterFit: tdTool.positionalMatched / Math.max(1, tdNew.expected) },
    missingInNewByCategory: missCats,
    xrefAddresses: { expected: exp.runs.filter(ref).length, tool: tool.runs.filter(ref).length, new: nw.runs.filter(ref).length },
    fcLabels: { expected: exp.runs.filter(fcl).length, tool: tool.runs.filter(fcl).length, new: nw.runs.filter(fcl).length },
    titleElements: { expected: titleElementsPresent(exp.runs), tool: titleElementsPresent(tool.runs), new: titleElementsPresent(nw.runs) },
    geometry: { expectedInkCoveredByNew: covNew.covered / Math.max(1, covNew.length), newInkOnExpected: covNewRev.covered / Math.max(1, covNewRev.length), expectedInkCoveredByTool: covTool.covered / Math.max(1, covTool.length), toolInkOnExpected: covToolRev.covered / Math.max(1, covToolRev.length) },
    toolFit: toolFit ? { pairs: toolFit.pairs, inliers: toolFit.inliers, rmsPt: toolFit.rms, scale: [toolFit.sx, toolFit.sy] } : null,
    newFit: { pairs: newFit.pairs, inliers: newFit.inliers, rmsPt: newFit.rms, scale: [newFit.sx, newFit.sy], offset: [newFit.tx, newFit.ty] },
    revision: {
      archiveFileModified: ctx.cads[si].modified,
      expectedPlotStamp: stamp,
      blockCaptionsChecked: capChecked,
      blockCaptionsAtArchivedBlock: capNear,
      drift: capChecked >= 3 && capNear / capChecked < 0.5,
    },
    visual: { newF1: visNew.f1, newF1_1px: visNew1.f1, newIoU: visNew.iou, newPrecision: visNew.precision, newRecall: visNew.recall, toolF1: visTool.f1, toolF1_1px: visTool1.f1, toolIoU: visTool.iou },
    model: {
      functionBlocks: s.functionBlocks.length,
      fallbackGlyphs: s.functionBlocks.filter((b) => b.glyph.status === "FALLBACK").length,
      libraryGlyphs: s.functionBlocks.filter((b) => b.glyph.status === "LIBRARY").length,
      connectors: s.connectors.length,
      pins: s.pins.length, pinsWired: s.pins.filter((p) => p.connected).length, pinsDisconnected: s.pins.filter((p) => !p.connected).length,
      wires: sig.length, wiresExplicit: sig.filter((w) => w.relationStatus === "EXPLICIT").length, orphanWires: sig.filter((w) => w.relationStatus === "UNRESOLVED").length,
      junctions: jk, nets: s.nets.length,
      references: tally(s.connectors, (c) => c.resolution.status),
      frame: s.frame.libraryResolved, titleFields: s.titleBlock.fields.length,
    },
    toolFooter: footer ? { blocks: +footer[1], conn: +footer[2], tags: +footer[3], xref: +footer[4], unresolved: +footer[5] } : null,
  });
  if (KEY_SHEETS.includes(a.cad)) {
    const stem = a.cad.replace(".CAD", "");
    const png = async (svg: string, f: string) => sharp(Buffer.from(svg), { density: 216 }).png().toFile(path.join(OUT, "visual", f));
    await png(expSvg, `${stem}_expected.png`);
    await png(newSvg, `${stem}_new.png`);
    await png(oracleSvg(tool), `${stem}_tool.png`);
    const W = 2105, H = 1488;
    const [e2, n2] = await Promise.all([mask(exp, W, H), mask(nwN, W, H)]);
    const e2d = dilate(e2, W, H, 1), n2d = dilate(n2, W, H, 1);
    const rgb = Buffer.alloc(W * H * 3, 255);
    for (let i = 0; i < W * H; i++) {
      if ((e2[i] && n2d[i]) || (n2[i] && e2d[i])) { rgb[i * 3] = 0; rgb[i * 3 + 1] = 0; rgb[i * 3 + 2] = 0; }
      else if (e2[i]) { rgb[i * 3] = 230; rgb[i * 3 + 1] = 40; rgb[i * 3 + 2] = 40; }
      else if (n2[i]) { rgb[i * 3] = 30; rgb[i * 3 + 1] = 90; rgb[i * 3 + 2] = 230; }
    }
    await sharp(rgb, { raw: { width: W, height: H, channels: 3 } }).png().toFile(path.join(OUT, "visual", `${stem}_overlay.png`));
  }
}
log(`compared ${perPage.length} common sheets`);

for (const p of perPage.filter((x) => x.revision.drift)) gapRows.push([p.cad, String(p.toolPage), String(p.expectedPage), "", "GOLDEN_MASTER_REVISION_DRIFT", `block captions at archived blocks ${p.revision.blockCaptionsAtArchivedBlock}/${p.revision.blockCaptionsChecked}`, "", "rendered from archived source", `archive file ${p.revision.archiveFileModified}; plot stamp ${p.revision.expectedPlotStamp}`, "golden master reflects a later edit of this sheet", "supply the CAD revision that was plotted", "OUT_OF_SCOPE"]);
for (const n of expectedOnly) gapRows.push([n, "", String(expIdx.get(n)), "", "SHEET_EXPECTED_ONLY", `${n} present in Expected Output`, "absent", "not generated", "absent from M5.zip", "cannot be reconstructed without source", "supply the CAD file; never fabricate", "OUT_OF_SCOPE"]);
for (const a of alignment.filter((x) => !x.expectedPage)) gapRows.push([a.cad, String(a.toolPage ?? ""), "", "", "SHEET_RAW_ONLY", `${a.cad} in M5.zip`, "rendered", "rendered from source", "no golden-master page", "cannot be golden-master validated", "none; kept in output", "RENDERED_UNVALIDATED"]);

// ======================================================================= determinism
log("determinism: second full run");
const run2 = reconstruct(loadContext());
const hashA = sha(JSON.stringify(run1.sheets)), hashB = sha(JSON.stringify(run2.sheets));
const pdf2 = writePdf(run2.sheets.map((s, i) => ({ items: run2.rendered[i].items, label: s.file })), "M5 source-faithful CAD reconstruction");
const determinism = { modelSha256: [hashA, hashB], pdfSha256: [sha(pdf), sha(pdf2)], identical: hashA === hashB && sha(pdf) === sha(pdf2) };
log(`determinism identical=${determinism.identical}`);

// ======================================================================= aggregate reports
const sum = (f: (p: Record<string, any>) => number) => perPage.reduce((a, p) => a + f(p), 0);
const mean = (f: (p: Record<string, any>) => number) => sum(f) / Math.max(1, perPage.length);
const aggregate = {
  commonSheets: perPage.length,
  vectorPrimitives: { expected: sum((p) => p.vectorPrimitives.expected), tool: sum((p) => p.vectorPrimitives.tool), new: sum((p) => p.vectorPrimitives.new) },
  textBlocks: { expected: sum((p) => p.textBlocks.expected), tool: sum((p) => p.textBlocks.tool), new: sum((p) => p.textBlocks.new) },
  textChars: { expected: sum((p) => p.textChars.expected), tool: sum((p) => p.textChars.tool), new: sum((p) => p.textChars.new) },
  xrefAddresses: { expected: sum((p) => p.xrefAddresses.expected), tool: sum((p) => p.xrefAddresses.tool), new: sum((p) => p.xrefAddresses.new) },
  fcLabels: { expected: sum((p) => p.fcLabels.expected), tool: sum((p) => p.fcLabels.tool), new: sum((p) => p.fcLabels.new) },
  titleElements: { expected: sum((p) => p.titleElements.expected), tool: sum((p) => p.titleElements.tool), new: sum((p) => p.titleElements.new) },
  meanTextRecall: { newPositional: mean((p) => p.textRecall.newPositional), newMultiset: mean((p) => p.textRecall.newMultiset), toolMultiset: mean((p) => p.textRecall.toolMultiset), toolPositionalAfterFit: mean((p) => p.textRecall.toolPositionalAfterFit) },
  meanGeometry: { expectedInkCoveredByNew: mean((p) => p.geometry.expectedInkCoveredByNew), newInkOnExpected: mean((p) => p.geometry.newInkOnExpected), expectedInkCoveredByTool: mean((p) => p.geometry.expectedInkCoveredByTool), toolInkOnExpected: mean((p) => p.geometry.toolInkOnExpected) },
  meanVisual: { newF1: mean((p) => p.visual.newF1), newF1_1px: mean((p) => p.visual.newF1_1px), newIoU: mean((p) => p.visual.newIoU), toolF1: mean((p) => p.visual.toolF1), toolF1_1px: mean((p) => p.visual.toolF1_1px), toolIoU: mean((p) => p.visual.toolIoU) },
  toolFitRmsPtMean: mean((p) => p.toolFit?.rmsPt ?? 0),
  newFitRmsPtMean: mean((p) => (Number.isFinite(p.newFit.rmsPt) ? p.newFit.rmsPt : 0)),
  newFitRmsPtMedian: [...perPage.map((p) => p.newFit.rmsPt)].sort((x, y) => x - y)[Math.floor(perPage.length / 2)],
  newSheetsFitWithin1pt: perPage.filter((p) => p.newFit.rmsPt <= 1).length,
  newFitInlierShare: sum((p) => p.newFit.inliers) / Math.max(1, sum((p) => p.newFit.pairs)),
  blockCaptionAgreement: { checked: sum((p) => p.revision.blockCaptionsChecked), atArchivedBlock: sum((p) => p.revision.blockCaptionsAtArchivedBlock) },
  revisionDriftSheets: perPage.filter((p) => p.revision.drift).map((p) => ({ cad: p.cad, captions: `${p.revision.blockCaptionsAtArchivedBlock}/${p.revision.blockCaptionsChecked}`, file: p.revision.archiveFileModified, plot: p.revision.expectedPlotStamp })),
  toolFitInlierShare: sum((p) => p.toolFit?.inliers ?? 0) / Math.max(1, sum((p) => p.toolFit?.pairs ?? 0)),
  newSheetsAtStandardVendorScale: perPage.filter((p) => Math.abs(p.newFit.scale[0] - 1) < 0.002 && Math.abs(p.newFit.scale[1] - 1) < 0.002 && Math.hypot(p.newFit.offset[0], p.newFit.offset[1]) < 0.5).length,
  missingInNewByCategory: perPage.reduce<Record<string, number>>((a, p) => { for (const [k, v] of Object.entries(p.missingInNewByCategory as Record<string, number>)) a[k] = (a[k] ?? 0) + v; return a; }, {}),
  model: {
    functionBlocks: sum((p) => p.model.functionBlocks), fallbackGlyphs: sum((p) => p.model.fallbackGlyphs), libraryGlyphs: sum((p) => p.model.libraryGlyphs),
    connectors: sum((p) => p.model.connectors), pins: sum((p) => p.model.pins), pinsWired: sum((p) => p.model.pinsWired), pinsDisconnected: sum((p) => p.model.pinsDisconnected),
    wires: sum((p) => p.model.wires), wiresExplicit: sum((p) => p.model.wiresExplicit), orphanWires: sum((p) => p.model.orphanWires), nets: sum((p) => p.model.nets),
  },
  toolFooter: { blocks: sum((p) => p.toolFooter?.blocks ?? 0), conn: sum((p) => p.toolFooter?.conn ?? 0), xref: sum((p) => p.toolFooter?.xref ?? 0), unresolved: sum((p) => p.toolFooter?.unresolved ?? 0) },
};
const assertions = [...allAssertions.values()];
writeJson("cad_visual_regression_report.json", {
  method: {
    alignment: "CAD filename stamped on each oracle page -> page index; never page number",
    coordinateNormalisation: "Expected: /Rotate 90 undone to landscape points. New: native page points. Tool: least-squares scale+translation fitted on uniquely matching text anchors (residual reported).",
    vectorPrimitives: "painted paths (one per stroke/fill operator)",
    textBlocks: "Courier glyph runs merged on a shared baseline at the Courier advance",
    geometry: "length-weighted share of reference ink within 0.8 pt of candidate segments",
    visual: `ink masks at ${RW}x${RH}, every page set stroked at ${MASK_STROKE} pt; F1 of precision/recall within 2 px; IoU strict`,
  },
  alignment: { rawCadSheets: rawNames.length, toolPages: toolPages.length, expectedPages: expPages.length, commonSheets: common.length, rawOnly: alignment.filter((x) => !x.expectedPage).map((x) => x.cad), expectedOnly, map: alignment },
  aggregate,
  pages: perPage,
});
const topo = {
  summary: {
    sheets: sheets.length,
    wires: sheets.reduce((a, s) => a + s.connections.filter((c) => c.connectionType === "signal").length, 0),
    wiresByStatus: tally(sheets.flatMap((s) => s.connections.filter((c) => c.connectionType === "signal")), (c) => c.relationStatus),
    endpointKinds: tally(sheets.flatMap((s) => s.connections.filter((c) => c.connectionType === "signal").flatMap((c) => [c.from, c.to])), (e) => `${e.kind}:${e.status}`),
    rules: sheets.reduce((a, s) => a + s.connections.filter((c) => c.connectionType === "rule").length, 0),
    pins: sheets.reduce((a, s) => a + s.pins.length, 0),
    pinsByStatus: tally(sheets.flatMap((s) => s.pins), (p) => `${p.status}:${p.connected ? "wired" : "unwired"}`),
    pinDirection: tally(sheets.flatMap((s) => s.pins), (p) => `${p.direction}:${p.directionStatus}`),
    junctions: tally(sheets.flatMap((s) => s.junctions), (j) => `${j.kind}:${j.status}`),
    nets: sheets.reduce((a, s) => a + s.nets.length, 0),
    dependencies: "pin positions: source wire vertices (EXPLICIT) and per-symbol templates learned from the M5 corpus (DERIVED); pin direction by left/right side convention (INFERRED)",
  },
  antiHallucination: assertions,
  determinism,
  sheets: sheets.map((s) => ({
    sheet: s.file,
    wires: s.connections.filter((c) => c.connectionType === "signal").length,
    byStatus: tally(s.connections.filter((c) => c.connectionType === "signal"), (c) => c.relationStatus),
    orphanWires: s.connections.filter((c) => c.relationStatus === "UNRESOLVED").map((c) => ({ id: c.id, offset: c.source.offset, points: c.points })),
    pins: s.pins.length, disconnectedPins: s.pins.filter((p) => !p.connected).map((p) => p.id),
    junctions: tally(s.junctions, (j) => j.kind),
    nets: s.nets.length,
    diagnostics: s.diagnostics,
  })),
};
writeJson("cad_topology_validation_report.json", topo);
const header = ["cad_file", "tool_page", "expected_page", "object_id", "discrepancy_type", "expected_object", "tool_object", "new_object", "source_evidence", "engineering_significance", "required_correction", "status"];
fs.writeFileSync(path.join(OUT, "cad_page_by_page_gap_matrix.csv"), [header, ...gapRows].map((r) => r.map(csvEsc).join(",")).join("\n"));
log(`wrote cad_page_by_page_gap_matrix.csv (${gapRows.length} rows)`);

// Every source record must map to a typed model object.
let recTotal = 0, recMapped = 0;
const unmapped: string[] = [];
sheets.forEach((s, i) => {
  const used = new Set<number>([
    ...(s.frame.source ? [s.frame.source.offset] : []),
    ...s.frame.components.map((c) => c.source.offset),
    ...s.functionBlocks.map((b) => b.source.offset),
    ...s.connectors.map((c) => c.source.offset),
    ...s.junctions.filter((j) => j.source && j.kind === "connected").map((j) => j.source!.offset),
    ...s.connections.map((c) => c.source.offset),
    ...s.arcs.map((x) => x.source.offset),
    ...s.texts.map((t) => t.source.offset),
  ]);
  for (const r of decodeRecordStream(ctx.cads[i].data).records) {
    recTotal++;
    if (used.has(r.offset)) recMapped++;
    else if (unmapped.length < 20) unmapped.push(`${s.id}@${r.offset} t${r.type}`);
  }
});
log(`object coverage ${recMapped}/${recTotal}${unmapped.length ? ` unmapped e.g. ${unmapped.join(",")}` : ""}`);

writeHtml(path.join(OUT, "cad_golden_master_test_report.html"), {
  objectCoverage: { records: recTotal, represented: recMapped, unrepresented: recTotal - recMapped, examples: unmapped },
  frames: sheets.filter((s) => s.frame.libraryResolved).length,
  missingNested: [...new Set(rendered.flatMap((r) => r.stats.missingLibrarySymbols))],
  aggregate, perPage, alignment: { common: common.length, expectedOnly, rawOnly: alignment.filter((x) => !x.expectedPage).map((x) => x.cad) },
  assertions, determinism, calibration, keySheets: KEY_SHEETS,
  refSummary: tally(allConn, ({ c }) => `${c.kind}:${c.resolution.status}`),
  topoSummary: topo.summary,
  symbols: symbolCoverage,
  libraries: ctx.libraries,
  vfy: { totals: { source: vfy.sourceBlocksTotal, reference: vfy.referenceBlocksTotal, different: vfy.differentBlocksTotal }, decoded: decodedBlocks.size },
  cfg: { anchored: uniqAnchors.length, found: cfg.entries.size, mismatch: cfg.fcMismatch.length, corrChecked, corrHit },
  pdfName,
  gapRowCount: gapRows.length,
});
log("done");
