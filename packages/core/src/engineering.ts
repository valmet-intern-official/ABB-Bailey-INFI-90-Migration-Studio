/**
 * Engineering Logic Model — structured CAD reconstruction graph.
 * Source of truth for interactive viewer, SVG, and PDF outputs.
 */

export type ExtractionMethod =
  | "CAD_NATIVE"
  | "STRING_SCRAPE"
  | "GEOMETRY"
  | "HEURISTIC"
  | "AI_ASSISTED";

export type ValidationStatus =
  | "verified"
  | "inferred"
  | "review_required"
  | "unresolved";

export type CadElementType =
  | "LogicBlock"
  | "InputPin"
  | "OutputPin"
  | "Wire"
  | "Junction"
  | "Text"
  | "Tag"
  | "CrossReference"
  | "FunctionCode"
  | "TimingBlock"
  | "SequenceBlock"
  | "IOMarker"
  | "SheetReference"
  | "Border"
  | "TitleBlock"
  | "Annotation";

export interface Traceability {
  sourceFilename: string;
  sourceMethod: ExtractionMethod;
  sourceText?: string;
  sourceIndex?: number;
  confidence: number;
  validationStatus: ValidationStatus;
}

export interface CadPort {
  id: string;
  blockId: string;
  name: string;
  /** S1…S15 style engineering ports */
  specIndex?: number;
  direction: "in" | "out" | "bidirectional" | "param";
  signalName?: string;
  x?: number;
  y?: number;
  trace: Traceability;
}

export interface CadLogicBlock {
  id: string;
  type: CadElementType;
  functionCode?: string;
  /** Numeric FC when known, e.g. 37 */
  functionCodeNumber?: number;
  label?: string;
  blockNumber?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  parameters: Record<string, string>;
  ports: CadPort[];
  inputRefs: string[];
  outputRefs: string[];
  deviceTags: string[];
  notes?: string;
  trace: Traceability;
}

export interface CadConnection {
  id: string;
  sourceBlockId?: string;
  sourcePortId?: string;
  targetBlockId?: string;
  targetPortId?: string;
  signalName?: string;
  geometry: { x1: number; y1: number; x2: number; y2: number }[];
  crossSheetReference?: string;
  referenceType: "local" | "cross_sheet" | "cross_cad" | "external_io" | "unresolved";
  resolved: boolean;
  trace: Traceability;
}

export interface CadCrossReference {
  id: string;
  sourceElementId?: string;
  targetIdentifier: string;
  targetFile?: string;
  targetSheet?: string;
  /** Raw fixed-format source address, e.g. `BAZ2-08.07`. */
  address?: string;
  signal?: string;
  referenceType: "local" | "cross_sheet" | "cross_cad" | "external_io" | "unresolved";
  resolved: boolean;
  x?: number;
  y?: number;
  trace: Traceability;
}

export interface CadTagNode {
  id: string;
  raw: string;
  normalized: string;
  description?: string;
  connectedBlockIds: string[];
  ioType?: string;
  x?: number;
  y?: number;
  trace: Traceability;
}

export interface CadAnnotation {
  id: string;
  text: string;
  kind: "title" | "description" | "label" | "metadata" | "other";
  x: number;
  y: number;
  /** Glyph height in viewer units when recovered from the source. */
  height?: number;
  trace: Traceability;
}

export interface EngineeringSheetModel {
  version: "1.0";
  filename: string;
  sheetId?: string;
  title?: string;
  provenance?: {
    loop?: string;
    cpu?: string;
    module?: string;
  };
  page: {
    width: number;
    height: number;
  };
  blocks: CadLogicBlock[];
  connections: CadConnection[];
  crossReferences: CadCrossReference[];
  tags: CadTagNode[];
  annotations: CadAnnotation[];
  layers: {
    id: string;
    name: string;
    visible: boolean;
  }[];
  stats: {
    blockCount: number;
    connectionCount: number;
    tagCount: number;
    crossRefCount: number;
    unresolvedConnections: number;
  };
  validation: {
    status: "READY" | "COMPLETED" | "COMPLETED_WITH_WARNINGS" | "NEEDS_REVIEW";
    warnings: string[];
  };
}
