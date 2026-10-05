/**
 * CAD output gap audit: expected vendor plot vs a generated CAD PDF, at
 * entity/category level, with every missing item listed and attributed to
 * the source model (is it decodable from the CAD + manual, and if so, which
 * layer drops it?).
 *
 *   npx tsx tools/cad-gap/audit.mts --expected <pdf> --current <pdf>
 *        --extract <dir with .CAD> [--zip <archive>] [--out <dir>] [--name <report stem>]
 *
 * The expected PDF is an oracle only: nothing read from it is ever written
 * into the generated model.
 */
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { runModule } from "../../packages/fb-spec/src/run.ts";
import { getFunctionCode, outputOffsets } from "../../packages/function-codes/src/index.ts";
import { readPdfText, type PageCensus } from "./pdf-text.mts";

const args = process.argv.slice(2);
const opt = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const expectedPdf = opt("expected")!;
const currentPdf = opt("current")!;
const extractDir = opt("extract")!;
const zipPath = opt("zip");
const outDir = opt("out") ?? ".";
const stem = opt("name") ?? "CURRENT_CAD_OUTPUT_GAP_REPORT";
if (!expectedPdf || !currentPdf || !extractDir) {
  console.error("usage: audit.mts --expected <pdf> --current <pdf> --extract <dir> [--zip <zip>] [--out <dir>]");
  process.exit(2);
}

// ------------------------------------------------------------ source model
const walk = (d: string): string[] =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.cad$/i.test(e.name) ? [path.join(d, e.name)] : []));
const cads = walk(extractDir).sort().map((p) => ({ name: path.basename(p), data: fs.readFileSync(p) }));
console.log(`source: ${cads.length} CAD files`);
const { result: fb, reconstructed } = runModule({ module: path.basename(path.resolve(extractDir)), cads, extractDir });

const zipTimes = new Map<string, { entry: string; mtime: Date }>();
if (zipPath) {
  for (const e of new AdmZip(zipPath).getEntries()) {
    if (/\.CAD$/i.test(e.name)) zipTimes.set(e.name.toUpperCase(), { entry: e.entryName, mtime: e.header.time });
  }
}

const despace = (s: string) => (/^(\S )+\S$/.test(s.trim()) ? s.trim().replace(/ /g, "") : s.trim());

interface SheetModel {
  file: string;
  blockAddresses: Map<number, { fc: number | null; symbol: string | null }>;
  subAddresses: Map<number, { parent: number; k: number; fc: number }>;
  sLabels: Map<string, Array<{ block: number; fc: number; mapped: boolean }>>;
  symbolLabels: Map<string, Array<{ block: number; fc: number }>>;
  fcCodes: Set<string>;
  functionNames: Set<string>;
  titleTokens: Set<string>;
  sourceTextTokens: Set<string>;
  counts: Record<string, number>;
  rendered: Record<string, number>;
}

const fbByFile = new Map<string, typeof fb.blocks>();
for (const b of fb.blocks) fbByFile.set(b.file, [...(fbByFile.get(b.file) ?? []), b]);

const models = new Map<string, SheetModel>();
for (const s of reconstructed.sheets) {
  const d = s.drawing;
  const blocks = fbByFile.get(s.filename) ?? [];
  const m: SheetModel = {
    file: s.filename,
    blockAddresses: new Map(),
    subAddresses: new Map(),
    sLabels: new Map(),
    symbolLabels: new Map(),
    fcCodes: new Set(),
    functionNames: new Set(),
    titleTokens: new Set(),
    sourceTextTokens: new Set(),
    counts: {},
    rendered: {},
  };
  for (const b of d.functionBlocks) {
    m.functionNames.add(b.symbolName.toUpperCase());
    if (b.blockNumber != null) m.blockAddresses.set(b.blockNumber, { fc: b.functionCode, symbol: b.symbolName });
  }
  for (const b of blocks) {
    if (!m.blockAddresses.has(b.block_address)) m.blockAddresses.set(b.block_address, { fc: b.function_code, symbol: b.symbol_name });
    if (b.function_code == null) continue;
    m.fcCodes.add(`(${b.function_code})`);
    const schema = getFunctionCode(b.function_code);
    if (!schema) continue;
    if (schema.symbol.title) m.functionNames.add(schema.symbol.title.toUpperCase());
    for (const k of outputOffsets(b.function_code)) {
      if (k > 0) m.subAddresses.set(b.block_address + k, { parent: b.block_address, k, fc: b.function_code });
    }
    const mappedLabels = new Set(b.pins.filter((p) => p.label).map((p) => p.label!));
    for (const lab of [...schema.symbol.inputs, ...schema.symbol.outputs]) {
      if (!/^S\d+$/.test(lab)) continue;
      m.sLabels.set(lab, [...(m.sLabels.get(lab) ?? []), { block: b.block_address, fc: b.function_code, mapped: mappedLabels.has(lab) }]);
    }
    for (const it of schema.symbol.items) {
      for (const tok of despace(it.s).split(/\s+/)) {
        if (!tok || /^S\d+$/.test(tok) || /^\(\d+\)$/.test(tok)) continue;
        m.symbolLabels.set(tok.toUpperCase(), [...(m.symbolLabels.get(tok.toUpperCase()) ?? []), { block: b.block_address, fc: b.function_code }]);
      }
    }
  }
  for (const t of d.texts) {
    for (const tok of t.text.trim().split(/\s+/)) {
      if (!tok) continue;
      m.sourceTextTokens.add(tok);
      if (t.role === "title-block") m.titleTokens.add(tok);
    }
  }
  // Frame library text (title-block captions) is drawn from the library.
  for (const it of s.items) {
    if (it.t === "text" && /frame/.test(it.cls)) for (const tok of it.text.trim().split(/\s+/)) if (tok) m.titleTokens.add(tok);
  }
  const fbSpecs = fb.specifications.filter((sp) => sp.source.file === s.filename);
  m.counts = {
    cad_function_block_symbols: d.functionBlocks.length,
    trailer_function_blocks: blocks.length,
    library_glyph_blocks: d.functionBlocks.filter((b) => b.glyph.status === "LIBRARY").length,
    fallback_glyph_blocks: d.functionBlocks.filter((b) => b.glyph.status === "FALLBACK").length,
    output_addresses_N_plus_k: m.subAddresses.size,
    specifications_decoded: fbSpecs.length,
    specifications_extracted: fbSpecs.filter((sp) => sp.status === "EXTRACTED").length,
    manual_symbol_s_labels: [...m.sLabels.values()].reduce((a, v) => a + v.length, 0),
    s_labels_pin_mapped: [...m.sLabels.values()].reduce((a, v) => a + v.filter((x) => x.mapped).length, 0),
    pins: d.pins.length,
    pins_connected: d.pins.filter((p) => p.connected).length,
    wires_signal: d.connections.filter((c) => c.connectionType === "signal").length,
    wires_rule: d.connections.filter((c) => c.connectionType === "rule").length,
    wire_endpoints_dangling: d.connections.flatMap((c) => [c.from, c.to]).filter((e) => e.kind === "dangling").length,
    junctions: d.junctions.length,
    iref: d.connectors.filter((c) => c.kind === "IREF").length,
    oref: d.connectors.filter((c) => c.kind === "OREF").length,
    cross_sheet_references: d.crossSheetReferences.length,
    texts: d.texts.length,
    arcs: d.arcs.length,
    unknown_records: d.unknownRecords.length,
    title_block_fields: d.titleBlock.fields.length,
    logic_connections_fbspec: fb.connections.filter((c) => c.file === s.filename).length,
  };
  const r: Record<string, number> = {};
  for (const it of s.items) {
    const key = `${it.t}:${it.cls.split(" ")[0]}`;
    r[key] = (r[key] ?? 0) + 1;
  }
  m.rendered = r;
  models.set(s.filename.toUpperCase(), m);
}

// ------------------------------------------------------------ PDFs
console.log("reading expected PDF…");
const expPages = await readPdfText(expectedPdf);
console.log("reading current PDF…");
// Only drawing pages (landscape) are compared; portrait detail / annex pages are reported separately.
const curAll = await readPdfText(currentPdf);
const curPages = curAll.filter((p) => p.width > p.height);
const curReportPages = curAll.length - curPages.length;

const keyOf = (p: PageCensus, which: "expected" | "current"): { file: string | null; stamp: string | null } => {
  const exact = p.runs.find((r) => /^[0-9A-Z]{5,8}\.CAD$/i.test(r.text.trim()));
  if (exact && which === "current") return { file: exact.text.trim().toUpperCase(), stamp: null };
  for (const r of p.runs) {
    const m = /([0-9A-Z]{5,8}\.CAD)/i.exec(r.text);
    if (m) return { file: m[1].toUpperCase(), stamp: which === "expected" ? r.text.trim() : null };
  }
  return { file: null, stamp: null };
};

type Cat =
  | "grid_mark"
  | "title_block"
  | "header_stamp"
  | "fc_code"
  | "s_label"
  | "channel_io"
  | "physical_ref"
  | "iref_oref"
  | "function_name"
  | "symbol_label"
  | "block_number"
  | "sub_block_number"
  | "number_other"
  | "signal_tag"
  | "text_other";

interface Tok {
  text: string;
  cat: Cat;
  x: number;
  y: number;
  size: number;
}

function tokens(p: PageCensus, m: SheetModel | undefined): Tok[] {
  const out: Tok[] = [];
  const twoDigit = p.runs.filter((r) => /^(\d{2}\s*)+$/.test(r.text.trim()));
  const xs = twoDigit.map((r) => r.x), ys = twoDigit.map((r) => r.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  for (const r of p.runs) {
    const raw = r.text.trim();
    if (!raw) continue;
    if (/[0-9A-Z]{5,8}\.CAD\b/i.test(raw)) {
      out.push({ text: raw, cat: "header_stamp", x: r.x, y: r.y, size: r.h });
      continue;
    }
    const isGridRun = /^(\d{2}\s*)+$/.test(raw) && (Math.abs(r.x - minX) < 6 || Math.abs(r.x - maxX) < 6 || Math.abs(r.y - minY) < 6 || Math.abs(r.y - maxY) < 6);
    for (const t of raw.split(/\s+/)) {
      if (!t) continue;
      out.push({ text: t, cat: isGridRun ? "grid_mark" : classify(t, m), x: r.x, y: r.y, size: r.h });
    }
  }
  return out;
}

function classify(t: string, m: SheetModel | undefined): Cat {
  const u = t.toUpperCase();
  if (/^\(\d{1,3}\)$/.test(t)) return "fc_code";
  if (/^S\d{1,3}$/.test(t)) return "s_label";
  if (/^#?(IREF|OREF)/i.test(t)) return "iref_oref";
  if (/^(AIR|AOR|DIR|DOR|AI|AO|DI|DO)\d+/i.test(t)) return "channel_io";
  if (/^AD[0-9A-Z]{2}-\d{2}\.\d{2}$/i.test(t)) return "physical_ref";
  if (/^\d{1,5}$/.test(t)) {
    const n = Number(t);
    if (m?.blockAddresses.has(n)) return "block_number";
    if (m?.subAddresses.has(n)) return "sub_block_number";
    return "number_other";
  }
  if (m?.titleTokens.has(t)) return "title_block";
  if (m?.functionNames.has(u)) return "function_name";
  if (m?.symbolLabels.has(u)) return "symbol_label";
  if (/[A-Z]/i.test(t) && /\d/.test(t) && /[-/.]/.test(t)) return "signal_tag";
  return "text_other";
}

// ------------------------------------------------------------ compare
const pageIndex = (pages: PageCensus[], which: "expected" | "current") => {
  const map = new Map<string, { page: PageCensus; stamp: string | null }>();
  const unkeyed: number[] = [];
  for (const p of pages) {
    const k = keyOf(p, which);
    if (k.file) map.set(k.file, { page: p, stamp: k.stamp });
    else unkeyed.push(p.page);
  }
  return { map, unkeyed };
};
const E = pageIndex(expPages, "expected");
const C = pageIndex(curPages, "current");

const CATS: Cat[] = ["header_stamp", "title_block", "grid_mark", "function_name", "fc_code", "block_number", "sub_block_number", "s_label", "symbol_label", "channel_io", "physical_ref", "iref_oref", "signal_tag", "number_other", "text_other"];
type Agg = { expected: number; current: number; matched: number; missing: number; extra: number };
const totals: Record<string, Agg> = Object.fromEntries(CATS.map((c) => [c, { expected: 0, current: 0, matched: 0, missing: 0, extra: 0 }]));
const missingItems: Array<Record<string, unknown>> = [];
const extraItems: Array<Record<string, unknown>> = [];
const pageReports: Array<Record<string, unknown>> = [];
const causeTotals: Record<string, number> = {};

function attribute(t: Tok, m: SheetModel | undefined, file: string): { cause: string; source_status: string; evidence: string } {
  if (!m) return { cause: "SHEET_NOT_IN_SOURCE", source_status: "NOT_PRESENT", evidence: `no CAD file ${file}` };
  switch (t.cat) {
    case "s_label": {
      const owners = m.sLabels.get(t.text) ?? [];
      if (!owners.length) return { cause: "S_LABEL_NOT_IN_MANUAL_SYMBOL_FOR_SHEET_BLOCKS", source_status: "UNRESOLVED", evidence: "no block on this sheet has a manual symbol printing this label" };
      const mapped = owners.filter((o) => o.mapped);
      return {
        cause: mapped.length ? "S_LABEL_PIN_MAPPED_NOT_RENDERED" : "S_LABEL_KNOWN_FROM_MANUAL_PIN_UNMAPPED_NOT_RENDERED",
        source_status: mapped.length ? "PARSED_LINKED" : "PARSED",
        evidence: owners.map((o) => `${o.block}:FC${o.fc}${o.mapped ? ":pin-mapped" : ""}`).join(", "),
      };
    }
    case "sub_block_number": {
      const s = m.subAddresses.get(Number(t.text))!;
      return { cause: "OUTPUT_ADDRESS_N_PLUS_K_NOT_MODELLED", source_status: "DERIVABLE", evidence: `block ${s.parent} FC${s.fc} output N+${s.k}` };
    }
    case "symbol_label": {
      const owners = m.symbolLabels.get(t.text.toUpperCase()) ?? [];
      return { cause: "MANUAL_SYMBOL_LABEL_NOT_RENDERED", source_status: "DERIVABLE", evidence: owners.slice(0, 6).map((o) => `${o.block}:FC${o.fc}`).join(", ") };
    }
    case "block_number": {
      const b = m.blockAddresses.get(Number(t.text))!;
      return { cause: "BLOCK_NUMBER_IN_MODEL_NOT_RENDERED", source_status: "PARSED", evidence: `FC${b.fc} ${b.symbol ?? ""}` };
    }
    case "fc_code":
      return m.fcCodes.has(t.text)
        ? { cause: "FC_CODE_IN_MODEL_NOT_RENDERED", source_status: "PARSED", evidence: "trailer FC present on sheet" }
        : { cause: "FC_CODE_NOT_IN_MODEL", source_status: "UNRESOLVED", evidence: "" };
    case "function_name":
      return { cause: "FUNCTION_NAME_NOT_RENDERED", source_status: "PARSED", evidence: "" };
    case "header_stamp": {
      const z = zipTimes.get(file);
      return { cause: "PLOT_STAMP_NOT_RENDERED", source_status: z ? "ARCHIVE_METADATA" : "NOT_PRESENT", evidence: z ? `zip entry ${z.entry} mtime ${z.mtime.toISOString()}` : "CAD bytes carry no path/time stamp" };
    }
    default:
      if (m.sourceTextTokens.has(t.text)) return { cause: "SOURCE_TEXT_NOT_RENDERED", source_status: "PARSED", evidence: "token present in CAD text records" };
      return { cause: "UNATTRIBUTED", source_status: "UNRESOLVED", evidence: "" };
  }
}

const files = [...new Set([...E.map.keys(), ...C.map.keys()])].sort();
for (const file of files) {
  const e = E.map.get(file);
  const c = C.map.get(file);
  const m = models.get(file);
  const et = e ? tokens(e.page, m) : [];
  const ct = c ? tokens(c.page, m) : [];
  const perCat: Record<string, Agg> = {};
  const pageMissing: Array<Record<string, unknown>> = [];
  for (const cat of CATS) {
    const ex = et.filter((t) => t.cat === cat);
    const cu = ct.filter((t) => t.cat === cat);
    // header stamp: compare on file name + time only
    const keyFn = cat === "header_stamp" ? (t: Tok) => (/(\d{2}:\d{2}:\d{2}\s*[AP]M\s*\d{2}\/\d{2}\/\d{4})/i.exec(t.text)?.[1] ?? t.text.match(/[0-9A-Z]{5,8}\.CAD/i)?.[0] ?? t.text) : (t: Tok) => t.text;
    const pool = new Map<string, Tok[]>();
    for (const t of cu) pool.set(keyFn(t), [...(pool.get(keyFn(t)) ?? []), t]);
    let matched = 0;
    const miss: Tok[] = [];
    for (const t of ex) {
      const arr = pool.get(keyFn(t));
      if (arr && arr.length) {
        arr.pop();
        matched++;
      } else miss.push(t);
    }
    const extra = [...pool.values()].flat();
    perCat[cat] = { expected: ex.length, current: cu.length, matched, missing: miss.length, extra: extra.length };
    const T = totals[cat];
    T.expected += ex.length;
    T.current += cu.length;
    T.matched += matched;
    T.missing += miss.length;
    T.extra += extra.length;
    for (const t of miss) {
      const a = attribute(t, m, file);
      causeTotals[a.cause] = (causeTotals[a.cause] ?? 0) + 1;
      const rec = { file, expected_page: e?.page.page ?? null, current_page: c?.page.page ?? null, category: cat, text: t.text, expected_xy: [t.x, t.y], ...a };
      missingItems.push(rec);
      pageMissing.push(rec);
    }
    for (const t of extra) {
      if (cat === "header_stamp" || cat === "grid_mark") continue;
      extraItems.push({ file, current_page: c?.page.page ?? null, category: cat, text: t.text, current_xy: [t.x, t.y] });
    }
  }
  pageReports.push({
    file,
    expected_page: e?.page.page ?? null,
    current_page: c?.page.page ?? null,
    expected_stamp: e?.stamp ?? null,
    archive_mtime: zipTimes.get(file)?.mtime.toISOString() ?? null,
    text_categories: perCat,
    vector_ops: { expected: e?.page.ops ?? null, current: c?.page.ops ?? null },
    source_model: m?.counts ?? null,
    rendered_display_list: m?.rendered ?? null,
    missing_count: pageMissing.length,
  });
}

// ------------------------------------------------------------ structural totals
const sum = (key: string) => [...models.values()].reduce((a, m) => a + (m.counts[key] ?? 0), 0);
const srcKeys = Object.keys([...models.values()][0]?.counts ?? {});
const sourceTotals = Object.fromEntries(srcKeys.map((k) => [k, sum(k)]));
const vec = (pages: PageCensus[]) => pages.reduce((a, p) => ({ lines: a.lines + p.ops.lines, curves: a.curves + p.ops.curves, rects: a.rects + p.ops.rects, strokes: a.strokes + p.ops.strokes, texts: a.texts + p.ops.texts }), { lines: 0, curves: 0, rects: 0, strokes: 0, texts: 0 });

const renderedTotals: Record<string, number> = {};
for (const m of models.values()) for (const [k, v] of Object.entries(m.rendered)) renderedTotals[k] = (renderedTotals[k] ?? 0) + v;

const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  inputs: {
    expected_pdf: expectedPdf,
    current_pdf: currentPdf,
    cad_source_dir: extractDir,
    archive: zipPath ?? null,
    expected_pages: expPages.length,
    current_pages: curPages.length,
    current_report_pages_excluded: curReportPages,
    cad_files: cads.length,
    pages_matched: files.filter((f) => E.map.has(f) && C.map.has(f)).length,
    expected_pages_unkeyed: E.unkeyed,
    current_pages_unkeyed: C.unkeyed,
    files_only_in_expected: files.filter((f) => E.map.has(f) && !C.map.has(f)),
    files_only_in_current: files.filter((f) => !E.map.has(f) && C.map.has(f)),
  },
  method: {
    text: "pdf.js text items merged into baseline runs, split into whitespace tokens, classified by regex and by the CAD/manual source model of the same sheet; per-page multiset comparison per category",
    attribution: "each missing token is checked against the source model (CAD records + fb-spec trailer decode + manual KB) to decide whether it is source-recoverable and which layer drops it",
    oracle_rule: "expected PDF used for validation only; no value read from it enters the generated model",
  },
  totals_by_category: totals,
  missing_by_cause: Object.fromEntries(Object.entries(causeTotals).sort((a, b) => b[1] - a[1])),
  source_model_totals: sourceTotals,
  fbspec_totals: {
    blocks: fb.blocks.length,
    specifications: fb.specifications.length,
    specifications_by_status: fb.specifications.reduce<Record<string, number>>((a, s) => ((a[s.status] = (a[s.status] ?? 0) + 1), a), {}),
    logic_connections: fb.connections.length,
    logic_connections_by_kind: fb.connections.reduce<Record<string, number>>((a, c) => ((a[c.kind] = (a[c.kind] ?? 0) + 1), a), {}),
    diagnostics: fb.diagnostics.length,
  },
  rendered_display_list_totals: renderedTotals,
  vector_ops_totals: { expected: vec(expPages), current: vec(curPages) },
  root_causes: [
    {
      id: "RC1_VENDOR_SYMBOL_LIBRARY_ABSENT",
      finding: `${sourceTotals.fallback_glyph_blocks} of ${sourceTotals.cad_function_block_symbols} placed function-block symbols have no definition in any supplied .LBR (7107LIB1/SAMA/... define only frame, connector and a few SAMA shapes). The renderer draws a FALLBACK box and prints only symbol name, (FC) and block number.`,
      effect: "Every label the vendor symbol carries (S1..SN pin labels, output names, internal captions, N+k output addresses) is absent from the page.",
    },
    {
      id: "RC2_SUB_BLOCK_ADDRESSES_NOT_MODELLED",
      finding: "Output addresses N+k of multi-output function codes (manual outputs table) are not objects in the scene model; only the block address N is.",
      effect: "Sub-block numbers such as 4044/4045 (RI/OI 4043) and 5164 (H/L 5163) disappear.",
    },
    {
      id: "RC3_PIN_LABEL_MAPPING_STRICT_COUNT_MATCH",
      finding: "fb-spec assigns S labels to drawn pins only when the drawn pin count equals the manual label count; pins are learned from wire endpoints, so symbols with unwired pins stay UNRESOLVED.",
      effect: `${sourceTotals.manual_symbol_s_labels} manual S labels belong to blocks on these sheets; ${sourceTotals.s_labels_pin_mapped} are pin-mapped.`,
    },
    {
      id: "RC4_MANUAL_SYMBOL_PARSE_TRUNCATION",
      finding: "Manual symbol pin lists are truncated for long symbols (e.g. FC147 symbol inputs stop at S27 although specifications run to S36).",
      effect: "S28..S36 cannot be attached to FC147 pins from the KB symbol.",
    },
    {
      id: "RC5_SPEC_DATA_NOT_IN_CAD_PDF",
      finding: "Decoded S1..SN values, logic connections and IREF/OREF resolution live in fb-spec / reconstruct JSON but the CAD sheet PDF has no detail pages or annex.",
      effect: "An engineer cannot read block configuration from the CAD PDF.",
    },
    {
      id: "RC6_PLOT_STAMP_LOST",
      finding: "The vendor plot header (<path>\\<file>.CAD <time> <date>) is not rendered; the CAD bytes carry no stamp, and ZIP extraction discards entry mtimes.",
      effect: "Header line missing on every page.",
    },
  ],
  pages: pageReports,
  missing_items: missingItems,
  extra_items: extraItems,
};

fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${stem}.json`);
fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
console.log(`\nwrote ${outFile} (${missingItems.length} missing, ${extraItems.length} extra items)`);
console.log("pages matched", report.inputs.pages_matched, "/", expPages.length);
console.table(totals);
console.log("missing by cause", report.missing_by_cause);
console.log("source totals", sourceTotals);
