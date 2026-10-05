export type IoType = "AI" | "AO" | "DI" | "DO";

export type FileKind =
  | "CAD"
  | "M1"
  | "OUT"
  | "REF"
  | "XRF"
  | "ERR"
  | "CFG"
  | "VFY"
  | "LST"
  | "LOG"
  | "MHD"
  | "MDC"
  | "BND"
  | "GES"
  | "BAT"
  | "OTHER";

export interface Provenance {
  loop?: string;
  cpu?: string;
  module?: string;
  sourcePath: string;
  filename: string;
  fileType: FileKind;
}

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  sourceZipName: string;
  loop?: string;
  cpu?: string;
  module?: string;
  status: "pending" | "processing" | "ready" | "error";
  errorMessage?: string;
}

export interface InventoryFile {
  relativePath: string;
  filename: string;
  extension: string;
  kind: FileKind;
  size: number;
}

export interface ParsedIoTag {
  raw: string;
  ioType?: IoType;
  channel?: string;
  slave?: string;
  deviceTag?: string;
}

export interface CrossSheetEndpoint {
  point: string;
  cadSheet?: string;
}

export interface OutIoEntry {
  direction: "input" | "output";
  cadFile: string;
  cadRelativeHint?: string;
  description: string;
  parsed: ParsedIoTag;
  source?: CrossSheetEndpoint;
  destinations: CrossSheetEndpoint[];
}

export interface OutParseResult {
  entries: OutIoEntry[];
  cadSections: string[];
}

export interface RefTag {
  raw: string;
  parsed: ParsedIoTag;
}

export interface XrfParseResult {
  cadSheetsToProcess?: number;
  cadSheetsSeen: string[];
  blankDescriptions: string[];
  rawWarnings: string[];
}

export interface ErrRecord {
  raw: string;
  cadFile?: string;
  point?: string;
}

export interface CadTextItem {
  text: string;
  kind: "io" | "description" | "label" | "block" | "spec" | "other";
}

export interface CadOref {
  raw: string;
  tag?: string;
  point?: string;
  targetCad?: string;
}

export interface CadFunctionBlock {
  blockId?: string;
  functionCode?: string;
  /** Numeric Bailey function code, decoded from the SPC LIST trailer. */
  functionCodeNumber?: number;
  /** Bailey block address from the source, when available. */
  blockNumber?: string;
  s0?: string;
  s0_5?: string;
  s1?: string;
  s2?: string;
  s3?: string;
  s4?: string;
  s5?: string;
  s6?: string;
  s7?: string;
  s8?: string;
  s9?: string;
  logicFormula?: string;
  inputRefs: string[];
  outputRefs: string[];
  deviceTag?: string;
  notes?: string;
}

export interface CadDrawEntity {
  type: "text" | "box" | "line" | "symbol" | "oref";
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  x2?: number;
  y2?: number;
  text?: string;
  label?: string;
}

export interface CadSheetParse {
  filename: string;
  sheetId?: string;
  title?: string;
  date?: string;
  descriptions: string[];
  /** Title-block DESCRIPTION box: first line names the plant area, the lines below describe the page. */
  areaDescription?: string;
  pageDescription?: string;
  /** Why the title block could not be read, when it could not. */
  titleBlockNote?: string;
  loopTags: string[];
  deviceTags: string[];
  ioRefs: ParsedIoTag[];
  oreffs: CadOref[];
  texts: CadTextItem[];
  functionBlocks: CadFunctionBlock[];
  drawEntities: CadDrawEntity[];
  rawStrings: string[];
  /** Structured engineering reconstruction graph (CAD Logic Output Generator). */
  engineeringModel?: import("./engineering").EngineeringSheetModel;
  /**
   * Source-faithful SVG from the reconstruct pipeline (A4 landscape, page
   * coordinates). When present and CAD_RENDER_ENGINE=source, the viewer/PDF
   * use this instead of layout-v2 paint.
   */
  reconstructedSvg?: string;
}

export interface M1TagInstance {
  tag: string;
  objectName?: string;
}

export interface M1GraphicParse {
  filename: string;
  graphicId?: string;
  title?: string;
  objectNames: string[];
  tags: M1TagInstance[];
  texts: string[];
  drawEntities: CadDrawEntity[];
}

export interface IoRecord {
  id: string;
  ioType: IoType;
  channel?: string;
  slave?: string;
  deviceTag?: string;
  rawIoTag: string;
  loopTag?: string;
  /** How the loop tag was obtained; absent when no loop tag is assigned. */
  loopTagSource?: "CAD_LABEL";
  /** Tag-map row the loop tag came from, or why none was assigned. */
  loopTagNote?: string;
  /** The labelled function block that carries the loop tag. */
  loopTagBlock?: LoopTagBlock;
  /** Title-block page description of the sheet that carries the loop-tag label. */
  description?: string;
  /** Where the description came from, or why there is none. */
  descriptionNote?: string;
  cadFile?: string;
  direction?: "input" | "output";
  sourcePoint?: string;
  destinationPoints: string[];
  destinationCads: string[];
  relatedLogic?: string;
  s1?: string;
  s2?: string;
  mappingStatus: "mapped" | "partial" | "unresolved";
}

export interface LoopTagBlock {
  sheet: string;
  blockNumber?: string;
  functionCode?: number;
  via: "wiring" | "same-sheet" | "loop-number";
  hops: number;
}

/**
 * EXTRACTED: read from a decoded spec; DERIVED: computed from extracted
 * values or source structure; UNRESOLVED: the sources do not prove it;
 * NOT_APPLICABLE: the field has no meaning for this record (e.g. digital range).
 */
export type LoopFieldStatus = "EXTRACTED" | "DERIVED" | "UNRESOLVED" | "NOT_APPLICABLE";

export interface LoopField {
  value: string;
  status: LoopFieldStatus;
  evidence: string;
}

/** One source I/O record as a member of a loop. */
export interface LoopDevice {
  ioRecordId: string;
  role: "input" | "output";
  cardType: IoType;
  deviceTag: string;
  rawIoTag: string;
  description: string;
  cadFile?: string;
  min: LoopField;
  max: LoopField;
  unit: LoopField;
  /** How the device was tied to the loop tag (CAD wiring, same sheet, loop number). */
  loopEvidence: string;
}

export type LoopSideStatus = "RESOLVED" | "UNRESOLVED" | "AMBIGUOUS";

export interface LoopEndpoint {
  status: LoopSideStatus;
  /** AI/AO/DI/DO, or UNRESOLVED / AMBIGUOUS when no single member is proven. */
  cardType: string;
  deviceTag: string;
  min: string;
  max: string;
  unit: string;
  /** The member device when RESOLVED. */
  ioRecordId?: string;
  /** Every member that could fill this side; more than one means AMBIGUOUS. */
  candidates: string[];
}

export type LoopMappingStatus = "MAPPED" | "UNRESOLVED" | "AMBIGUOUS";

export interface LoopRecord {
  id: string;
  package: LoopField;
  processAreaId: LoopField;
  exe: LoopField;
  controlRoom: LoopField;
  alarmGroup: LoopField;
  /** Source description of Device Tag 1 only. */
  description: LoopField;
  /** Canonical loop tag, or empty when the device has none. */
  loopTag: string;
  loopTagBlock?: LoopTagBlock;
  input: LoopEndpoint;
  output: LoopEndpoint;
  /** Every member of the loop, including those not chosen as Device Tag 1/2. */
  relatedDevices: LoopDevice[];
  /** Ids of every source I/O record in this loop. */
  sourceRecords: string[];
  mappingStatus: LoopMappingStatus;
  notes: string[];
}

export interface LoopList {
  loops: LoopRecord[];
  stats: {
    loops: number;
    sourceRecords: number;
    mapped: number;
    unresolved: number;
    ambiguous: number;
    withoutLoopTag: number;
  };
}

export interface LogicRecord {
  id: string;
  cadFile: string;
  loopTag?: string;
  description?: string;
  blockId?: string;
  functionCode?: string;
  /** Numeric Bailey function code, decoded from the SPC LIST trailer. */
  functionCodeNumber?: number;
  s0?: string;
  s0_5?: string;
  s1?: string;
  s2?: string;
  s3?: string;
  s4?: string;
  s5?: string;
  s6?: string;
  s7?: string;
  s8?: string;
  s9?: string;
  logicFormula?: string;
  inputRefs: string[];
  outputRefs: string[];
  deviceTag?: string;
  notes?: string;
}

export interface ValidationIssue {
  id: string;
  type: string;
  severity: "error" | "warning" | "info";
  message: string;
  sourceFile?: string;
  relatedCad?: string;
  relatedIo?: string;
  resolutionStatus: "open" | "resolved";
}

export interface CorrelatedProject {
  meta: ProjectMeta;
  inventory: InventoryFile[];
  ioRecords: IoRecord[];
  logicRecords: LogicRecord[];
  cadSheets: CadSheetParse[];
  graphics: M1GraphicParse[];
  validation: ValidationIssue[];
  stats: {
    cadCount: number;
    m1Count: number;
    ioByType: Record<IoType, number>;
    xrfExpectedCad?: number;
    unresolvedCount: number;
  };
}
