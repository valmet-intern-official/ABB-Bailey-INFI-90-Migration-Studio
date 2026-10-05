export {
  KNOWN_FUNCTION_CODES,
  buildEngineeringModel,
  engineeringModelToDrawEntities,
} from "./model";
export { renderEngineeringSvg } from "./svg";

// Native SCAD 5.3 binary decoder — see docs/cad-reverse-engineering.md
export { CAD_HEADER_SIZE, cadFileBounds, readLibraryName } from "./binary/reader";
export { decodeRecordStream } from "./records/decode";
export type { CadRecordKind, DecodedRecordStream, RawCadRecord } from "./records/decode";
export { decodeTrailer, specificationsByBlock } from "./records/trailer";
export type {
  BlockSpecification,
  DecodedTrailer,
  SpecCandidate,
} from "./records/trailer";
export { classifySymbol, functionCodeNumber } from "./semantic/classify";
export type { SymbolRole } from "./semantic/classify";
export {
  isSelfReference,
  parseReference,
  parseSheetName,
  resolveReferenceTarget,
} from "./semantic/reference";
export type { ParsedReference } from "./semantic/reference";
export { ModuleRegistry } from "./semantic/modules";
export type { ModuleCandidate, ModuleResolution } from "./semantic/modules";
export { createTransform, unionExtent } from "./geometry/transform";
export type { CoordinateTransform, SourceExtent } from "./geometry/transform";
export { decodeCadSheet, isDecodableCad } from "./reconstruction/sheet";
export type { DecodeOptions } from "./reconstruction/sheet";
export { correlateSheets } from "./reconstruction/correlate";
export type { CorrelationReport } from "./reconstruction/correlate";

// Symbol libraries — authentic symbol geometry
export { parseLbrLibrary, readLbrDirectory, SymbolRegistry } from "./lbr/library";
export type { LbrLibrary, LbrSegment, LbrSymbol } from "./lbr/library";
export { decodeRecordRange } from "./records/decode";

// Source-faithful reconstruction: typed engineering model, pin-level
// topology, cross-sheet resolution, and source-coordinate SVG/PDF rendering.
export { buildDrawingSheet, zoneOf, EXACT_TOL, NEAR_TOL } from "./reconstruct/build";
export type { BuildContext, ZoneGrid } from "./reconstruct/build";
export { learnPinTemplates } from "./reconstruct/templates";
export type { PinTemplate } from "./reconstruct/templates";
export { calibrateZoneGrid, applyZoneGrid, resolveReferences } from "./reconstruct/resolve";
export { expandSymbol } from "./reconstruct/libexpand";
export { renderSheet, toSvg, pageTransform, PAGE_W, PAGE_H, PLOT_SCALE } from "./reconstruct/render";
export type { Item as RenderItem, PageTransform } from "./reconstruct/render";
export { writePdf, COURIER_ADVANCE } from "./reconstruct/pdf";
export type { PdfLayer, PdfLink, PdfOptions, PdfPage } from "./reconstruct/pdf";
export * as supportFiles from "./reconstruct/support";
export type * as ReconstructModel from "./reconstruct/types";
export {
  reconstructModule,
  findSymbolLibraries,
} from "./reconstruct/pipeline";
export type {
  CadBuffer,
  ReconstructModuleOptions,
  ReconstructModuleResult,
  ReconstructedSheet,
} from "./reconstruct/pipeline";
export { drawingSheetToEngineeringModel } from "./reconstruct/toEngineering";

// CAD_RENDER_ENGINE — source = faithful reconstruct (default); v2 = layout; v1 = paint
export {
  LAYOUT_CONFIG,
  layoutAndRoute,
  validateDiagramGeometry,
  scoreLayout,
  buildLogicGraph,
  allSegmentsAreOrthogonal,
  fitSheetToA3,
  chooseA3Orientation,
  A3_PX,
} from "./layout";
export type {
  LayoutResult,
  GeometryValidation,
  LayoutConfig,
  PageOrientation,
} from "./layout";

/** Resolve render engine from env (default source — golden-master reconstruct). */
export function getCadRenderEngine(
  override?: string | null
): "source" | "v1" | "v2" {
  const v = (override ?? process.env.CAD_RENDER_ENGINE ?? "source").trim().toLowerCase();
  if (v === "v1") return "v1";
  if (v === "v2") return "v2";
  return "source";
}