/**
 * Function-block specification extraction records.
 *
 * Authority: the CAD file is the only source of actual values and block
 * identity; the manual knowledge base supplies semantics (names, spec meaning,
 * type, default, tune, range). Nothing is filled in from elsewhere: anything
 * the sources do not prove carries a non-EXTRACTED status and the raw bytes.
 */

/** How a fact is known. Same vocabulary as the reconstruct model. */
export type Evidence = "EXPLICIT" | "DERIVED" | "INFERRED" | "UNRESOLVED";

export type SpecStatus =
  /** Value decoded from the CAD with a closing manual layout. */
  | "EXTRACTED"
  /** Bytes present but not attributable to this spec (layout unresolved/mismatch, unknown FC). */
  | "UNRESOLVED"
  /** Manual defines the spec but the CAD has no entry for the block. */
  | "NOT_PRESENT"
  /** Sources disagree (e.g. duplicate block address with different payloads). */
  | "CONFLICT";

export interface SourceLocation {
  file: string;
  /** 1-based sheet number in module order (the drawing page). */
  page: number;
  /** Page-space bbox of the block symbol [x1, y1, x2, y2], points, Y up. */
  bbox: [number, number, number, number] | null;
  /** Source-unit bbox of the block symbol. */
  source_bbox: [number, number, number, number] | null;
  /** Byte offsets of the evidencing entities, e.g. `2071053C.CAD@1234`. */
  entity_ids: string[];
}

export interface ModuleContext {
  /** Module identifier as named by the source files (file stem prefix). */
  module: string;
  /** Module type from the module header (`*.MHD`), when present. */
  module_type: string | null;
  /** Executive block address (FC 81) found in the module, if any. */
  executive_block: number | null;
}

export interface SegmentContext {
  /** Block address of the governing segment control block (FC 82). */
  segment_block: number | null;
  evidence: Evidence;
  /** Why: the manual rule and page. */
  basis: string;
}

export interface DrawingContext {
  file: string;
  page: number;
  /** Title block fields as decoded (label → value). */
  title_block: Array<{ label: string; value: string; status: Evidence }>;
  drawing_number: string | null;
}

export type AddressResolutionStatus =
  | "RESOLVED_BLOCK"
  | "RESOLVED_FIXED_BLOCK"
  /** The spec's pin is wired on the drawing; the wire names the source block. */
  | "WIRED_INPUT"
  | "UNRESOLVED"
  | "NOT_APPLICABLE";

export interface AddressResolution {
  status: AddressResolutionStatus;
  evidence: Evidence;
  /** The address value itself (the spec's CAD value). */
  address: number | null;
  /** Owning function block; differs from `address` for output N+k. */
  target_block: number | null;
  /** Output of the owning block the address selects, e.g. `N+1`. */
  target_output: string | null;
  target_function_code: number | null;
  target_name: string | null;
  target_file: string | null;
  target_page: number | null;
  target_segment: number | null;
  /** For fixed blocks: the manual table row description and its scope. */
  fixed_block?: { description: string; table: string; scope: string; manual_page: number };
  note?: string;
}

export interface PinAssociation {
  /** Positional pin on the drawn symbol, e.g. `L2`. */
  pin: string;
  side: string;
  /** Manual symbol label assigned to this pin, e.g. `S2`, or null. */
  label: string | null;
  evidence: Evidence;
  basis: string;
  connected: boolean;
  connection_ids: string[];
}

export interface SpecificationRecord {
  id: string;
  block_id: string;
  block_address: number;
  function_code: number;
  spec_number: number;
  label: string;
  /** Value as the vendor tools print it; null when not extracted. */
  raw_value_text: string | null;
  /** Payload bytes for this spec, hex. */
  raw_hex: string | null;
  /** Exact stored value. */
  actual_value: number | null;
  /** Vendor text parsed back to a number. */
  normalized_value: number | null;
  type: string;
  default: string;
  tune: boolean | null;
  tune_raw: string;
  range: string;
  manual_description: string;
  note_refs: string[];
  enumerations: Array<{ value: string; meaning: string }>;
  /** Manual meaning of this value when it matches a printed enumeration. */
  enumeration_meaning: string | null;
  is_block_address: boolean;
  address_resolution: AddressResolution | null;
  /** Drawn pin carrying this spec, when the pin mapping is established. */
  pin: PinAssociation | null;
  /** Drawn wiring into this spec's pin (source block address = N or N+k of the driver). */
  wired_from: Array<{ connection_id: string; source_block: number | null; source_address: number | null; kind: string; status: Evidence }>;
  source: SourceLocation & { byte_offset: number | null; byte_length: number | null };
  manual_page: number;
  manual_section: string;
  extraction_method: string;
  association: { method: string; evidence: Evidence };
  status: SpecStatus;
  diagnostics: string[];
}

export interface FunctionBlockRecord {
  id: string;
  block_address: number;
  /** From the CAD trailer; null for a drawn symbol with no trailer entry. */
  function_code: number | null;
  /** Manual name of the function code, or null when the manual has no schema. */
  name: string | null;
  /** CAD symbol name as drawn, e.g. `TD-DIG`. */
  symbol_name: string | null;
  drawn: boolean;
  file: string;
  page: number;
  source: SourceLocation;
  module: ModuleContext;
  segment: SegmentContext;
  drawing: DrawingContext;
  manual_page: number | null;
  manual_section: string | null;
  layout_status: string;
  payload_hex: string;
  expected_bytes: number | null;
  actual_bytes: number;
  spec_ids: string[];
  pins: PinAssociation[];
  status: "EXTRACTED" | "UNRESOLVED" | "CONFLICT" | "NOT_PRESENT";
  diagnostics: string[];
}

export type ConnectionEvidence = "WIRE_NET" | "CROSS_SHEET_REFERENCE" | "SPEC_BLOCK_ADDRESS";

export interface LogicConnection {
  id: string;
  source_block: number | null;
  source_terminal: string | null;
  /** Block address the source terminal outputs (N or N+k), when established. */
  source_address: number | null;
  target_block: number | null;
  target_terminal: string | null;
  /** Signal tag, when a connector names it. */
  signal: string | null;
  page: number;
  file: string;
  /** For cross-sheet links: the other sheet. */
  target_page: number | null;
  target_file: string | null;
  kind: ConnectionEvidence;
  source_entity_ids: string[];
  status: Evidence;
  /**
   * For a wire into a pin mapped to a block-address spec: whether the spec's
   * CAD value names the wired source block.
   */
  spec_check?: { spec: string; value: number | null; agrees: boolean };
  note?: string;
}

export type DiagnosticCode =
  | "UNKNOWN_FUNCTION_CODE"
  | "MISSING_SCHEMA"
  | "LAYOUT_MISMATCH"
  | "LAYOUT_UNRESOLVED"
  | "TRAILER_ENTRY_WITHOUT_SYMBOL"
  | "SYMBOL_WITHOUT_TRAILER_ENTRY"
  | "DUPLICATE_BLOCK_ADDRESS"
  | "AMBIGUOUS_OWNERSHIP"
  | "UNRESOLVED_BLOCK_ADDRESS"
  | "PIN_MAPPING_UNRESOLVED"
  | "BROKEN_CONNECTION"
  | "PARSE_FAILURE"
  | "INT_HIGH_BIT"
  | "MANUAL_DIAGNOSTIC";

export interface Diagnostic {
  code: DiagnosticCode;
  severity: "error" | "warning" | "info";
  message: string;
  file?: string;
  page?: number;
  block_address?: number;
  function_code?: number;
  spec?: string;
  entity_ids?: string[];
}

export interface SheetInfo {
  file: string;
  page: number;
  sha256: string;
  block_ids: string[];
  trailer_entries: number;
  drawn_blocks: number;
}

export interface ExtractionResult {
  schema_version: 1;
  module: ModuleContext;
  manual: { document: string; sha256: string; schema_version: number };
  sheets: SheetInfo[];
  blocks: FunctionBlockRecord[];
  specifications: SpecificationRecord[];
  connections: LogicConnection[];
  diagnostics: Diagnostic[];
  unknown_function_codes: Array<{ function_code: number; blocks: number[]; files: string[] }>;
}
