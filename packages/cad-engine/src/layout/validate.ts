import type { EngineeringSheetModel } from "@infi90/core";

export interface GeometryValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  metrics: {
    nodeOverlaps: number;
    diagonalSegments: number;
    wireThroughNodes: number;
    outOfBounds: number;
    missingEndpoints: number;
    connectionCount: number;
    blockCount: number;
  };
}

function segOrthogonal(x1: number, y1: number, x2: number, y2: number): boolean {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  // Allow tiny float noise.
  return dx < 0.51 || dy < 0.51;
}

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  gap = 1
): boolean {
  return (
    a.x < b.x + b.w + gap &&
    a.x + a.w + gap > b.x &&
    a.y < b.y + b.h + gap &&
    a.y + a.h + gap > b.y
  );
}

function segmentHitsRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r: { x: number; y: number; w: number; h: number },
  pad = 6
): boolean {
  // Expand inward so near-misses / port stubs on the face don't count.
  const rx1 = r.x + pad;
  const ry1 = r.y + pad;
  const rx2 = r.x + r.w - pad;
  const ry2 = r.y + r.h - pad;
  if (rx2 <= rx1 || ry2 <= ry1) return false;

  const minOverlap = Math.max(12, Math.min(r.w, r.h) * 0.25);

  // Horizontal segment
  if (Math.abs(y1 - y2) < 0.51) {
    const y = y1;
    if (y <= ry1 || y >= ry2) return false;
    const lo = Math.min(x1, x2);
    const hi = Math.max(x1, x2);
    if (hi < rx1 || lo > rx2) return false;
    return Math.min(hi, rx2) - Math.max(lo, rx1) > minOverlap;
  }
  // Vertical segment
  if (Math.abs(x1 - x2) < 0.51) {
    const x = x1;
    if (x <= rx1 || x >= rx2) return false;
    const lo = Math.min(y1, y2);
    const hi = Math.max(y1, y2);
    if (hi < ry1 || lo > ry2) return false;
    return Math.min(hi, ry2) - Math.max(lo, ry1) > minOverlap;
  }
  return true; // diagonal treated as invalid elsewhere
}

/**
 * Validate laid-out diagram geometry before export.
 */
export function validateDiagramGeometry(model: EngineeringSheetModel): GeometryValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  let nodeOverlaps = 0;
  let diagonalSegments = 0;
  let wireThroughNodes = 0;
  let outOfBounds = 0;
  let missingEndpoints = 0;

  const blocks = model.blocks.filter((b) => b.type !== "Junction");
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i];
      const b = blocks[j];
      if (
        rectsOverlap(
          { x: a.x, y: a.y, w: a.width, h: a.height },
          { x: b.x, y: b.y, w: b.width, h: b.height },
          2
        )
      ) {
        nodeOverlaps++;
        errors.push(`Node overlap: ${a.id} vs ${b.id}`);
      }
    }
  }

  const pageW = model.page.width;
  const pageH = model.page.height;

  for (const b of model.blocks) {
    if (b.x < 0 || b.y < 0 || b.x + b.width > pageW + 2 || b.y + b.height > pageH + 2) {
      outOfBounds++;
      warnings.push(`Block out of page: ${b.id}`);
    }
  }

  for (const conn of model.connections) {
    if (conn.sourceBlockId || conn.targetBlockId) {
      // Logic wires should have endpoints when they did in the source.
      if (conn.trace.validationStatus === "verified" && !conn.sourceBlockId && !conn.targetBlockId) {
        missingEndpoints++;
      }
    }
    for (const seg of conn.geometry) {
      if (!segOrthogonal(seg.x1, seg.y1, seg.x2, seg.y2)) {
        diagonalSegments++;
        errors.push(`Diagonal segment on ${conn.id}`);
      }
      for (const b of blocks) {
        // Skip source/target blocks for through-check.
        if (b.id === conn.sourceBlockId || b.id === conn.targetBlockId) continue;
        if (
          segmentHitsRect(seg.x1, seg.y1, seg.x2, seg.y2, {
            x: b.x,
            y: b.y,
            w: b.width,
            h: b.height,
          })
        ) {
          wireThroughNodes++;
          errors.push(`Wire ${conn.id} passes through ${b.id}`);
        }
      }
    }
  }

  const ok = nodeOverlaps === 0 && diagonalSegments === 0 && wireThroughNodes === 0;

  return {
    ok,
    errors: errors.slice(0, 200),
    warnings: warnings.slice(0, 100),
    metrics: {
      nodeOverlaps,
      diagonalSegments,
      wireThroughNodes,
      outOfBounds,
      missingEndpoints,
      connectionCount: model.connections.length,
      blockCount: model.blocks.length,
    },
  };
}

export function allSegmentsAreOrthogonal(model: EngineeringSheetModel): boolean {
  return model.connections.every((c) =>
    c.geometry.every((s) => segOrthogonal(s.x1, s.y1, s.x2, s.y2))
  );
}
