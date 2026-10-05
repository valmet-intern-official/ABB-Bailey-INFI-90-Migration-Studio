/**
 * Engineering documentation PDFs.
 *
 * Page order: a cover, then for every sheet its reconstructed drawing
 * followed by that sheet's function-block schedules (spec table,
 * connections, source traceability). The drawing geometry is the reconstruct
 * display list, unchanged, on layer SOURCE CAD. Schedules are on layer
 * SPECIFICATION ANNOTATION. The MARKED variant adds, on layer MARKING TAG, a
 * frame around every block and a callout (block, FC, first S values) placed
 * only where it collides with nothing; frames and schedule headings link to
 * each other.
 *
 * Every page is laid out in fixed-pitch lines within the page margins, so
 * overlaps and clipping are checked by construction and again by
 * `layoutChecks`.
 */
import { PAGE_H, PAGE_W, writePdf, type PdfLink, type PdfPage, type RenderItem } from "@infi90/cad-engine";
import { boxesIntersect, insideBox, lineSegments, pdfSafe, segmentHitsBox, textBox, wrap, type Box } from "./layout";
import type { ExtractionResult, FunctionBlockRecord, LogicConnection, SpecificationRecord } from "./types";

export type EngineeringMode = "plain" | "marked";

const LAYERS = [
  { id: "src", name: "SOURCE CAD" },
  { id: "spec", name: "SPECIFICATION ANNOTATION" },
  { id: "mark", name: "MARKING TAG" },
];

const M = 24;
const FS = 6;
const CW = 0.6 * FS;
const LH = 7.6;
const MAXC = Math.floor((PAGE_W - 2 * M) / CW);
const TOP = PAGE_H - M - 16;
const BOTTOM = M + 12;
const MARK_RGB: [number, number, number] = [0.8, 0, 0];
const SPEC_RGB: [number, number, number] = [0, 0.2, 0.6];
const CALLOUT_FS = 4.2;
const PAGE_BOX: Box = [6, 6, PAGE_W - 6, PAGE_H - 6];
const MAX_OUT_LINES = 40;

const COLS = [
  { key: "SPEC", w: 5 },
  { key: "ACTUAL CAD VALUE", w: 16 },
  { key: "TYPE", w: 4 },
  { key: "DEFAULT", w: 13 },
  { key: "TUNE", w: 5 },
  { key: "RANGE", w: 22 },
] as const;
const GAP = 2;
const DESC_W = MAXC - COLS.reduce((a, c) => a + c.w + GAP, 0);

export interface LayoutReport {
  mode: EngineeringMode;
  pages: number;
  schedule_pages: number;
  drawing_pages: number;
  overlaps: Array<{ page: number; a: string; b: string }>;
  clipped: Array<{ page: number; text: string }>;
  callouts_placed: number;
  callouts_frame_only: Array<{ block: string; page: number }>;
  /** Callout text crossed by drawn source line work. */
  callouts_over_lines: Array<{ page: number; text: string }>;
  blocks_scheduled: number;
}

interface Line {
  text: string;
  rgb?: [number, number, number];
  /** Horizontal rule drawn under the line. */
  rule?: boolean;
  anchor?: string;
  link?: { page: number; y: number };
}

interface SchedulePage {
  lines: Line[];
}

const pad = (s: string, w: number) => (s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length));

function tableRow(cells: string[]): string[] {
  const cols = [...COLS.map((c) => c.w), DESC_W];
  const wrapped = cells.map((c, i) => wrap(pdfSafe(c), cols[i]));
  const n = Math.max(...wrapped.map((w) => w.length));
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(wrapped.map((w, j) => pad(w[i] ?? "", cols[j])).join(" ".repeat(GAP)).trimEnd());
  return out;
}

const TABLE_HEAD = tableRow([...COLS.map((c) => c.key), "DESCRIPTION (manual)"]);

function resolutionText(s: SpecificationRecord): string[] {
  const out: string[] = [];
  if (s.enumeration_meaning) out.push(`= ${s.enumeration_meaning} (manual enumeration)`);
  const r = s.address_resolution;
  if (r) {
    const at = r.target_file ? ` (${r.target_file} p.${r.target_page})` : "";
    const fc = r.target_function_code != null ? ` FC ${r.target_function_code}${r.target_name ? ` ${r.target_name}` : ""}` : "";
    const fx = r.fixed_block ? ` = fixed block '${r.fixed_block.description}' (${r.fixed_block.table}, manual p.${r.fixed_block.manual_page})` : "";
    if (r.status === "RESOLVED_BLOCK") out.push(`-> block ${r.target_block}${r.target_output ? ` ${r.target_output}` : ""}${fc}${at}${fx} [${r.evidence}]`);
    else if (r.status === "WIRED_INPUT") out.push(`WIRED: source block address ${r.address}${r.target_block != null && r.target_block !== r.address ? ` (block ${r.target_block} ${r.target_output ?? ""})` : ""}${fc}${at} [${r.evidence}]`);
    else if (r.status === "RESOLVED_FIXED_BLOCK") out.push(`-> fixed block ${r.address}${fx} [${r.evidence}]`);
    else if (r.status === "UNRESOLVED") out.push(`-> UNRESOLVED`);
    else out.push(`-> not a local block reference`);
    if (r.note) out.push(`   ${r.note}`);
  }
  if (s.pin) out.push(`pin ${s.pin.pin} [${s.pin.evidence}]`);
  for (const d of s.diagnostics) out.push(`! ${d}`);
  return out;
}

function specRows(s: SpecificationRecord): string[] {
  const value = s.raw_value_text ?? "-";
  const valueCell = s.status === "EXTRACTED" ? value : `${value} [${s.status}]`;
  const desc = [s.manual_description || "(no description printed)", ...resolutionText(s)].join("\n");
  return tableRow([s.label, valueCell, s.type || "(none)", s.default, s.tune_raw, s.range, desc]);
}

function connectionLines(b: FunctionBlockRecord, conns: LogicConnection[]): string[] {
  const here = (c: LogicConnection, side: "target" | "source") =>
    side === "target"
      ? c.target_block === b.block_address && (c.target_file ?? c.file) === b.file
      : c.source_block === b.block_address && ((c.kind === "SPEC_BLOCK_ADDRESS" ? c.target_file : c.file) === b.file);
  const ins = conns.filter((c) => here(c, "target"));
  const outs = conns.filter((c) => here(c, "source"));
  const where = (file: string | null, page: number | null) => (file && file !== b.file ? ` [${file} p.${page}]` : "");
  const lines: string[] = [];
  for (const c of ins) {
    lines.push(
      `IN   ${pad(c.target_terminal ?? "?", 10)} <- ${c.source_block ?? "?"}${c.source_terminal ? ` ${c.source_terminal}` : ""}${c.source_address != null && c.source_address !== c.source_block ? ` (addr ${c.source_address})` : ""}${c.signal ? ` signal '${c.signal}'` : ""}${c.kind === "SPEC_BLOCK_ADDRESS" ? where(c.target_file, c.target_page) : where(c.file, c.page)}  ${c.kind} ${c.status}${c.spec_check ? ` spec ${c.spec_check.spec}=${c.spec_check.value}${c.spec_check.agrees ? " agrees" : " differs"}` : ""}`
    );
  }
  const outLines = outs.map(
    (c) =>
      `OUT  ${pad(c.source_terminal ?? "-", 10)} -> ${c.target_block ?? "?"}${c.target_terminal ? ` ${c.target_terminal}` : ""}${c.signal ? ` signal '${c.signal}'` : ""}${c.kind === "SPEC_BLOCK_ADDRESS" ? where(c.file, c.page) : where(c.target_file, c.target_page)}  ${c.kind} ${c.status}`
  );
  lines.push(...outLines.slice(0, MAX_OUT_LINES));
  if (outLines.length > MAX_OUT_LINES) lines.push(`OUT  ... ${outLines.length - MAX_OUT_LINES} more (logic_connections.json)`);
  if (!lines.length) lines.push("(none)");
  return lines;
}

function blockSections(b: FunctionBlockRecord, specs: SpecificationRecord[], conns: LogicConnection[]): { head: Line[]; table: string[][]; tail: Line[] } {
  const title = `BLOCK ${b.block_address}   FC ${b.function_code ?? "-"}   ${b.name ?? "(no manual schema)"}   symbol ${b.symbol_name ?? "-"}   status ${b.status}`;
  const ctx = `segment ${b.segment.segment_block ?? "-"} [${b.segment.evidence}]   module ${b.module.module}${b.module.module_type ? ` (${b.module.module_type})` : ""}   drawing ${b.drawing.drawing_number ?? "-"}   manual ${b.manual_section ?? "-"}${b.manual_page ? ` p.${b.manual_page}` : ""}`;
  const head: Line[] = [
    { text: pdfSafe(title), anchor: b.id, rule: false },
    ...wrap(pdfSafe(ctx), MAXC).map((t) => ({ text: t })),
  ];
  const table = specs.length ? specs.map(specRows) : [];
  const tail: Line[] = [];
  if (!specs.length) tail.push({ text: pdfSafe(b.function_code == null ? "no spec entry in the CAD trailer (NOT_PRESENT)" : "no manual schema: spec values not decoded (payload below)") });
  tail.push({ text: "CONNECTIONS", rgb: SPEC_RGB });
  for (const l of connectionLines(b, conns)) for (const w of wrap(pdfSafe(l), MAXC)) tail.push({ text: w });
  tail.push({ text: "SOURCE TRACEABILITY", rgb: SPEC_RGB });
  const trace = [
    `file ${b.file}  sheet ${b.page}  bbox ${b.source.bbox ? b.source.bbox.join(",") : "-"}  entities ${b.source.entity_ids.join(" ")}`,
    `payload ${b.actual_bytes} bytes, manual layout ${b.expected_bytes ?? "-"} bytes, ${b.layout_status}; association ${specs[0]?.association.method ?? (b.drawn ? "symbol only" : "trailer only")}`,
    `payload hex ${b.payload_hex || "-"}`,
    ...b.pins.map((p) => `pin ${p.pin} ${p.side} ${p.label ?? "-"} [${p.evidence}] ${p.connected ? "wired" : "open"}`),
    ...(b.pins.length ? [`pin basis: ${[...new Set(b.pins.map((p) => p.basis))].join(" | ")}`] : []),
    ...b.diagnostics.map((d) => `! ${d}`),
  ];
  for (const l of trace) for (const w of wrap(pdfSafe(l), MAXC)) tail.push({ text: w });
  return { head, table, tail };
}

/** Paginate one sheet's blocks into schedule pages. */
function scheduleSheet(file: string, page: number, blocks: FunctionBlockRecord[], specOf: (b: FunctionBlockRecord) => SpecificationRecord[], conns: LogicConnection[]): SchedulePage[] {
  const capacity = Math.floor((TOP - BOTTOM) / LH);
  const pages: SchedulePage[] = [];
  let cur: Line[] = [];
  const header = (cont: boolean): Line[] => [{ text: pdfSafe(`SPECIFICATION SCHEDULE  ${file}  sheet ${page}${cont ? "  (continued)" : ""}`), rgb: SPEC_RGB, rule: true }];
  const newPage = (cont: boolean) => {
    if (cur.length) pages.push({ lines: cur });
    cur = header(cont);
  };
  const room = () => capacity - cur.length;
  newPage(false);
  for (const b of blocks) {
    const { head, table, tail } = blockSections(b, specOf(b), conns);
    const tableHead: Line[] = table.length ? TABLE_HEAD.map((t, i) => ({ text: t, rule: i === TABLE_HEAD.length - 1 })) : [];
    const firstRow = table[0]?.length ?? 0;
    if (room() < head.length + tableHead.length + firstRow + 1) newPage(true);
    cur.push({ text: "", rule: true });
    cur.push(...head, ...tableHead);
    for (const row of table) {
      if (room() < row.length) {
        newPage(true);
        cur.push({ text: pdfSafe(`BLOCK ${b.block_address} FC ${b.function_code} (continued)`) }, ...tableHead);
      }
      cur.push(...row.map((t) => ({ text: t })));
    }
    for (const l of tail) {
      if (room() < 1) {
        newPage(true);
        cur.push({ text: pdfSafe(`BLOCK ${b.block_address} FC ${b.function_code} (continued)`) });
      }
      cur.push(l);
    }
  }
  pages.push({ lines: cur });
  return pages;
}

function linesToItems(lines: Line[]): { items: RenderItem[]; anchors: Map<string, number> } {
  const items: RenderItem[] = [];
  const anchors = new Map<string, number>();
  lines.forEach((l, i) => {
    const y = TOP - i * LH;
    if (l.anchor) anchors.set(l.anchor, y);
    if (l.text) items.push({ t: "text", x: M, y, size: FS, angle: 0, text: l.text, cls: "schedule", src: "schedule", layer: "spec", rgb: l.rgb });
    if (l.rule) items.push({ t: "path", pts: [[M, y - 0.35 * LH], [PAGE_W - M, y - 0.35 * LH]], w: 0.2, cls: "schedule-rule", src: "schedule", layer: "spec", rgb: l.rgb });
  });
  return { items, anchors };
}

/** Place block frames and callouts on a drawing page without colliding with anything drawn. */
function markDrawing(items: RenderItem[], blocks: FunctionBlockRecord[], specOf: (b: FunctionBlockRecord) => SpecificationRecord[]) {
  const obstacles: Box[] = [];
  for (const it of items) if (it.t === "text") obstacles.push(textBox(it));
  const frames: Box[] = blocks.filter((b) => b.source.bbox).map((b) => {
    const [x1, y1, x2, y2] = b.source.bbox!;
    return [Math.min(x1, x2) - 1, Math.min(y1, y2) - 1, Math.max(x1, x2) + 1, Math.max(y1, y2) + 1];
  });
  obstacles.push(...frames);
  const segments = lineSegments(items);
  const marks: RenderItem[] = [];
  const placed: Array<{ block: FunctionBlockRecord; box: Box }> = [];
  const frameOnly: FunctionBlockRecord[] = [];
  blocks.filter((b) => b.source.bbox).forEach((b, i) => {
    const f = frames[i];
    marks.push({ t: "path", pts: [[f[0], f[1]], [f[2], f[1]], [f[2], f[3]], [f[0], f[3]]], closed: true, w: 0.3, cls: "mark-frame", src: b.id, layer: "mark", rgb: MARK_RGB, blockId: b.id });
    const specs = specOf(b).filter((s) => s.raw_value_text != null).slice(0, 3);
    const label = pdfSafe(`B${b.block_address} FC${b.function_code ?? "-"}`);
    const values = pdfSafe(specs.map((s) => `${s.label}=${s.raw_value_text}`).join(" "));
    const variants = values ? [[label, values], [label]] : [[label]];
    for (const text of variants) {
      const w = Math.max(...text.map((t) => t.length)) * 0.6 * CALLOUT_FS;
      const h = text.length * CALLOUT_FS * 1.1;
      const candidates: Array<[number, number]> = [];
      for (const d of [0.6, 0.6 + h, 0.6 + 2 * h]) {
        candidates.push(
          [f[0], f[3] + d],
          [f[0], f[1] - d - h],
          [f[2] + d, f[3] - h],
          [f[0] - d - w, f[3] - h],
          [f[2] - w, f[3] + d],
          [f[2] - w, f[1] - d - h],
          [f[2] + d, f[1]],
          [f[0] - d - w, f[1]],
        );
      }
      const hit = candidates.find(([x, y]) => {
        const box: Box = [x, y, x + w, y + h];
        const padded: Box = [x - 0.2, y - 0.2, x + w + 0.2, y + h + 0.2];
        return insideBox(box, PAGE_BOX) && !obstacles.some((o) => boxesIntersect(box, o, 0.2)) && !segments.some((s) => segmentHitsBox(s, padded));
      });
      if (!hit) continue;
      const [x, y] = hit;
      text.forEach((t, k) => marks.push({ t: "text", x, y: y + h - (k + 1) * CALLOUT_FS * 1.1 + 0.25 * CALLOUT_FS, size: CALLOUT_FS, angle: 0, text: t, cls: "mark-callout", src: b.id, layer: "mark", rgb: MARK_RGB, blockId: b.id }));
      const box: Box = [x, y, x + w, y + h];
      obstacles.push(box);
      placed.push({ block: b, box });
      return;
    }
    frameOnly.push(b);
  });
  return { marks, placed, frameOnly, frames: blocks.filter((b) => b.source.bbox).map((b, i) => ({ block: b, box: frames[i] })) };
}

export interface SheetDrawing {
  file: string;
  items: RenderItem[];
}

export function buildEngineeringPdf(result: ExtractionResult, drawings: SheetDrawing[], mode: EngineeringMode, title: string): { pdf: Buffer; report: LayoutReport; pages: PdfPage[] } {
  const specById = new Map(result.specifications.map((s) => [s.id, s]));
  const specOf = (b: FunctionBlockRecord) => b.spec_ids.map((id) => specById.get(id)!).filter(Boolean);
  const blocksOf = new Map<string, FunctionBlockRecord[]>();
  for (const b of result.blocks) blocksOf.set(b.file, [...(blocksOf.get(b.file) ?? []), b]);
  for (const list of blocksOf.values()) list.sort((a, b) => a.block_address - b.block_address || a.id.localeCompare(b.id));
  const drawingOf = new Map(drawings.map((d) => [d.file, d]));

  // Pass 1: lay out every section to know page indices.
  interface Section { file: string; page: number; drawing: RenderItem[]; marks: ReturnType<typeof markDrawing> | null; schedule: SchedulePage[] }
  const sections: Section[] = result.sheets.map((s) => {
    const blocks = blocksOf.get(s.file) ?? [];
    const drawing = drawingOf.get(s.file)?.items ?? [];
    return {
      file: s.file,
      page: s.page,
      drawing,
      marks: mode === "marked" ? markDrawing(drawing, blocks, specOf) : null,
      schedule: scheduleSheet(s.file, s.page, blocks, specOf, result.connections),
    };
  });
  const cover = wrapLines(coverLines(result, mode));
  const coverPages = chunk(cover, Math.floor((TOP - BOTTOM) / LH));
  let idx = coverPages.length;
  const drawingIndex = new Map<string, number>();
  const scheduleIndex: number[][] = [];
  for (const s of sections) {
    drawingIndex.set(s.file, idx++);
    scheduleIndex.push(s.schedule.map(() => idx++));
  }
  const total = idx;

  // Pass 2: emit pages with links.
  const pages: PdfPage[] = [];
  const blockAnchor = new Map<string, { page: number; y: number }>();
  const scheduleItems = sections.map((s, si) =>
    s.schedule.map((sp, k) => {
      const { items, anchors } = linesToItems(sp.lines);
      for (const [id, y] of anchors) if (!blockAnchor.has(id)) blockAnchor.set(id, { page: scheduleIndex[si][k], y: y + FS + 2 });
      return { items, anchors };
    })
  );
  const footer = (i: number, label: string): RenderItem => ({ t: "text", x: PAGE_W - M, y: M, size: FS, angle: 0, text: pdfSafe(`${title}  ${label}  page ${i + 1} / ${total}`), anchor: "end", cls: "footer", src: "footer", layer: "spec" });

  coverPages.forEach((lines, i) => {
    const { items } = linesToItems(lines);
    pages.push({ items: [...items, footer(pages.length, "summary")], label: `cover ${i + 1}` });
  });
  const report: LayoutReport = { mode, pages: total, schedule_pages: 0, drawing_pages: sections.length, overlaps: [], clipped: [], callouts_placed: 0, callouts_frame_only: [], callouts_over_lines: [], blocks_scheduled: result.blocks.length };
  const blockById = new Map(result.blocks.map((b) => [b.id, b]));
  sections.forEach((s, si) => {
    const src = s.drawing.map((it) => ({ ...it, layer: "src" }) as RenderItem);
    const links: PdfLink[] = [];
    const items: RenderItem[] = [...src];
    if (s.marks) {
      items.push(...s.marks.marks);
      for (const fr of s.marks.frames) {
        const a = blockAnchor.get(fr.block.id);
        if (a) links.push({ rect: fr.box, page: a.page, y: a.y });
      }
      for (const p of s.marks.placed) {
        const a = blockAnchor.get(p.block.id);
        if (a) links.push({ rect: p.box, page: a.page, y: a.y });
      }
      report.callouts_placed += s.marks.placed.length;
      report.callouts_frame_only.push(...s.marks.frameOnly.map((b) => ({ block: b.id, page: pages.length + 1 })));
    }
    items.push(footer(pages.length, `${s.file} drawing`));
    pages.push({ items, label: s.file, links });
    scheduleItems[si].forEach(({ items: sItems, anchors }) => {
      const sLinks: PdfLink[] = [];
      for (const [id, y] of anchors) {
        const b = blockById.get(id);
        if (!b) continue;
        const target = drawingIndex.get(b.file)!;
        const yTop = b.source.bbox ? Math.min(PAGE_H, Math.max(b.source.bbox[1], b.source.bbox[3]) + 40) : PAGE_H;
        sLinks.push({ rect: [M, y - 0.2 * FS, M + 60 * CW, y + 0.8 * FS], page: target, y: yTop });
      }
      pages.push({ items: [...sItems, footer(pages.length, `${s.file} schedule`)], label: `${s.file} schedule`, links: sLinks });
      report.schedule_pages++;
    });
  });

  // Checks on everything this module added.
  pages.forEach((p, i) => {
    const added = p.items.filter((it) => it.layer === "spec" || it.layer === "mark");
    const texts = added.filter((it): it is Extract<RenderItem, { t: "text" }> => it.t === "text");
    const boxes = texts.map((t) => ({ t, b: textBox(t) }));
    for (const { t, b } of boxes) if (!insideBox(b, [0, 0, p.width ?? PAGE_W, p.height ?? PAGE_H])) report.clipped.push({ page: i + 1, text: t.text });
    const sorted = boxes.slice().sort((a, b) => a.b[1] - b.b[1]);
    for (let a = 0; a < sorted.length; a++) {
      for (let c = a + 1; c < sorted.length && sorted[c].b[1] < sorted[a].b[3]; c++) {
        if (boxesIntersect(sorted[a].b, sorted[c].b)) report.overlaps.push({ page: i + 1, a: sorted[a].t.text.slice(0, 40), b: sorted[c].t.text.slice(0, 40) });
      }
    }
    if (p.items.some((it) => it.layer === "mark")) {
      const srcBoxes = p.items.filter((it): it is Extract<RenderItem, { t: "text" }> => it.t === "text" && it.layer === "src").map(textBox);
      const srcSegments = lineSegments(p.items.filter((it) => it.layer === "src"));
      for (const t of texts.filter((x) => x.layer === "mark")) {
        const b = textBox(t);
        if (srcBoxes.some((s) => boxesIntersect(b, s))) report.overlaps.push({ page: i + 1, a: t.text, b: "(source text)" });
        if (srcSegments.some((s) => segmentHitsBox(s, b))) report.callouts_over_lines.push({ page: i + 1, text: t.text });
      }
    }
  });

  const outline = [
    { title: "Summary", page: 0 },
    ...sections.map((s) => ({ title: `Sheet ${s.page}  ${s.file}`, page: drawingIndex.get(s.file)! })),
  ];
  const pdf = writePdf(pages, title, { layers: LAYERS.map((l) => ({ ...l, on: true })), outline });
  return { pdf, report, pages };
}

function wrapLines(lines: Line[]): Line[] {
  return lines.flatMap((l) => {
    const parts = wrap(l.text, MAXC);
    return parts.map((text, i) => ({ ...l, text, rule: i === parts.length - 1 ? l.rule : false, anchor: i === 0 ? l.anchor : undefined }));
  });
}

/** Plain multi-page text report on the schedule grid. */
export function buildTextReportPdf(title: string, lines: Array<string | { text: string; heading?: boolean }>): Buffer {
  const all = wrapLines(lines.map((l) => (typeof l === "string" ? { text: pdfSafe(l) } : { text: pdfSafe(l.text), rgb: l.heading ? SPEC_RGB : undefined, rule: l.heading })));
  const pagesLines = chunk(all, Math.floor((TOP - BOTTOM) / LH));
  const pages: PdfPage[] = pagesLines.map((pl, i) => {
    const { items } = linesToItems(pl);
    items.push({ t: "text", x: PAGE_W - M, y: M, size: FS, angle: 0, text: pdfSafe(`${title}  page ${i + 1} / ${pagesLines.length}`), anchor: "end", cls: "footer", src: "footer" });
    return { items, label: `report ${i + 1}` };
  });
  return writePdf(pages, title);
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out.length ? out : [[]];
}

function coverLines(r: ExtractionResult, mode: EngineeringMode): Line[] {
  const count = <T,>(xs: T[], k: (x: T) => string) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(k(x), (m.get(k(x)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([a, n]) => `${a} ${n}`).join(", ");
  };
  const t = (text: string, rgb?: [number, number, number]): Line => ({ text: pdfSafe(text), rgb });
  const lines: Line[] = [
    t(`${r.module.module} FUNCTION-BLOCK SPECIFICATION ENGINEERING DOCUMENT${mode === "marked" ? " (MARKED)" : ""}`, SPEC_RGB),
    { text: "", rule: true },
    t(`Module ${r.module.module}   module type ${r.module.module_type ?? "-"}   executive block ${r.module.executive_block ?? "-"}   sheets ${r.sheets.length}`),
    t(`Manual knowledge base: ${r.manual.document} sha256 ${r.manual.sha256}`),
    t(""),
    t("SOURCE AUTHORITY", SPEC_RGB),
    t("Actual values and block identity: the CAD trailer (BCCo SPC LIST) of each sheet, joined to the drawn symbol by its block number."),
    t("Spec meaning, type, default, tune, range: the manual knowledge base, by function code. Payload layout: manual spec order, I/B = 2 bytes, R = 4 bytes."),
    t("Values are printed as the vendor tools print them (C %g, 6 significant digits). Nothing is filled in: see status columns."),
    t(""),
    t("COUNTS", SPEC_RGB),
    t(`blocks ${r.blocks.length}: ${count(r.blocks, (b) => b.status)}`),
    t(`specifications ${r.specifications.length}: ${count(r.specifications, (s) => s.status)}`),
    t(`block-address specs: ${count(r.specifications.filter((s) => s.address_resolution), (s) => s.address_resolution!.status)}`),
    t(`connections ${r.connections.length}: ${count(r.connections, (c) => `${c.kind}/${c.status}`)}`),
    t(`unknown function codes: ${r.unknown_function_codes.map((u) => `${u.function_code} (${u.blocks.length})`).join(", ") || "none"}`),
    t(`diagnostics: ${count(r.diagnostics, (d) => `${d.code}/${d.severity}`)}`),
    t(""),
    t("EVIDENCE LEGEND", SPEC_RGB),
    t("EXPLICIT   stated by a CAD record (trailer value, symbol block number, exact wire incidence)"),
    t("DERIVED    computed from CAD records with a manual rule (segment membership p.230, output N+k, pin order match)"),
    t("INFERRED   convention applied to CAD data (left pins are inputs; fixed-block table outside its printed scope)"),
    t("UNRESOLVED the sources do not determine it; raw data kept"),
    t("WIRED      the spec's pin is wired: the CAD stores a placeholder value, the drawn wire supplies the source block"),
    t(""),
    t("LAYERS", SPEC_RGB),
    t("SOURCE CAD: reconstructed drawing geometry, unchanged.  SPECIFICATION ANNOTATION: schedules.  MARKING TAG: block frames and callouts (marked edition)."),
  ];
  return lines;
}
