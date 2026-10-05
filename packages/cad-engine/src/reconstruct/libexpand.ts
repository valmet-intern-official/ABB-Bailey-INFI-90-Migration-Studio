/**
 * Expand a placed library symbol into sheet-space primitives, recursing into
 * nested symbol instances. Placement is the confirmed transform: rotate about
 * the definition insertion point, then translate it onto the instance
 * insertion point. Every primitive keeps its library byte offset.
 */
import type { LbrSymbol, SymbolRegistry } from "../lbr/library";
import type { RawCadRecord } from "../records/decode";
import type { Pt } from "./types";

export type LibPrimitive =
  | { kind: "polyline"; points: Pt[]; style: number; layer: number; library: string; offset: number; symbol: string }
  | { kind: "rect"; a: Pt; b: Pt; layer: number; library: string; offset: number; symbol: string }
  | { kind: "arc"; center: Pt; start: Pt; end: Pt; layer: number; library: string; offset: number; symbol: string }
  | { kind: "segment2"; a: Pt; b: Pt; layer: number; library: string; offset: number; symbol: string }
  | { kind: "text"; at: Pt; text: string; height: number; rotation: number; layer: number; library: string; offset: number; symbol: string };

export interface Placement {
  map: (p: Pt) => Pt;
  rotation: number;
}

export function placement(def: LbrSymbol, insX: number, insY: number, rotation: number): Placement {
  const r = ((rotation % 360) + 360) % 360;
  const [c, s] = r === 90 ? [0, 1] : r === 180 ? [-1, 0] : r === 270 ? [0, -1] : [1, 0];
  return {
    rotation: r,
    map: (p) => {
      const dx = p.x - def.insertionX;
      const dy = p.y - def.insertionY;
      return { x: insX + dx * c - dy * s, y: insY + dx * s + dy * c };
    },
  };
}

export function expandSymbol(
  registry: SymbolRegistry,
  name: string,
  insX: number,
  insY: number,
  rotation: number,
  out: LibPrimitive[] = [],
  depth = 0,
  missing: Set<string> = new Set()
): { primitives: LibPrimitive[]; missing: Set<string> } {
  const def = registry.get(name);
  if (!def || depth > 8) {
    missing.add(name);
    return { primitives: out, missing };
  }
  const pl = placement(def, insX, insY, rotation);
  const base = { library: def.library, symbol: def.name };
  for (const r of def.records as RawCadRecord[]) {
    if (r.kind === "polyline") {
      out.push({ kind: "polyline", points: r.points.map(pl.map), style: r.style ?? 0, layer: r.layer, offset: r.offset, ...base });
    } else if (r.kind === "primitive2" && r.type === 3) {
      out.push({ kind: "rect", a: pl.map(r.points[0]), b: pl.map(r.points[1]), layer: r.layer, offset: r.offset, ...base });
    } else if (r.kind === "primitive2") {
      out.push({ kind: "segment2", a: pl.map(r.points[0]), b: pl.map(r.points[1]), layer: r.layer, offset: r.offset, ...base });
    } else if (r.kind === "primitive3") {
      out.push({ kind: "arc", center: pl.map(r.points[0]), start: pl.map(r.points[1]), end: pl.map(r.points[2]), layer: r.layer, offset: r.offset, ...base });
    } else if (r.kind === "text" && r.text) {
      out.push({
        kind: "text",
        at: pl.map({ x: r.x1, y: r.y1 }),
        text: r.text,
        height: r.textHeight ?? 20,
        rotation: ((r.rotation ?? 0) + pl.rotation) % 360,
        layer: r.layer,
        offset: r.offset,
        ...base,
      });
    } else if (r.kind === "symbol" && r.symbolName) {
      const ins = pl.map({ x: r.insertionX!, y: r.insertionY! });
      expandSymbol(registry, r.symbolName, ins.x, ins.y, (r.rotation ?? 0) + pl.rotation, out, depth + 1, missing);
    }
  }
  return { primitives: out, missing };
}
