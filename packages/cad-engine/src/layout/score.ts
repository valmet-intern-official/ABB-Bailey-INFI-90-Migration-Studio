import type { EngineeringSheetModel } from "@infi90/core";
import { validateDiagramGeometry } from "./validate";

/**
 * Internal geometry quality score (lower is better). Not shown to end users.
 */
export function scoreLayout(model: EngineeringSheetModel): number {
  const v = validateDiagramGeometry(model);
  let wireLength = 0;
  let bends = 0;
  for (const c of model.connections) {
    for (const s of c.geometry) {
      wireLength += Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1);
    }
    bends += Math.max(0, c.geometry.length - 1);
  }

  return (
    v.metrics.nodeOverlaps * 10_000 +
    v.metrics.diagonalSegments * 5_000 +
    v.metrics.wireThroughNodes * 8_000 +
    v.metrics.outOfBounds * 500 +
    bends * 2 +
    wireLength * 0.01
  );
}
