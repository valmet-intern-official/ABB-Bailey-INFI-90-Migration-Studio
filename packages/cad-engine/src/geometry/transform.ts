/**
 * Source-to-viewer coordinate transformation.
 *
 * Source space (CONFIRMED): integer grid, observed X 246..9955 / Y 226..9670,
 * with Y increasing upward. SVG needs Y increasing downward, so decoding and
 * presentation are kept strictly separate: we decode native coordinates first,
 * then transform. The viewer canvas size is a target, never an assumption
 * about the file.
 */

export interface SourceExtent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CoordinateTransform {
  extent: SourceExtent;
  scale: number;
  pageWidth: number;
  pageHeight: number;
  /** Source X -> viewer X. */
  tx(x: number): number;
  /** Source Y -> viewer Y, including the vertical flip. */
  ty(y: number): number;
  /** Scale a source-space length. */
  ts(v: number): number;
}

const DEFAULT_TARGET_WIDTH = 1600;
/** Margin in viewer units, leaving room for the frame and title strip. */
const MARGIN = 28;

export function createTransform(
  extent: SourceExtent,
  targetWidth = DEFAULT_TARGET_WIDTH
): CoordinateTransform {
  const srcW = Math.max(1, extent.maxX - extent.minX);
  const srcH = Math.max(1, extent.maxY - extent.minY);
  const scale = (targetWidth - MARGIN * 2) / srcW;

  const pageWidth = targetWidth;
  const pageHeight = Math.round(srcH * scale + MARGIN * 2 + 24);

  return {
    extent,
    scale,
    pageWidth,
    pageHeight,
    tx: (x) => round2((x - extent.minX) * scale + MARGIN),
    // Flip: source maxY maps to the top of the page.
    ty: (y) => round2((extent.maxY - y) * scale + MARGIN + 18),
    ts: (v) => round2(v * scale),
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function unionExtent(boxes: SourceExtent[]): SourceExtent {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1000, maxY: 750 };
  return { minX, minY, maxX, maxY };
}
