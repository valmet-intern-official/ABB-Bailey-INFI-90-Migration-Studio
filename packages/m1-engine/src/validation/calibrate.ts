import type { Layout } from "../render/layout";
import type { Palette, PaletteEntry, RGB } from "../render/palette";
import type { RefMapping } from "./align";
import { buildOwnership } from "./ownership";
import type { RasterImage } from "./reference-pdf";

export interface ColorSample {
  file: string;
  index: number;
  objectId: number;
  part: "fill" | "stroke" | "text";
  fillStyle: number | null;
  pixels: number;
  rgb: RGB;
  share: number;
}

export interface CalibrationResult {
  palette: Palette;
  samples: Record<number, ColorSample[]>;
  rejected: Record<number, { reason: string; samples: number }>;
}

const key = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b;
const unkey = (k: number): RGB => [(k >> 16) & 255, (k >> 8) & 255, k & 255];

/**
 * Sample the pixels each path visibly owns in the aligned reference and take
 * the dominant exact colour. The reference screenshots come from a palettised
 * display, so a palette index should map to one exact RGB.
 */
export function sampleColors(file: string, layout: Layout, mapping: RefMapping, ref: RasterImage): ColorSample[] {
  const own = buildOwnership(layout, mapping, ref.width, ref.height);
  const W = ref.width, H = ref.height;
  const erodeOk = (i: number, id: number, part: "fill" | "stroke") => {
    if (part === "stroke") return true;
    const x = i % W, y = (i - x) / W;
    for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
      const X = x + dx, Y = y + dy;
      if (X < 0 || Y < 0 || X >= W || Y >= H || own.owner[Y * W + X] !== id) return false;
    }
    return true;
  };
  const hist = new Map<number, Map<number, number>>();
  for (let i = 0; i < own.owner.length; i++) {
    const id = own.owner[i];
    if (id < 0 || !erodeOk(i, id, own.layers[id].part)) continue;
    const h = hist.get(id) ?? new Map<number, number>();
    const c = key(ref.rgb[i * 3], ref.rgb[i * 3 + 1], ref.rgb[i * 3 + 2]);
    h.set(c, (h.get(c) ?? 0) + 1);
    hist.set(id, h);
  }
  const out: ColorSample[] = [];
  const k = mapping.s / layout.scale;
  for (const [id, h] of hist) {
    const layer = own.layers[id];
    // 1-px strokes land on neighbouring pixels under sub-pixel registration error.
    if (layer.part === "stroke" && layer.op.strokeWidth * k < 2.5) continue;
    let total = 0;
    for (const v of h.values()) total += v;
    const ranked = [...h.entries()].sort((a, b) => b[1] - a[1]);
    let pick = ranked[0];
    // A 50 % dither over black shows the fill colour and black in equal parts.
    if (layer.part === "fill" && layer.op.fillStyle === 2 && ranked.length > 1 && pick[0] === 0) pick = ranked[1];
    out.push({
      file,
      index: (layer.part === "fill" ? layer.op.fillIndex : layer.op.strokeIndex) ?? -1,
      objectId: layer.op.objectId,
      part: layer.part,
      fillStyle: layer.op.fillStyle,
      pixels: total,
      rgb: unkey(pick[0]),
      share: pick[1] / total,
    });
  }

  // Text: inside the label box the most common colour is the backdrop; the
  // dominant remaining colour is the glyph colour.
  for (const op of layout.ops) {
    if (op.op !== "text" || op.colorIndex === null || op.text.trim().length < 3) continue;
    const w = op.text.length * op.size * 0.5 * op.scaleX * k;
    const hgt = op.size * 0.7 * k;
    const ax = mapping.x0 + op.at[0] * k;
    const ay = mapping.y0 + op.at[1] * k;
    const x0 = Math.round(op.anchor === "middle" ? ax - w / 2 : op.anchor === "end" ? ax - w : ax);
    const yTop = Math.round(op.baseline === "middle" ? ay - hgt / 2 : op.baseline === "top" ? ay : ay - hgt);
    const h = new Map<number, number>();
    let total = 0;
    for (let y = yTop; y < yTop + hgt; y++)
      for (let x = x0; x < x0 + w; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x;
        const c = key(ref.rgb[i * 3], ref.rgb[i * 3 + 1], ref.rgb[i * 3 + 2]);
        h.set(c, (h.get(c) ?? 0) + 1);
        total++;
      }
    const ranked = [...h.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked.length < 2 || total < 40) continue;
    const glyph = ranked[1];
    out.push({
      file,
      index: op.colorIndex,
      objectId: op.objectId,
      part: "text",
      fillStyle: null,
      pixels: glyph[1],
      rgb: unkey(glyph[0]),
      share: glyph[1] / (total - ranked[0][1]),
    });
  }
  return out;
}

export function calibratePalette(all: ColorSample[]): CalibrationResult {
  const byIndex = new Map<number, ColorSample[]>();
  for (const s of all) {
    if (s.index < 0) continue;
    const minPixels = s.part === "fill" ? 30 : 12;
    const minShare = s.part === "fill" ? (s.fillStyle === 2 ? 0.3 : 0.6) : s.part === "text" ? 0.4 : 0.5;
    if (s.pixels < minPixels || s.share < minShare) continue;
    const l = byIndex.get(s.index) ?? [];
    l.push(s);
    byIndex.set(s.index, l);
  }
  const entries: Record<number, PaletteEntry> = {};
  const samples: CalibrationResult["samples"] = {};
  const rejected: CalibrationResult["rejected"] = {};
  for (const [index, list] of [...byIndex].sort((a, b) => a[0] - b[0])) {
    const votes = new Map<number, number>();
    for (const s of list) {
      const w = s.pixels * s.share * (s.part === "fill" ? 1 : s.part === "text" ? 2 : 0.5);
      votes.set(key(...s.rgb), (votes.get(key(...s.rgb)) ?? 0) + w);
    }
    const total = [...votes.values()].reduce((a, b) => a + b, 0);
    const [winner, w] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    const agreement = w / total;
    const objects = list.filter((s) => key(...s.rgb) === winner).length;
    samples[index] = list;
    if (agreement < 0.5) {
      rejected[index] = { reason: `no dominant colour (top agreement ${(agreement * 100).toFixed(0)} %)`, samples: list.length };
      continue;
    }
    entries[index] = {
      index,
      rgb: unkey(winner),
      source: "CALIBRATED",
      evidence: `${objects}/${list.length} objects agree, weighted agreement ${(agreement * 100).toFixed(0)} % (${[...new Set(list.map((s) => s.file))].join(", ")})`,
    };
  }
  return {
    palette: {
      name: "calibrated-from-reference",
      description:
        "Palette indices calibrated by sampling visibly-owned pixels of solid shapes in the aligned reference screenshots. CANDIDATE: derived from the validation oracle, never from M1 bytes. Indices without evidence fall back to the default palette.",
      entries,
    },
    samples,
    rejected,
  };
}
