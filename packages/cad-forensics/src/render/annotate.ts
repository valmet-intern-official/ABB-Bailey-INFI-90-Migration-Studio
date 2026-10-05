/**
 * Scene-graph annotations drawn onto a sheet's own display list: S labels on
 * input terminals, N+k sub-block addresses on outputs, manual symbol captions
 * and the plot stamp. Nothing on the source drawing is moved; every
 * annotation is anchored on a resolved terminal position and carries the
 * scene record id as `src` and its evidence level as the PDF layer.
 *
 * Offsets are in source units (vendor symbol convention measured on the
 * plot: S label end-anchored 18 right / 5 above the input pin tip; N+k
 * address at relX +85 from the insertion, 15 below the output row),
 * converted with the page scale.
 */
import { PAGE_H, PLOT_SCALE, type RenderItem as Item } from "@infi90/cad-engine";
import type { FunctionBlockNode, SceneGraph, SheetNode, Status, SubBlock, Terminal } from "../types";

export const ANNOTATION_LAYERS = [
  { id: "ann-explicit", name: "Annotations - EXPLICIT (wire/spec proven)" },
  { id: "ann-derived", name: "Annotations - DERIVED (template / exact pin count / manual)" },
  { id: "ann-inferred", name: "Annotations - INFERRED (pin pitch convention)" },
  { id: "ann-stamp", name: "Plot stamp (archive metadata)" },
];

const RGB: Record<string, [number, number, number]> = {
  "ann-explicit": [0, 0, 0],
  "ann-derived": [0, 0, 0],
  "ann-inferred": [0, 0.2, 0.6],
  "ann-stamp": [0, 0, 0],
};

export function layerOf(s: Status): string | null {
  if (s === "EXPLICIT") return "ann-explicit";
  if (s === "DERIVED") return "ann-derived";
  if (s === "INFERRED") return "ann-inferred";
  return null;
}

export interface AnnotationRecord {
  kind: "s_label" | "sub_block_number" | "caption" | "plot_stamp";
  id: string;
  text: string;
  page_xy: [number, number];
  layer: string;
}

export interface SheetIndex {
  blocks: FunctionBlockNode[];
  terminals: Map<string, Terminal>;
  subBlocks: SubBlock[];
}

export function indexSheets(scene: SceneGraph): Map<string, SheetIndex> {
  const out = new Map<string, SheetIndex>();
  const get = (f: string) => {
    let v = out.get(f);
    if (!v) out.set(f, (v = { blocks: [], terminals: new Map(), subBlocks: [] }));
    return v;
  };
  for (const b of scene.function_blocks) get(b.file).blocks.push(b);
  for (const t of scene.terminals) get(t.block_id.split(":")[0]).terminals.set(t.id, t);
  for (const s of scene.sub_blocks) get(s.file).subBlocks.push(s);
  return out;
}

export function annotateSheet(sheet: SheetNode, idx: SheetIndex | undefined): { items: Item[]; records: AnnotationRecord[]; skipped: Array<{ id: string; reason: string }> } {
  const k = PLOT_SCALE;
  const items: Item[] = [];
  const records: AnnotationRecord[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  const put = (kind: AnnotationRecord["kind"], id: string, text: string, x: number, y: number, size: number, anchor: "start" | "end", layer: string) => {
    items.push({ t: "text", x, y, size, angle: 0, text, anchor, cls: `annotation ${kind}`, src: `scene:${id}`, layer, rgb: RGB[layer] });
    records.push({ kind, id, text, page_xy: [Math.round(x * 100) / 100, Math.round(y * 100) / 100], layer });
  };

  if (sheet.plot_stamp.status !== "NOT_PRESENT") put("plot_stamp", `${sheet.file}:plot_stamp`, sheet.plot_stamp.text, 36.5, PAGE_H - 18, 5.6, "start", "ann-stamp");

  if (!idx) return { items, records, skipped };
  const rotated = new Set(idx.blocks.filter((b) => b.drawn && b.rotation !== 0).map((b) => b.id));

  for (const b of idx.blocks) {
    if (!b.drawn) continue;
    for (const tid of b.input_terminals) {
      const t = idx.terminals.get(tid);
      if (!t?.label) continue;
      const layer = layerOf(t.association);
      if (!t.page_xy || !layer) { skipped.push({ id: t.id, reason: !t.page_xy ? "terminal has no resolved position" : `association ${t.association}` }); continue; }
      if (rotated.has(b.id)) { skipped.push({ id: t.id, reason: "rotated symbol: offsets not established" }); continue; }
      put("s_label", t.id, t.label, t.page_xy[0] + 18 * k, t.page_xy[1] + 5 * k, 18.5 * k, "end", layer);
    }
    if (rotated.has(b.id) || b.glyph !== "FALLBACK" || !b.page_bbox) continue;
    const left = Math.min(b.page_bbox[0], b.page_bbox[2]);
    const bottom = Math.min(b.page_bbox[1], b.page_bbox[3]);
    const top = Math.max(b.page_bbox[1], b.page_bbox[3]);
    // The absent function-block glyph carries an origin cross at its top-left corner.
    const s = 3.2;
    const mark = `${b.id}:origin`;
    items.push({ t: "path", pts: [[left - s, top - s], [left + s, top + s]], cls: "block-origin", src: `scene:${mark}`, layer: "ann-derived" });
    items.push({ t: "path", pts: [[left - s, top + s], [left + s, top - s]], cls: "block-origin", src: `scene:${mark}`, layer: "ann-derived" });
    const lines = [b.manual_title, ...b.captions.filter((c) => c.side === "body" && !c.row_label).map((c) => c.text)].filter((t, i, a): t is string => !!t && a.indexOf(t) === i);
    const lead = 14 * k + 1.2;
    const y0 = (top + bottom) / 2 + ((lines.length - 1) * lead) / 2;
    lines.forEach((line, i) => put("caption", `${b.id}:title:${i}`, line, left + 3, y0 - i * lead, 14 * k, "start", "ann-derived"));
  }
  const blockById = new Map(idx.blocks.map((b) => [b.id, b]));
  const numbered = new Set<string>();
  for (const s of idx.subBlocks) {
    const t = s.terminal_id ? idx.terminals.get(s.terminal_id) : undefined;
    const b = blockById.get(s.parent_block);
    if (rotated.has(s.parent_block)) { skipped.push({ id: s.id, reason: "rotated symbol" }); continue; }
    if (!t?.page_xy || !b) { skipped.push({ id: s.id, reason: !t?.page_xy ? "output terminal has no resolved position" : "output terminal has no parent block" }); continue; }
    // The address value is block+k from the CAD and the manual. Draw it in
    // black on the pin row, just to the right of the terminal.
    const layer = "ann-derived";
    const size = 20 * k;
    const [x, y] = t.page_xy;
    const edge = b.page_bbox ? Math.max(b.page_bbox[0], b.page_bbox[2]) : x;
    items.push({ t: "path", pts: [[x, y - 4 * k], [x, y + 4 * k]], cls: "pin-tick", src: `scene:${s.id}`, layer, w: 0.5 });
    put("sub_block_number", s.id, String(s.address), edge + 1.6, y - size * 0.35, size, "start", layer);
    numbered.add(s.parent_block);
    const cap = b.captions.find((c) => c.side === "output" && c.row_label && (c.row_label === s.output_label || c.row_label === String(s.address)));
    if (cap) put("caption", `${b.id}:caption:${s.output_label}`, cap.text, x - 1.6, y - 14 * k * 0.35, 14 * k, "end", layer);
  }
  // (FC) sits one label-line (20 source units) above the top output address.
  for (const b of idx.blocks) {
    if (!b.drawn || b.function_code == null || rotated.has(b.id)) continue;
    const subs = idx.subBlocks.filter((s) => s.parent_block === b.id && s.terminal_id && idx.terminals.get(s.terminal_id)?.page_xy);
    const topSub = subs.reduce<SubBlock | null>((best, s) => {
      const y = idx.terminals.get(s.terminal_id!)!.page_xy![1];
      return !best || y > idx.terminals.get(best.terminal_id!)!.page_xy![1] ? s : best;
    }, null);
    if (!topSub) continue;
    const pin = idx.terminals.get(topSub.terminal_id!)!.page_xy!;
    const edge = b.page_bbox ? Math.max(b.page_bbox[0], b.page_bbox[2]) : pin[0];
    const size = 20 * k;
    put("caption", `${b.id}:fc`, `(${b.function_code})`, edge + 1.6, pin[1] + 20 * k - size * 0.35, size, "start", "ann-derived");
  }
  // A block whose outputs could not be placed still keeps its own address.
  for (const b of idx.blocks) {
    if (!b.drawn || b.block_address == null || numbered.has(b.id) || rotated.has(b.id) || !b.page_bbox) continue;
    const head = idx.subBlocks.find((s) => s.parent_block === b.id && s.offset === 0);
    const x = Math.max(b.page_bbox[0], b.page_bbox[2]) + 1.6;
    const y = Math.max(b.page_bbox[1], b.page_bbox[3]);
    put("sub_block_number", head?.id ?? `${b.id}.address`, String(b.block_address), x, y, 20 * k, "start", "ann-derived");
  }
  return { items, records, skipped };
}
