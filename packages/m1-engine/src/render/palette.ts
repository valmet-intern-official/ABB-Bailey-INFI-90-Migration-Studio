export type RGB = [number, number, number];

export type PaletteSource = "CALIBRATED" | "ASSUMED" | "UNKNOWN";

export interface PaletteEntry {
  index: number;
  rgb: RGB;
  source: PaletteSource;
  evidence?: string;
}

export interface Palette {
  name: string;
  description: string;
  entries: Record<number, PaletteEntry>;
}

/** ANSI 16-colour order. ASSUMED: the M1 files carry indices only, never RGB. */
const ANSI16: RGB[] = [
  [0, 0, 0], [205, 0, 0], [0, 205, 0], [205, 205, 0], [0, 0, 238], [205, 0, 205], [0, 205, 205], [229, 229, 229],
  [127, 127, 127], [255, 0, 0], [0, 255, 0], [255, 255, 0], [92, 92, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
];

/** Deterministic, visibly-synthetic colour for an index without evidence. */
function unknownColor(i: number): RGB {
  let h = (i * 2654435761) >>> 0;
  const hue = h % 360;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  const l = 0.45 + ((h % 20) / 100);
  const s = 0.35;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

export function fallbackPalette(): Palette {
  return {
    name: "fallback",
    description:
      "No RGB palette exists in the M1 files. Indices 0–15 use the ANSI order (ASSUMED); all other indices use a deterministic synthetic colour (UNKNOWN).",
    entries: {},
  };
}

export function resolveColor(p: Palette, index: number | null | undefined): PaletteEntry | null {
  if (index === null || index === undefined) return null;
  const e = p.entries[index];
  if (e) return e;
  if (index >= 0 && index < 16) return { index, rgb: ANSI16[index], source: "ASSUMED", evidence: "ANSI 16-colour order" };
  return { index, rgb: unknownColor(index), source: "UNKNOWN" };
}

export function hexOf([r, g, b]: RGB): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
