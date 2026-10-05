/**
 * ISO A3 sheet sizing for CAD pages.
 * Dimensions at 96 CSS px/inch (screen / SVG default).
 *
 * A3 = 297 mm × 420 mm
 *   landscape → 420 × 297 mm → 1587 × 1123 px
 *   portrait  → 297 × 420 mm → 1123 × 1587 px
 */

import type { EngineeringSheetModel } from "@infi90/core";

export type PageOrientation = "landscape" | "portrait";

export const A3_MM = { short: 297, long: 420 } as const;

/** 96 dpi: mm → px */
const PX_PER_MM = 96 / 25.4;

export const A3_PX = {
  short: Math.round(A3_MM.short * PX_PER_MM), // 1123
  long: Math.round(A3_MM.long * PX_PER_MM), // 1587
} as const;

export interface A3PageSpec {
  orientation: PageOrientation;
  width: number;
  height: number;
  /** Drawable area inside margins. */
  drawWidth: number;
  drawHeight: number;
  margin: number;
}

export function a3PageSpec(
  orientation: PageOrientation,
  margin = 48
): A3PageSpec {
  const width = orientation === "landscape" ? A3_PX.long : A3_PX.short;
  const height = orientation === "landscape" ? A3_PX.short : A3_PX.long;
  return {
    orientation,
    width,
    height,
    drawWidth: width - margin * 2,
    drawHeight: height - margin * 2,
    margin,
  };
}

/**
 * Pick landscape vs portrait by which orientation fits the content with
 * the larger uniform scale (less shrink / better page use).
 */
export function chooseA3Orientation(
  contentWidth: number,
  contentHeight: number,
  margin = 48
): PageOrientation {
  const cw = Math.max(1, contentWidth);
  const ch = Math.max(1, contentHeight);
  const land = a3PageSpec("landscape", margin);
  const port = a3PageSpec("portrait", margin);
  const scaleL = Math.min(land.drawWidth / cw, land.drawHeight / ch);
  const scaleP = Math.min(port.drawWidth / cw, port.drawHeight / ch);
  return scaleL >= scaleP ? "landscape" : "portrait";
}

export interface ContentBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function contentBoundsSize(b: ContentBounds): { w: number; h: number } {
  return {
    w: Math.max(1, b.maxX - b.minX),
    h: Math.max(1, b.maxY - b.minY),
  };
}

/**
 * Map content bounds into an A3 sheet: choose orientation, uniform scale,
 * and center translation.
 */
export function fitTransformToA3(
  bounds: ContentBounds,
  margin = 48
): {
  page: A3PageSpec;
  scale: number;
  offsetX: number;
  offsetY: number;
} {
  const { w, h } = contentBoundsSize(bounds);
  const orientation = chooseA3Orientation(w, h, margin);
  const page = a3PageSpec(orientation, margin);
  const scale = Math.min(page.drawWidth / w, page.drawHeight / h);
  const scaledW = w * scale;
  const scaledH = h * scale;
  const offsetX = page.margin + (page.drawWidth - scaledW) / 2 - bounds.minX * scale;
  const offsetY = page.margin + (page.drawHeight - scaledH) / 2 - bounds.minY * scale;
  return { page, scale, offsetX, offsetY };
}

export function mapPoint(
  x: number,
  y: number,
  scale: number,
  offsetX: number,
  offsetY: number
): { x: number; y: number } {
  return {
    x: Math.round((x * scale + offsetX) * 10) / 10,
    y: Math.round((y * scale + offsetY) * 10) / 10,
  };
}

/** Collect axis-aligned bounds of every drawable element on the sheet. */
export function measureSheetBounds(model: EngineeringSheetModel): ContentBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const include = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const b of model.blocks) {
    include(b.x, b.y);
    include(b.x + b.width, b.y + b.height);
    for (const p of b.ports) {
      if (p.x != null && p.y != null) include(p.x, p.y);
    }
  }
  for (const c of model.connections) {
    for (const s of c.geometry) {
      include(s.x1, s.y1);
      include(s.x2, s.y2);
    }
  }
  for (const a of model.annotations) include(a.x, a.y);
  for (const t of model.tags) {
    if (t.x != null && t.y != null) include(t.x, t.y);
  }
  for (const x of model.crossReferences) {
    if (x.x != null && x.y != null) include(x.x, x.y);
  }

  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Uniformly scale + center sheet content onto an ISO A3 page.
 * Orientation is chosen from content aspect so the diagram fills best.
 * Idempotent when already paperSize=A3 (returns model unchanged).
 */
export function fitSheetToA3(
  model: EngineeringSheetModel,
  margin = 48
): EngineeringSheetModel {
  if (model.page.paperSize === "A3" && model.page.orientation) {
    return model;
  }

  const bounds = measureSheetBounds(model);
  const { page, scale, offsetX, offsetY } = fitTransformToA3(bounds, margin);
  const pt = (x: number, y: number) => mapPoint(x, y, scale, offsetX, offsetY);
  const sz = (v: number) => Math.max(0.5, Math.round(v * scale * 10) / 10);

  const blocks = model.blocks.map((b) => {
    const origin = pt(b.x, b.y);
    return {
      ...b,
      x: origin.x,
      y: origin.y,
      width: sz(b.width),
      height: sz(b.height),
      ports: b.ports.map((p) => {
        const next = { ...p };
        if (p.x != null && p.y != null) {
          const m = pt(p.x, p.y);
          next.x = m.x;
          next.y = m.y;
        }
        if (p.offset != null) next.offset = sz(p.offset);
        return next;
      }),
    };
  });

  const connections = model.connections.map((c) => ({
    ...c,
    geometry: c.geometry.map((s) => {
      const a = pt(s.x1, s.y1);
      const b = pt(s.x2, s.y2);
      return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    }),
  }));

  const annotations = model.annotations.map((a) => {
    const m = pt(a.x, a.y);
    return { ...a, x: m.x, y: m.y };
  });

  const tags = model.tags.map((t) => {
    if (t.x == null || t.y == null) return t;
    const m = pt(t.x, t.y);
    return { ...t, x: m.x, y: m.y };
  });

  const crossReferences = model.crossReferences.map((x) => {
    if (x.x == null || x.y == null) return x;
    const m = pt(x.x, x.y);
    return { ...x, x: m.x, y: m.y };
  });

  return {
    ...model,
    page: {
      width: page.width,
      height: page.height,
      paperSize: "A3",
      orientation: page.orientation,
    },
    blocks,
    connections,
    annotations,
    tags,
    crossReferences,
  };
}
