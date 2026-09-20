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
  description?: string;
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
