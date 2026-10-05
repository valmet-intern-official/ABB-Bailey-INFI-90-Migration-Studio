/**
 * DrawingSheet -> display list in page coordinates (points, origin
 * bottom-left). One display list feeds both the SVG and the PDF writer, so
 * the two outputs cannot drift apart.
 *
 * Page geometry: A4 landscape, 842 x 595 pt. Source coordinates are mapped
 * by one uniform scale and translation anchored on the drawing frame — the
 * same normalisation the vendor plot applies (fitted residual < 0.1 pt on
 * `3260501A`). No element is moved relative to any other.
 *
 * Every item carries `src` (`file@offset`, or `library@offset`) and a `cls`
 * naming its layer, so each drawn mark traces back to a source record.
 */
import type { SymbolRegistry } from "../lbr/library";
import { expandSymbol, type LibPrimitive } from "./libexpand";
import type * as T from "./types";

export const PAGE_W = 842;
export const PAGE_H = 595;
/** Points per source unit; fitted against the vendor plot. */
export const PLOT_SCALE = 0.2125875;
/** Page position of the frame's lower-left corner (vendor layout). */
const FRAME_ORIGIN = { x: 36.505, y: 57.328 };
const LINE_W = 0.35;

/** Optional PDF layer (optional content group id) and RGB colour, 0..1. */
interface ItemStyle {
  layer?: string;
  rgb?: [number, number, number];
  /** Hover text in the SVG viewer; not written to PDF. */
  tip?: string;
  /** Hit area only: drawn transparent in SVG, omitted from PDF. */
  invisible?: boolean;
}

export type Item = ItemStyle &
  (
    | { t: "path"; pts: Array<[number, number]>; closed?: boolean; fill?: boolean; w?: number; dash?: number[]; cls: string; src: string; blockId?: string; connectionId?: string }
    | { t: "arc"; cx: number; cy: number; r: number; a0: number; a1: number; w?: number; cls: string; src: string; blockId?: string }
    | { t: "text"; x: number; y: number; size: number; angle: number; text: string; anchor?: "start" | "end" | "middle"; cls: string; src: string; blockId?: string }
  );

export interface PageTransform {
  k: number;
  ox: number;
  oy: number;
  x: (sx: number) => number;
  y: (sy: number) => number;
}

export function pageTransform(sheet: T.DrawingSheet): PageTransform {
  let ox: number, oy: number;
  const k = PLOT_SCALE;
  if (sheet.frame.bbox) {
    ox = FRAME_ORIGIN.x - k * sheet.frame.bbox.x1;
    oy = FRAME_ORIGIN.y - k * sheet.frame.bbox.y1;
  } else {
    // No frame record: centre the source extent at the same scale.
    const xs = [...sheet.functionBlocks, ...sheet.connectors].flatMap((b) => [b.sourceBBox.x1, b.sourceBBox.x2]);
    const ys = [...sheet.functionBlocks, ...sheet.connectors].flatMap((b) => [b.sourceBBox.y1, b.sourceBBox.y2]);
    const cx = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
    const cy = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
    ox = PAGE_W / 2 - k * cx;
    oy = PAGE_H / 2 - k * cy;
  }
  return { k, ox, oy, x: (sx) => k * sx + ox, y: (sy) => k * sy + oy };
}

const dashOf = (style: number): number[] | undefined => (style === 1 ? [2.2, 1.4] : style === 2 ? [5, 2] : undefined);

export interface RenderStats {
  libraryPrimitives: number;
  fallbackGlyphs: number;
  libraryGlyphs: number;
  missingLibrarySymbols: string[];
}

export function renderSheet(sheet: T.DrawingSheet, registry: SymbolRegistry): { items: Item[]; stats: RenderStats } {
  const tf = pageTransform(sheet);
  const P = (p: T.Pt): [number, number] => [tf.x(p.x), tf.y(p.y)];
  const items: Item[] = [];
  const stats: RenderStats = { libraryPrimitives: 0, fallbackGlyphs: 0, libraryGlyphs: 0, missingLibrarySymbols: [] };
  const fsrc = (o: number) => `${sheet.file}@${o}`;
  const txt = (x: number, y: number, h: number, text: string, cls: string, src: string, angle = 0, anchor: "start" | "end" | "middle" = "start") =>
    items.push({ t: "text", x: tf.x(x), y: tf.y(y), size: Math.max(1, h * tf.k), angle, text, anchor, cls, src });

  const drawLib = (prims: LibPrimitive[], cls: string, blockId?: string) => {
    for (const p of prims) {
      const src = `${p.library}@${p.offset}`;
      stats.libraryPrimitives++;
      if (p.kind === "polyline") items.push({ t: "path", pts: p.points.map(P), dash: dashOf(p.style), cls, src, blockId });
      else if (p.kind === "rect") items.push({ t: "path", pts: [P(p.a), P({ x: p.b.x, y: p.a.y }), P(p.b), P({ x: p.a.x, y: p.b.y })], closed: true, cls, src, blockId });
      else if (p.kind === "segment2") items.push({ t: "path", pts: [P(p.a), P(p.b)], cls: `${cls} unresolved-type2`, src, blockId });
      else if (p.kind === "arc") pushArc(p.center, p.start, p.end, cls, src, blockId);
      else if (p.kind === "text") items.push({ t: "text", x: tf.x(p.at.x), y: tf.y(p.at.y), size: Math.max(1, p.height * tf.k), angle: p.rotation, text: p.text, cls, src, blockId });
    }
  };
  const pushArc = (c: T.Pt, s: T.Pt, e: T.Pt, cls: string, src: string, blockId?: string) => {
    const r = Math.hypot(s.x - c.x, s.y - c.y) * tf.k;
    const a0 = Math.atan2(s.y - c.y, s.x - c.x);
    let a1 = Math.atan2(e.y - c.y, e.x - c.x);
    // Clockwise from start to end (Y up), as the library's letterforms require.
    while (a1 >= a0) a1 -= 2 * Math.PI;
    items.push({ t: "arc", cx: tf.x(c.x), cy: tf.y(c.y), r, a0, a1, cls, src, blockId });
  };

  // ---- frame, grid, title block: authentic library geometry
  if (sheet.frame.present && sheet.frame.insertion) {
    const { primitives, missing } = expandSymbol(registry, "DBORDH", sheet.frame.insertion.x, sheet.frame.insertion.y, 0);
    drawLib(primitives, "frame");
    stats.missingLibrarySymbols.push(...missing);
  }
  for (const c of sheet.frame.components) {
    const { primitives, missing } = expandSymbol(registry, c.symbolName, c.insertion.x, c.insertion.y, c.rotation);
    drawLib(primitives, "frame component");
    stats.missingLibrarySymbols.push(...missing);
  }

  // ---- source wires and drawn rules
  for (const c of sheet.connections) {
    items.push({
      t: "path",
      pts: c.points.map(P),
      dash: dashOf(c.style),
      cls: c.connectionType === "signal" ? `wire ${c.relationStatus.toLowerCase()}` : "rule",
      src: fsrc(c.source.offset),
      connectionId: c.connectionType === "signal" ? c.id : undefined,
    });
  }
  for (const a of sheet.arcs) pushArc(a.center, a.start, a.end, "drawing", fsrc(a.source.offset));

  // ---- symbols
  const pinsOf = new Map<string, T.FunctionPin[]>();
  for (const p of sheet.pins) pinsOf.set(p.blockId, [...(pinsOf.get(p.blockId) ?? []), p]);
  for (const b of sheet.functionBlocks) {
    if (b.glyph.status === "LIBRARY") {
      const { primitives, missing } = expandSymbol(registry, b.symbolName, b.insertion.x, b.insertion.y, b.rotation);
      drawLib(primitives, "block library", b.id);
      stats.libraryGlyphs++;
      stats.missingLibrarySymbols.push(...missing);
      continue;
    }
    stats.fallbackGlyphs++;
    fallbackGlyph(b, pinsOf.get(b.id) ?? [], P, txt, items, fsrc(b.source.offset));
  }
  for (const c of sheet.connectors) connectorGlyph(c, P, txt, items, fsrc(c.source.offset));
  for (const j of sheet.junctions) {
    if (j.kind !== "connected" || !j.source) continue;
    const [x, y] = P(j.at);
    const d = 6 * tf.k;
    items.push({ t: "path", pts: [[x - d, y], [x, y + d], [x + d, y], [x, y - d]], closed: true, cls: "junction fallback", src: fsrc(j.source.offset), blockId: j.id });
  }

  // ---- source text records
  for (const t of sheet.texts) txt(t.bbox.x1, t.bbox.y1, t.height || 20, t.text, `text ${t.role}`, fsrc(t.source.offset), t.rotation);

  // ---- sheet identifier: the source file name, where the plotter stamps it
  if (sheet.frame.bbox) txt(sheet.frame.bbox.x2 - 20, sheet.frame.bbox.y1 - 45, 25, sheet.file, "sheet-id", `${sheet.file}@name`, 0, "end");

  stats.missingLibrarySymbols = [...new Set(stats.missingLibrarySymbols)];
  return { items, stats };
}

type Txt = (x: number, y: number, h: number, text: string, cls: string, src: string, angle?: number, anchor?: "start" | "end" | "middle") => void;

/**
 * FALLBACK glyph: the proprietary definition is absent, so the body is the
 * source bounding box and every pin stub ends on its source-derived pin.
 * Addresses, (FC) and pin captions are drawn by the scene overlay, which
 * has the manual output rows; this glyph does not invent them.
 */
function fallbackGlyph(b: T.FunctionBlock, pins: T.FunctionPin[], P: (p: T.Pt) => [number, number], txt: Txt, items: Item[], src: string) {
  const B = b.sourceBBox;
  // The source bbox is the symbol extent, including unwired pins the wires
  // never reach. Shrinking it to the wired pins drops those rows.
  const x1 = Math.min(B.x1, B.x2);
  const x2 = Math.max(B.x1, B.x2);
  const y1 = Math.min(B.y1, B.y2);
  const y2 = Math.max(B.y1, B.y2);
  const cls = `block fallback fam-${b.family}`;
  const body = (pts: T.Pt[]) => items.push({ t: "path", pts: pts.map(P), closed: true, cls, src, blockId: b.id });
  const cy = (y1 + y2) / 2;
  switch (b.family) {
    case "gate-or":
      body([{ x: x1, y: y1 }, { x: x2 - 20, y: y1 }, { x: x2, y: cy }, { x: x2 - 20, y: y2 }, { x: x1, y: y2 }, { x: x1 + 12, y: cy }]);
      break;
    case "gate-not":
      body([{ x: x1, y: y1 }, { x: x2 - 12, y: cy }, { x: x1, y: y2 }]);
      break;
    case "constant":
      body([{ x: B.x1, y: B.y1 }, { x: B.x2, y: B.y1 }, { x: B.x2, y: B.y2 }, { x: B.x1, y: B.y2 }]);
      break;
    default:
      body([{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }]);
  }
  for (const p of pins) {
    const edgeX = p.side === "left" ? x1 : p.side === "right" ? x2 : p.sourceX;
    const edgeY = p.side === "top" ? y2 : p.side === "bottom" ? y1 : p.sourceY;
    items.push({ t: "path", pts: [P({ x: p.sourceX, y: p.sourceY }), P({ x: edgeX, y: edgeY })], cls: `pin ${p.connected ? "connected" : "unconnected"}`, src, blockId: b.id });
    if (p.side === "left") {
      items.push({ t: "path", pts: [P({ x: x1, y: p.sourceY }), P({ x: x1 - 14, y: p.sourceY + 6 }), P({ x: x1 - 14, y: p.sourceY - 6 })], closed: true, fill: true, cls: "pin-arrow", src, blockId: b.id });
    }
  }
  if (b.terminals?.length) {
    b.terminals.forEach((t, i) => txt(x1 + 6, y2 - 28 - i * 24, 14, [t.reference, t.tag].filter(Boolean).join(" "), "terminal", src));
  }
}

/** FALLBACK connector glyph: elongated hexagon on the source-derived connection point. */
function connectorGlyph(c: T.Connector, P: (p: T.Pt) => [number, number], txt: Txt, items: Item[], src: string) {
  const y = c.connectionPoint?.y ?? c.insertion.y;
  const inShape = c.symbolName !== "OREF";
  const x0 = inShape ? c.insertion.x : c.connectionPoint?.x ?? c.insertion.x - 60;
  const pts = [
    { x: x0, y },
    { x: x0 + 20, y: y + 20 },
    { x: x0 + 200, y: y + 20 },
    { x: x0 + 220, y },
    { x: x0 + 200, y: y - 20 },
    { x: x0 + 20, y: y - 20 },
  ];
  items.push({ t: "path", pts: pts.map(P), closed: true, cls: `connector fallback ${c.kind.toLowerCase()} ${c.resolution.status.toLowerCase()}`, src });
  const at = c.connectionPoint ?? { x: x0, y };
  const [mx, my] = P(at);
  const d = 4.5 * PLOT_SCALE;
  items.push({ t: "path", pts: [[mx - d, my - d], [mx + d, my + d]], cls: "connector-mark", src });
  items.push({ t: "path", pts: [[mx - d, my + d], [mx + d, my - d]], cls: "connector-mark", src });
  if (c.reference) txt(x0 + 24, y - 7, 20, c.reference, "connector-ref", src);
  if (c.tag) {
    if (inShape) txt(x0 + 232, y + 6, 20, c.tag, "connector-tag", src);
    else txt(x0 - 8, y + 6, 20, c.tag, "connector-tag", src, 0, "end");
  }
}

// ------------------------------------------------------------------ SVG
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f2 = (n: number) => (Math.round(n * 100) / 100).toString();

export function toSvg(items: Item[], title: string): string {
  const H = PAGE_H;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${H}" viewBox="0 0 ${PAGE_W} ${H}" data-sheet="${esc(title)}">`);
  out.push(`<title>${esc(title)}</title>`);
  out.push(`<rect width="100%" height="100%" fill="#fff"/>`);
  out.push(`<g fill="none" stroke="#000" stroke-width="${LINE_W}" stroke-linejoin="round" stroke-linecap="round" font-family="Courier New, Courier, monospace">`);
  const rgbHex = (c: [number, number, number]) => `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
  for (const it of items) {
    const colour = it.rgb ? rgbHex(it.rgb) : null;
    const idAttr =
      ("blockId" in it && it.blockId ? ` data-block-id="${esc(it.blockId)}"` : "") +
      ("connectionId" in it && it.connectionId ? ` data-connection-id="${esc(it.connectionId)}"` : "") +
      (it.layer ? ` data-layer="${esc(it.layer)}"` : "") +
      (colour && it.t !== "text" ? ` stroke="${colour}"` : "") +
      (it.t !== "text" && it.w != null ? ` stroke-width="${it.w}"` : "");
    const tip = it.tip ? `<title>${esc(it.tip)}</title>` : "";
    if (it.t === "path" && it.invisible) {
      const d = it.pts.map(([x, y], i) => `${i ? "L" : "M"}${f2(x)} ${f2(H - y)}`).join("") + "Z";
      out.push(`<path class="${it.cls}" data-src="${esc(it.src)}"${idAttr} d="${d}" fill="transparent" stroke="none">${tip}</path>`);
    } else if (it.t === "path") {
      const d = it.pts.map(([x, y], i) => `${i ? "L" : "M"}${f2(x)} ${f2(H - y)}`).join("") + (it.closed ? "Z" : "");
      out.push(`<path class="${it.cls}" data-src="${esc(it.src)}"${idAttr} d="${d}"${it.fill ? ` fill="${colour ?? "#000"}"` : ""}${it.dash ? ` stroke-dasharray="${it.dash.join(",")}"` : ""}>${tip}</path>`);
    } else if (it.t === "arc") {
      const sx = it.cx + it.r * Math.cos(it.a0), sy = it.cy + it.r * Math.sin(it.a0);
      const ex = it.cx + it.r * Math.cos(it.a1), ey = it.cy + it.r * Math.sin(it.a1);
      const large = Math.abs(it.a1 - it.a0) > Math.PI ? 1 : 0;
      // Clockwise on paper is SVG sweep-flag 1 once Y is flipped for display.
      out.push(`<path class="${it.cls}" data-src="${esc(it.src)}"${idAttr} d="M${f2(sx)} ${f2(H - sy)}A${f2(it.r)} ${f2(it.r)} 0 ${large} 1 ${f2(ex)} ${f2(H - ey)}"/>`);
    } else {
      const rot = it.angle ? ` transform="rotate(${-it.angle} ${f2(it.x)} ${f2(H - it.y)})"` : "";
      const anchor = it.anchor && it.anchor !== "start" ? ` text-anchor="${it.anchor}"` : "";
      out.push(`<text class="${it.cls}" data-src="${esc(it.src)}"${idAttr} x="${f2(it.x)}" y="${f2(H - it.y)}" font-size="${f2(it.size)}" fill="${colour ?? "#000"}" stroke="none"${anchor}${rot} xml:space="preserve">${tip}${esc(it.text)}</text>`);
    }
  }
  out.push(`</g></svg>`);
  return out.join("\n");
}
