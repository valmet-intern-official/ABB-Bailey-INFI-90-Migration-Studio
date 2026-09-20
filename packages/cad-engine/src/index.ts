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
