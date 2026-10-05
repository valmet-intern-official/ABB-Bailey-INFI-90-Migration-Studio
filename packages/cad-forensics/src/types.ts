/**
 * Engineering scene graph: every source-recoverable item of a module's CAD
 * sheets as an individual record with provenance and a status.
 *
 * Authority:
 *   CAD bytes        drawing data, values, coordinates, block/sub-block ids,
 *                    wires, endpoints, channels, configured S values
 *   CAD manual (KB)  function-code meaning, spec schema, symbol labels
 *   archive metadata file timestamps (plot stamp)
 * The vendor plot PDF is never an input.
 *
 * Status vocabulary:
 *   EXPLICIT    stated by a source record, or exact source-coordinate incidence
 *   DERIVED     computed deterministically from source records / manual tables
 *   INFERRED    a stated convention applied to source data (basis recorded)
 *   UNRESOLVED  the sources do not determine it; raw data kept
 *   NOT_PRESENT the schema defines it but the source has no entry
 *   CONFLICT    sources disagree
 *   RAW_ONLY    bytes kept, not interpreted
 */

export type Status = "EXPLICIT" | "DERIVED" | "INFERRED" | "UNRESOLVED" | "NOT_PRESENT" | "CONFLICT" | "RAW_ONLY";

export type XY = [number, number];
/** [x1, y1, x2, y2] */
export type Box = [number, number, number, number];

export interface Provenance {
  /** `FILE.CAD@offset` or `LIB.LBR@offset`, or a derivation tag. */
  entity_ids: string[];
  /** Free-text evidence chain, strongest first. */
  evidence: string[];
}

export type EntityType =
  | "polyline"
  | "wire"
  | "arc"
  | "rectangle"
  | "segment"
  | "text"
  | "symbol"
  | "function_block"
  | "terminal"
  | "junction"
  | "connector"
  | "IREF"
  | "OREF"
  | "frame"
  | "frame_component"
  | "grid"
  | "title_block_field"
  | "library_primitive"
  | "unknown";

export interface Entity {
  id: string;
  file: string;
  page: number;
  type: EntityType;
  /** Source units (SCAD grid, Y up). */
  x: number;
  y: number;
  bbox: Box | null;
  /** Page points on the generated drawing page. */
  page_xy: XY;
  rotation: number;
  scale: number;
  layer: number | null;
  style: number | null;
  text: string | null;
  parent: string | null;
  group: string | null;
  references: string[];
  raw_source: { file: string; offset: number; record_type: number | null; length_bytes: number | null; library?: string; raw_hex?: string };
  status: Status;
}

export interface Terminal {
  id: string;
  block_id: string;
  /** Positional pin name (L1, R2, …) or a slot name when no pin is drawn. */
  pin: string | null;
  side: "input" | "output";
  /** Manual label: S1 / S5 / N / N+1 … */
  label: string | null;
  slot_index: number | null;
  source_xy: XY | null;
  page_xy: XY | null;
  /** Whether a source wire ends on this terminal. */
  wired: boolean;
  wire_ids: string[];
  /** How the label↔position association is known. */
  association: Status;
  association_method: "WIRE_SPEC_MATCH" | "TEMPLATE_FROM_EXPLICIT" | "EXACT_PIN_COUNT" | "PITCH_SLOT" | "GLYPH_PITCH" | "NONE";
  /** How the position itself is known (witnessed pin vs extrapolated slot). */
  position_status: Status;
  basis: string;
}

export interface SubBlock {
  id: string;
  parent_block: string;
  parent_address: number;
  address: number;
  /** k in N+k. */
  offset: number;
  output_label: string;
  /** Manual output-table row. */
  output_type: string | null;
  output_description: string | null;
  /** Caption printed beside the output on the manual symbol (e.g. H, L, SST). */
  caption: string | null;
  function_code: number;
  function_name: string | null;
  terminal_id: string | null;
  page: number;
  file: string;
  page_xy: XY | null;
  manual_page: number | null;
  source_entities: string[];
  status: Status;
}

export interface SpecificationTerminal {
  id: string;
  parent_block: string;
  block_address: number;
  function_code: number;
  number: number;
  label: string;
  /** True when the manual symbol prints this S label on a pin. */
  drawn_on_symbol: boolean;
  raw_value_text: string | null;
  raw_hex: string | null;
  actual_value: number | null;
  normalized_value: number | null;
  type: string;
  default: string;
  tune: boolean | null;
  tune_raw: string;
  range: string;
  manual_description: string;
  enumeration_meaning: string | null;
  is_block_address: boolean;
  connected_reference: {
    status: string;
    target_block: number | null;
    target_output: string | null;
    target_function_code: number | null;
    target_name: string | null;
    target_file: string | null;
    target_page: number | null;
  } | null;
  terminal_id: string | null;
  page_xy: XY | null;
  wired_from: Array<{ wire_or_connection: string; source_block: number | null; source_address: number | null; status: string }>;
  /** Address the drawn wire delivers to this input (what the compiler uses); null when not wired. */
  effective_input: { address: number | null; source_file: string | null; source_block: number | null; source_output: string | null; status: Status; basis: string } | null;
  source_entities: string[];
  byte_offset: number | null;
  byte_length: number | null;
  manual_page: number;
  manual_section: string;
  /** EXTRACTED / UNRESOLVED / NOT_PRESENT / CONFLICT from the trailer decode. */
  value_status: string;
  status: Status;
}

export interface FunctionBlockNode {
  id: string;
  file: string;
  page: number;
  /** Drawn symbol present on the sheet. */
  drawn: boolean;
  source_bbox: Box | null;
  page_bbox: Box | null;
  insertion: XY | null;
  rotation: number;
  symbol_name: string | null;
  glyph: "LIBRARY" | "FALLBACK" | "NONE";
  function_code: number | null;
  function_name: string | null;
  manual_title: string | null;
  block_address: number | null;
  specifications: string[];
  sub_blocks: string[];
  input_terminals: string[];
  output_terminals: string[];
  wires: string[];
  irefs: string[];
  orefs: string[];
  captions: Array<{ text: string; row_label: string | null; side: "input" | "output" | "body"; page_xy: XY | null; status: Status; basis: string }>;
  module: string;
  module_type: string | null;
  segment_block: number | null;
  executive_block: number | null;
  source_entities: string[];
  manual_page: number | null;
  status: Status;
  diagnostics: string[];
}

export interface WireNode {
  id: string;
  file: string;
  page: number;
  start_point: XY;
  end_point: XY;
  path_points: XY[];
  page_points: XY[];
  line_type: string;
  /** "rule" = drafting line (long-dash style or closed outline); never a signal path. */
  connection_type: "signal" | "rule";
  junctions: string[];
  source_entity_ids: string[];
  start: { kind: string; ref: string | null; block: number | null; terminal: string | null; status: Status; distance: number };
  end: { kind: string; ref: string | null; block: number | null; terminal: string | null; status: Status; distance: number };
  net: string | null;
  signal_label: string | null;
  cross_page_reference: string | null;
  status: Status;
}

export interface LogicConnectionNode {
  id: string;
  kind: string;
  source_block: number | null;
  source_terminal: string | null;
  source_address: number | null;
  source_address_status: Status | null;
  source_address_basis: string | null;
  target_block: number | null;
  target_terminal: string | null;
  wire_ids: string[];
  junction_ids: string[];
  page: number;
  file: string;
  target_page: number | null;
  target_file: string | null;
  cross_page: boolean;
  signal: string | null;
  spec_check: { spec: string; value: number | null; agrees: boolean } | null;
  source_entities: string[];
  status: Status;
  note: string | null;
}

export interface ReferenceNode {
  id: string;
  type: "IREF" | "OREF";
  /** Reference text as drawn (e.g. AD95-10.07). */
  label: string | null;
  /** Signal tag with field padding removed. */
  signal: string | null;
  /** The tag field byte-for-byte; differs from `signal` only by padding. */
  signal_raw: string | null;
  signal_padding: { leading: number; trailing: number } | null;
  symbol_name: string;
  zone: string | null;
  connected_blocks: Array<{ block: number | null; terminal: string | null }>;
  target_reference: { status: string; sheet: string | null; page: number | null; connector: string | null; zone: string | null; candidates: string[] };
  page: number;
  file: string;
  page_xy: XY;
  source_entities: string[];
  evidence: string[];
  status: Status;
}

export interface ChannelNode {
  id: string;
  /** Exact string, never normalised. */
  text: string;
  io_type: string;
  channel: string | null;
  suffix: string | null;
  physical_ref: string | null;
  attached_to: string | null;
  page: number;
  file: string;
  page_xy: XY;
  source_entities: string[];
  status: Status;
}

export interface PlotStamp {
  text: string;
  archive_entry: string | null;
  mtime: string | null;
  status: Status;
  basis: string;
}

export interface SheetNode {
  file: string;
  page: number;
  sha256: string;
  title_block: Array<{ label: string; value: string; status: Status; entity: string }>;
  title_block_unassigned: string[];
  plot_stamp: PlotStamp;
  frame: { present: boolean; symbol: string | null; library: string | null };
  counts: Record<string, number>;
}

export interface UnresolvedItem {
  kind: string;
  id: string;
  file: string | null;
  page: number | null;
  status: Status;
  reason: string;
  raw: string | null;
}

export interface SceneGraph {
  schema_version: 1;
  module: { name: string; type: string | null; executive_blocks: number[]; segment_blocks: number[]; cad_files: number };
  manual: { document: string; sha256: string };
  sheets: SheetNode[];
  entities: Entity[];
  function_blocks: FunctionBlockNode[];
  sub_blocks: SubBlock[];
  terminals: Terminal[];
  specifications: SpecificationTerminal[];
  wires: WireNode[];
  connections: LogicConnectionNode[];
  references: ReferenceNode[];
  channels: ChannelNode[];
  unresolved: UnresolvedItem[];
  terminal_validation: TerminalValidation;
}

export interface TerminalValidation {
  /** Per-method counts of terminal label placements. */
  by_method: Record<string, number>;
  /** PITCH_SLOT placements checked against WIRE_SPEC_MATCH evidence. */
  pitch_slot_checked: number;
  pitch_slot_agree: number;
  pitch_slot_disagree: Array<{ block: string; label: string; explicit_pin: string; inferred_pin: string }>;
  rotated_blocks_skipped: number;
}
