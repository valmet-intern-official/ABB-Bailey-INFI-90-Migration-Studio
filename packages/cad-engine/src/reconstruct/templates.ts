/**
 * Pin templates learned from source wire geometry.
 *
 * The function-block symbol library is not part of the supplied material, so
 * pin positions cannot be read from symbol definitions. They are, however,
 * fixed relative to each instance's insertion point, and every wired pin is
 * witnessed by a type 1 wire vertex that lands on it. Collecting those
 * witnesses over all instances of a symbol (same name, same size) yields the
 * set of pin offsets that the source itself proves exist.
 */
import type { RawCadRecord } from "../records/decode";

export interface TemplatePin {
  relX: number;
  relY: number;
  /** Instances in which a wire ends exactly here. */
  witnesses: number;
}

export interface PinTemplate {
  key: string;
  symbolName: string;
  width: number;
  height: number;
  instances: number;
  pins: TemplatePin[];
}

/** Symbols that are drawing furniture, never electrical terminals. */
export const FRAME_SYMBOLS = new Set(["DBORDH", "LINE", "TITLE", "REV", "BOX1", "BOX2"]);
export const JUNCTION_SYMBOL = "N90CNECT";

export const templateKey = (r: RawCadRecord) =>
  `${r.symbolName}|${r.x2 - r.x1}x${r.y2 - r.y1}`;

const inside = (r: RawCadRecord, x: number, y: number) =>
  x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2;

export function wireEndpoints(records: RawCadRecord[]): Array<{ x: number; y: number; rec: RawCadRecord; vertex: "first" | "last" }> {
  const out: Array<{ x: number; y: number; rec: RawCadRecord; vertex: "first" | "last" }> = [];
  for (const r of records) {
    if (r.kind !== "polyline" || r.points.length < 2) continue;
    const a = r.points[0];
    const b = r.points[r.points.length - 1];
    out.push({ x: a.x, y: a.y, rec: r, vertex: "first" }, { x: b.x, y: b.y, rec: r, vertex: "last" });
  }
  return out;
}

export function learnPinTemplates(sheets: RawCadRecord[][]): Map<string, PinTemplate> {
  const acc = new Map<string, { t: PinTemplate; seen: Map<string, Set<string>> }>();
  sheets.forEach((records, sheetIdx) => {
    const symbols = records.filter(
      (r) => r.kind === "symbol" && r.symbolName && !FRAME_SYMBOLS.has(r.symbolName) && r.symbolName !== JUNCTION_SYMBOL
    );
    const junctions = records.filter((r) => r.kind === "symbol" && r.symbolName === JUNCTION_SYMBOL);
    for (const s of symbols) {
      const key = templateKey(s);
      let e = acc.get(key);
      if (!e) {
        e = {
          t: { key, symbolName: s.symbolName!, width: s.x2 - s.x1, height: s.y2 - s.y1, instances: 0, pins: [] },
          seen: new Map(),
        };
        acc.set(key, e);
      }
      e.t.instances++;
    }
    for (const ep of wireEndpoints(records)) {
      // A vertex on a junction is not a pin, even when it sits inside a box.
      if (junctions.some((j) => Math.abs(j.insertionX! - ep.x) <= 3 && Math.abs(j.insertionY! - ep.y) <= 3)) continue;
      const hits = symbols.filter((s) => inside(s, ep.x, ep.y));
      if (hits.length !== 1) continue; // ambiguous containment is not evidence
      const s = hits[0];
      const e = acc.get(templateKey(s))!;
      const rel = `${ep.x - s.insertionX!},${ep.y - s.insertionY!}`;
      const set = e.seen.get(rel) ?? new Set<string>();
      set.add(`${sheetIdx}@${s.offset}`);
      e.seen.set(rel, set);
    }
  });
  const out = new Map<string, PinTemplate>();
  for (const [key, { t, seen }] of acc) {
    t.pins = [...seen]
      .map(([rel, set]) => {
        const [relX, relY] = rel.split(",").map(Number);
        return { relX, relY, witnesses: set.size };
      })
      .sort((a, b) => a.relX - b.relX || b.relY - a.relY);
    out.set(key, t);
  }
  return out;
}
