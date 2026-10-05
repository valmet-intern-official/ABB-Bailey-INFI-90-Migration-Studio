/**
 * Scene data drawn onto each sheet's own display list, for the CAD viewer SVG
 * and the per-sheet plot PDF: S labels on input pins, N+k sub-block addresses,
 * the plot stamp, and every block's S1..SN values listed under its symbol.
 * Source geometry is never moved; spec values sit on their own PDF layer.
 */
import { COURIER_ADVANCE, type RenderItem as Item } from "@infi90/cad-engine";
import type { FunctionBlockNode, SceneGraph, SpecificationTerminal } from "../types";
import { ANNOTATION_LAYERS, annotateSheet, indexSheets } from "./annotate";

export const OVERLAY_LAYERS = [...ANNOTATION_LAYERS, { id: "ann-spec", name: "Specification values S1..SN (CAD trailer)" }];

const SPEC_SIZE = 2.6;
const SPEC_LEAD = 3.1;
const SPEC_RGB: [number, number, number] = [0, 0.25, 0.55];

const valueText = (s: SpecificationTerminal) => (s.raw_value_text == null || s.raw_value_text === "" ? "?" : s.raw_value_text);

function specLine(s: SpecificationTerminal): string {
  const from = s.wired_from?.[0];
  const wired = from?.source_block != null ? `, wired from block ${from.source_block}${s.effective_input?.address != null ? ` output ${s.effective_input.address}` : ""}` : "";
  const desc = s.manual_description ? `  ${s.manual_description}` : "";
  const meaning = s.enumeration_meaning ? ` = ${s.enumeration_meaning}` : "";
  return `${s.label} = ${valueText(s)}${meaning}${desc} [${s.value_status}${wired}]`;
}

function blockTip(b: FunctionBlockNode, specs: SpecificationTerminal[]): string {
  const head = [`Block ${b.block_address ?? "?"}`, b.function_code != null ? `FC${b.function_code}` : null, b.function_name, b.symbol_name ? `(${b.symbol_name})` : null]
    .filter(Boolean)
    .join(" ");
  return [head, ...specs.map(specLine)].join("\n");
}

/** Wrap "S1=v" tokens into lines no wider than `width` points. */
function wrapTokens(tokens: string[], width: number): string[] {
  const maxChars = Math.max(8, Math.floor(width / (COURIER_ADVANCE * SPEC_SIZE)));
  const lines: string[] = [];
  let cur = "";
  for (const t of tokens) {
    const next = cur ? `${cur} ${t}` : t;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = t;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

type Box = [number, number, number, number];

/** Page-space boxes of everything drawn: one per path segment (so long frame lines stay thin) and one per text. */
function obstacles(items: Item[]): Box[] {
  const boxes: Box[] = [];
  for (const it of items) {
    if (it.invisible) continue;
    if (it.t === "path") {
      const pts = it.closed ? [...it.pts, it.pts[0]] : it.pts;
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
        boxes.push([Math.min(ax, bx) - 0.4, Math.min(ay, by) - 0.4, Math.max(ax, bx) + 0.4, Math.max(ay, by) + 0.4]);
      }
    } else if (it.t === "arc") {
      boxes.push([it.cx - it.r, it.cy - it.r, it.cx + it.r, it.cy + it.r]);
    } else if (!it.angle) {
      const w = COURIER_ADVANCE * it.size * it.text.length;
      const x0 = it.anchor === "end" ? it.x - w : it.anchor === "middle" ? it.x - w / 2 : it.x;
      boxes.push([x0, it.y - it.size * 0.25, x0 + w, it.y + it.size * 0.8]);
    }
  }
  return boxes;
}

const hits = (a: Box, boxes: Box[]) => boxes.some((b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]);

/**
 * Overlay items for one sheet. `base` is the sheet's own display list; spec
 * values are placed only where they cross no drawn line or text, otherwise
 * they stay in the block tooltip (`unplaced`).
 */
export function sheetOverlays(scene: SceneGraph, baseItems?: Map<string, Item[]>): { items: Map<string, Item[]>; unplaced: string[] } {
  const idx = indexSheets(scene);
  const specsOf = new Map<string, SpecificationTerminal[]>();
  for (const s of scene.specifications) {
    const l = specsOf.get(s.parent_block) ?? [];
    l.push(s);
    specsOf.set(s.parent_block, l);
  }
  const out = new Map<string, Item[]>();
  const unplaced: string[] = [];
  for (const sh of scene.sheets) {
    const items: Item[] = annotateSheet(sh, idx.get(sh.file)).items;
    const blocks = (idx.get(sh.file)?.blocks ?? []).filter((b) => b.drawn && b.page_bbox);
    const occupied = obstacles([...(baseItems?.get(sh.file) ?? []), ...items]);
    for (const b of blocks) {
      const [x1, y1, x2, y2] = b.page_bbox!;
      occupied.push([Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)]);
    }
    for (const b of blocks) {
      const specs = (specsOf.get(b.id) ?? []).slice().sort((a, c) => a.number - c.number);
      const blockId = b.id.startsWith(`${sh.file}:`) ? b.id.slice(sh.file.length + 1) : b.id;
      const [x1, y1, x2, y2] = b.page_bbox!;
      const left = Math.min(x1, x2), right = Math.max(x1, x2), bottom = Math.min(y1, y2), top = Math.max(y1, y2);
      const tip = blockTip(b, specs);
      items.push({ t: "path", pts: [[left, bottom], [right, bottom], [right, top], [left, top]], closed: true, invisible: true, cls: "block-hit", src: `scene:${b.id}`, blockId, tip });
      if (!specs.length) continue;
      // The block address leads the list so it reads unambiguously wherever it lands.
      const tokens = [`${b.block_address ?? "?"}:`, ...specs.map((s) => `${s.label}=${valueText(s)}`)];
      let placed = false;
      for (const width of [Math.max(right - left, 40), 70, 110]) {
        const lines = wrapTokens(tokens, width);
        const w = Math.max(...lines.map((l) => l.length)) * COURIER_ADVANCE * SPEC_SIZE;
        const h = lines.length * SPEC_LEAD;
        // Top-left corner of the text block (first baseline sits SPEC_SIZE below it).
        const spots: Array<[number, number]> = [];
        for (const d of [0, 6, 14, 24]) {
          spots.push(
            [left, bottom - 1.5 - d],
            [left, top + h + 1.5 + d],
            [right + 14 + d, top],
            [right + 14 + d, bottom + h],
            [left - 10 - w - d, top],
            [left - 10 - w - d, bottom + h]
          );
        }
        const spot = spots.find(([sx, sy]) => !hits([sx - 0.5, sy - h - 0.5, sx + w + 0.5, sy + 0.5], occupied));
        if (!spot) continue;
        const [sx, sy] = spot;
        occupied.push([sx, sy - h, sx + w, sy]);
        lines.forEach((text, i) => {
          items.push({ t: "text", x: sx, y: sy - SPEC_SIZE * 0.8 - i * SPEC_LEAD, size: SPEC_SIZE, angle: 0, text, cls: "annotation spec_values", src: `scene:${b.id}:specs`, blockId, layer: "ann-spec", rgb: SPEC_RGB, tip });
        });
        placed = true;
        break;
      }
      if (!placed) unplaced.push(b.id);
    }
    out.set(sh.file, items);
  }
  return { items: out, unplaced };
}
