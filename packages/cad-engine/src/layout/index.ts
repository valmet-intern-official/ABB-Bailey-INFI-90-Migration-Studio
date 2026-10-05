export { LAYOUT_CONFIG, snap } from "./config";
export type { LayoutConfig } from "./config";
export { buildLogicGraph, routableEdges } from "./graph";
export type { LogicGraph, LogicNode, LogicEdge, LayoutRole } from "./graph";
export {
  A3_MM,
  A3_PX,
  a3PageSpec,
  chooseA3Orientation,
  fitSheetToA3,
  fitTransformToA3,
  measureSheetBounds,
} from "./page";
export type { A3PageSpec, ContentBounds, PageOrientation } from "./page";
export { layoutAndRoute, validateDiagramGeometry, scoreLayout } from "./pipeline";
export type { LayoutResult } from "./pipeline";
export { allSegmentsAreOrthogonal } from "./validate";
export type { GeometryValidation } from "./validate";
