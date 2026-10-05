/**
 * Typed engineering object model for source-faithful CAD reconstruction.
 *
 * Every object names the source record it came from (`source`). Relations
 * carry a status so downstream consumers can tell decoded facts from
 * derivations:
 *   EXPLICIT   — stated by a source record or exact source-coordinate incidence
 *   DERIVED    — computed deterministically from source records (e.g. a pin
 *                position learned from wire endpoints of the same symbol)
 *   INFERRED   — a convention applied to source data (e.g. inputs on the left)
 *   UNRESOLVED — the source does not determine it; kept, never guessed
 * Coordinates are always source units (the SCAD ~10000 grid, Y up).
 */

export type RelationStatus = "EXPLICIT" | "DERIVED" | "INFERRED" | "UNRESOLVED";

export interface SourceRef {
  file: string;
  /** Absolute byte offset of the record, or of the library body for LBR data. */
  offset: number;
  recordType: number;
  lengthBytes: number;
  /** Set when the evidence lives in a symbol library rather than the sheet. */
  library?: string;
}

export interface Pt {
  x: number;
  y: number;
}

export interface BBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type GlyphStatus = "LIBRARY" | "FALLBACK";

export interface FunctionBlock {
  id: string;
  source: SourceRef;
  recordType: number;
  symbolName: string;
  /** Numeric Bailey function code from the sheet's SPC trailer, when present. */
  functionCode: number | null;
  functionCodeStatus: RelationStatus;
  blockNumber: number | null;
  family: string;
  glyph: { status: GlyphStatus; family: string; library?: string; note?: string };
  sourceBBox: BBox;
  insertion: Pt;
  rotation: number;
  flags: number;
  layer: number;
  pinIds: string[];
  parameterIds: string[];
  attachedTextIds: string[];
  /** Type 7 terminal array entries, verbatim. */
  terminals?: Array<{ slot: number; reference?: string; tag?: string }>;
  /** Type 10 enum at +30 and other preserved-but-uninterpreted values. */
  reserved?: Array<{ at: number; value: number }>;
  rawHex: string;
}

export interface FunctionPin {
  id: string;
  blockId: string;
  /** Positional name, e.g. `L1` (first left-side pin from the top). */
  pinName: string;
  pinIndex: number;
  side: "left" | "right" | "top" | "bottom" | "interior";
  direction: "input" | "output" | "unknown";
  directionStatus: RelationStatus;
  sourceX: number;
  sourceY: number;
  /** Offset from the block insertion point; identical across instances of a symbol. */
  relX: number;
  relY: number;
  /** EXPLICIT when a wire on this sheet ends here; DERIVED when only the template has it. */
  status: RelationStatus;
  connected: boolean;
  connectionIds: string[];
  rawSourceFields: Array<{ wireOffset: number; vertex: "first" | "last" }>;
}

export interface Connector {
  id: string;
  kind: "IREF" | "OREF";
  source: SourceRef;
  symbolName: string;
  tag: string | null;
  tagRaw: string | null;
  reference: string | null;
  sourceBBox: BBox;
  insertion: Pt;
  /** Where wires attach, learned from source wire endpoints for this symbol. */
  connectionPoint: Pt | null;
  connectionPointStatus: RelationStatus;
  connectionIds: string[];
  zone: string | null;
  resolution: ReferenceResolution;
  rawHex: string;
}

export type ResolutionStatus =
  | "RESOLVED_INTERNAL"
  | "RESOLVED_CROSS_SHEET"
  | "RESOLVED_EXTERNAL"
  | "BOUNDARY_SIGNAL"
  | "AMBIGUOUS"
  | "UNRESOLVED";

export interface ReferenceResolution {
  status: ResolutionStatus;
  relation: RelationStatus;
  targetSheet: string | null;
  targetZone: string | null;
  targetConnectorId: string | null;
  candidates: string[];
  evidence: string[];
}

export type EndpointKind = "pin" | "connector" | "junction" | "wire" | "block-body" | "dangling";

export interface Endpoint {
  kind: EndpointKind;
  at: Pt;
  refId: string | null;
  status: RelationStatus;
  /** Distance from the endpoint to the matched feature, source units. */
  distance: number;
}

export interface Connection {
  id: string;
  source: SourceRef;
  /** Vertex list verbatim from the type 1 record. */
  points: Pt[];
  style: number;
  lineType: "solid" | "dashed" | "long-dash" | "unknown";
  layer: number;
  from: Endpoint;
  to: Endpoint;
  netId: string | null;
  relationStatus: RelationStatus;
  connectionType: "signal" | "rule";
}

export type JunctionKind =
  | "connected"
  | "branch"
  | "wire-join"
  | "crossing-no-connection"
  | "reference-endpoint"
  | "off-sheet-connector";

export interface Junction {
  id: string;
  kind: JunctionKind;
  at: Pt;
  status: RelationStatus;
  source: SourceRef | null;
  connectionIds: string[];
  note?: string;
}

export interface Arc {
  id: string;
  source: SourceRef;
  center: Pt;
  start: Pt;
  end: Pt;
  layer: number;
}

export interface TextAnnotation {
  id: string;
  source: SourceRef;
  text: string;
  bbox: BBox;
  height: number;
  heightFlag: boolean;
  rotation: number;
  layer: number;
  role: "title-block" | "xref-annotation" | "engineering" | "note";
  attachedTo: string | null;
}

export interface Parameter {
  id: string;
  blockId: string;
  blockNumber: number;
  name: string;
  /** Spec meaning as printed by the module verifier (`*.VFY`), when available. */
  description?: string;
  /** Rendered value; ambiguous slots show both readings with a trailing `?`. */
  value: string;
  status: RelationStatus;
  raw: { offset: number; words: number[]; float: number; likely: string };
}

export interface CrossSheetReference {
  id: string;
  connectorId: string;
  direction: "IREF" | "OREF";
  tag: string | null;
  reference: string | null;
  targetSheet: string | null;
  status: ResolutionStatus;
  relation: RelationStatus;
  xrefOutConfirmed: boolean;
  /** Zone I90XREF.OUT gives for this connector, and whether the decoded zone agrees. */
  outSourceZone: string | null;
  outSourceZoneAgrees: boolean | null;
  errListed: boolean;
}

export interface TitleBlock {
  present: boolean;
  bbox: BBox | null;
  fields: Array<{ label: string; value: string; textId: string; status: RelationStatus; at: Pt; labelAt: Pt }>;
  unassigned: string[];
}

export interface DrawingFrame {
  present: boolean;
  symbolName: string | null;
  source: SourceRef | null;
  bbox: BBox | null;
  insertion: Pt | null;
  library: string | null;
  libraryResolved: boolean;
  primitiveCount: number;
  /** Other drawing-furniture symbols placed on the sheet (e.g. `LINE` column rules). */
  components: Array<{ symbolName: string; source: SourceRef; insertion: Pt; bbox: BBox; rotation: number; libraryResolved: boolean }>;
}

export interface GridMark {
  axis: "column" | "row";
  label: string;
  at: Pt;
  source: SourceRef;
}

export interface UnknownRecord {
  source: SourceRef;
  kind: string;
  fields: string[];
  reserved: Array<{ at: number; value: number }>;
  residualHex?: string;
}

export interface Net {
  id: string;
  connectionIds: string[];
  pinIds: string[];
  connectorIds: string[];
  junctionIds: string[];
  drivers: string[];
  sinks: string[];
}

export interface DrawingSheet {
  id: string;
  file: string;
  sha256: string;
  byteSize: number;
  library: string | null;
  recordCount: number;
  clean: boolean;
  frame: DrawingFrame;
  titleBlock: TitleBlock;
  gridMarks: GridMark[];
  functionBlocks: FunctionBlock[];
  pins: FunctionPin[];
  connectors: Connector[];
  connections: Connection[];
  junctions: Junction[];
  arcs: Arc[];
  texts: TextAnnotation[];
  parameters: Parameter[];
  crossSheetReferences: CrossSheetReference[];
  unknownRecords: UnknownRecord[];
  nets: Net[];
  diagnostics: string[];
}
