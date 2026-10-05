/**
 * Rendered-output verification: checks the document pages against the scene
 * graph item by item. Every defect names the scene record and the page.
 * Used by the CLI (pre-final matrix) and by the mutation tests.
 */
import type { PdfPage, RenderItem as Item } from "@infi90/cad-engine";
import type { EngineeringDocument } from "./render/document";
import type { SceneGraph } from "./types";

export interface Defect {
  kind:
    | "ANNOTATION_MISSING"
    | "ANNOTATION_MOVED"
    | "ANNOTATION_TEXT"
    | "BLOCK_NUMBER_MISSING"
    | "WIRE_MISSING"
    | "WIRE_ENDPOINT"
    | "REFERENCE_MISSING"
    | "REFERENCE_TEXT"
    | "CHANNEL_TEXT"
    | "SPEC_NOT_LISTED"
    | "SPEC_VALUE"
    | "TERMINAL_NOT_LISTED"
    | "SUB_BLOCK_NOT_LISTED"
    | "CONNECTION_NOT_LISTED"
    | "CROSS_PAGE_TARGET";
  id: string;
  page: number | null;
  detail: string;
}

type Hit = { page: number; item: Item };

function index(pages: PdfPage[], from: number, to: number) {
  const bySrc = new Map<string, Hit[]>();
  for (let p = from; p < to; p++) {
    for (const item of pages[p].items) {
      const l = bySrc.get(item.src);
      if (l) l.push({ page: p, item });
      else bySrc.set(item.src, [{ page: p, item }]);
    }
  }
  return bySrc;
}

const texts = (hits: Hit[] | undefined) => (hits ?? []).flatMap((h) => (h.item.t === "text" ? [h.item.text] : []));
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

export function verifyDocument(scene: SceneGraph, doc: EngineeringDocument): Defect[] {
  const defects: Defect[] = [];
  const nDrawing = doc.pageMap.drawing.length;
  const pageOfFile = new Map(doc.pageMap.drawing.map((d) => [d.file, d.page - 1]));
  const drawingIdx = index(doc.pages, 0, nDrawing);
  const reportIdx = index(doc.pages, nDrawing, doc.pages.length);
  const onPage = (src: string, file: string) => (drawingIdx.get(src) ?? []).filter((h) => h.page === pageOfFile.get(file));

  // annotations (S labels, N+k addresses, plot stamps): exact text at the recorded anchor
  for (const a of doc.annotations) {
    const file = a.id.split(":")[0];
    const hits = onPage(`scene:${a.id}`, file).filter((h) => h.item.t === "text");
    if (!hits.length) { defects.push({ kind: "ANNOTATION_MISSING", id: a.id, page: pageOfFile.get(file) ?? null, detail: `${a.kind} '${a.text}'` }); continue; }
    const it = hits[0].item as Extract<Item, { t: "text" }>;
    if (it.text !== a.text) defects.push({ kind: "ANNOTATION_TEXT", id: a.id, page: hits[0].page, detail: `drawn '${it.text}' expected '${a.text}'` });
    if (!near(it.x, a.page_xy[0], 0.02) || !near(it.y, a.page_xy[1], 0.02)) defects.push({ kind: "ANNOTATION_MOVED", id: a.id, page: hits[0].page, detail: `drawn (${it.x},${it.y}) expected (${a.page_xy})` });
  }

  // block address on the drawing: the output column, or the glyph caption
  for (const b of scene.function_blocks) {
    if (!b.drawn || b.block_address == null) continue;
    const addr = String(b.block_address);
    const src = b.source_entities.find((s) => /@\d+$/.test(s));
    const onGlyph = src
      ? onPage(src, b.file).some((h) => h.item.t === "text" && h.item.cls === "block-number" && (h.item as Extract<Item, { t: "text" }>).text === addr)
      : false;
    const onColumn = doc.annotations.some((a) => a.kind === "sub_block_number" && a.text === addr && (a.id === `${b.id}.address` || a.id.startsWith(`${b.id}.`)));
    if (!onGlyph && !onColumn) defects.push({ kind: "BLOCK_NUMBER_MISSING", id: b.id, page: pageOfFile.get(b.file) ?? null, detail: `block ${b.block_address}` });
  }

  // wires: drawn path from the same source record, same end points
  for (const w of scene.wires) {
    const src = w.source_entity_ids[0];
    const drawnAs = (cls: string) => (w.connection_type === "rule" ? cls === "rule" : cls.startsWith("wire"));
    const paths = onPage(src, w.file).filter((h) => h.item.t === "path" && drawnAs(h.item.cls));
    if (!paths.length) { defects.push({ kind: "WIRE_MISSING", id: w.id, page: pageOfFile.get(w.file) ?? null, detail: src }); continue; }
    const pts = (paths[0].item as Extract<Item, { t: "path" }>).pts;
    const [a, z] = [w.page_points[0], w.page_points[w.page_points.length - 1]];
    const ok = (p: [number, number], q: [number, number]) => near(p[0], q[0], 0.05) && near(p[1], q[1], 0.05);
    if (!(ok(pts[0], a) && ok(pts[pts.length - 1], z))) defects.push({ kind: "WIRE_ENDPOINT", id: w.id, page: paths[0].page, detail: `drawn ${pts[0]}..${pts[pts.length - 1]} expected ${a}..${z}` });
  }

  // IREF / OREF: connector glyph and its exact reference + signal strings
  for (const r of scene.references) {
    const hits = r.source_entities.flatMap((s) => onPage(s, r.file));
    if (!hits.some((h) => h.item.cls.startsWith("connector"))) { defects.push({ kind: "REFERENCE_MISSING", id: r.id, page: pageOfFile.get(r.file) ?? null, detail: `${r.type} ${r.label ?? ""} ${r.signal ?? ""}` }); continue; }
    const drawn = texts(hits);
    for (const s of [r.label, r.signal]) if (s && !drawn.includes(s)) defects.push({ kind: "REFERENCE_TEXT", id: r.id, page: hits[0].page, detail: `'${s}' not drawn exactly (drawn: ${drawn.join(" | ")})` });
  }

  // channels: exact string, never normalised
  for (const c of scene.channels) {
    const drawn = c.source_entities.flatMap((s) => texts(onPage(s, c.file))).map((t) => t.trim());
    if (!drawn.includes(c.text)) defects.push({ kind: "CHANNEL_TEXT", id: c.id, page: pageOfFile.get(c.file) ?? null, detail: `'${c.text}' not drawn exactly (drawn: ${drawn.join(" | ")})` });
  }

  // detail pages: every spec / terminal / sub-block row; spec value printed in its row
  for (const s of scene.specifications) {
    const rows = texts(reportIdx.get(s.id));
    if (!rows.some((t) => t.startsWith(`${s.label} `) || t === s.label)) { defects.push({ kind: "SPEC_NOT_LISTED", id: s.id, page: null, detail: s.label }); continue; }
    const raw = s.actual_value != null ? String(s.raw_value_text ?? s.actual_value) : s.value_status;
    const value = raw == null || raw === "" ? "-" : raw;
    const first = rows.find((t) => t.startsWith(`${s.label} `)) ?? "";
    const valueCol = first.slice(5, 21).trim();
    if (!valueCol || !value.startsWith(valueCol)) defects.push({ kind: "SPEC_VALUE", id: s.id, page: null, detail: `row value '${valueCol}' expected '${value}'` });
  }
  for (const t of scene.terminals) if (!reportIdx.has(t.id)) defects.push({ kind: "TERMINAL_NOT_LISTED", id: t.id, page: null, detail: `${t.pin ?? "-"} ${t.label ?? "-"}` });
  for (const s of scene.sub_blocks) if (!reportIdx.has(s.id)) defects.push({ kind: "SUB_BLOCK_NOT_LISTED", id: s.id, page: null, detail: `${s.output_label} = ${s.address}` });

  // connections: listed individually in the annex; cross-page target sheet named
  for (const c of scene.connections) {
    const lines = texts(reportIdx.get(c.id));
    if (!lines.some((t) => t.startsWith(c.id))) { defects.push({ kind: "CONNECTION_NOT_LISTED", id: c.id, page: null, detail: c.kind }); continue; }
    if (c.cross_page && c.target_file && !lines.some((t) => t.includes(c.target_file!))) defects.push({ kind: "CROSS_PAGE_TARGET", id: c.id, page: null, detail: `target sheet ${c.target_file} not printed` });
  }
  return defects;
}
