/**
 * Machine-readable function-code knowledge base, parsed from the ABB
 * "Function Code Application Manual". The manual is the semantic authority:
 * every field here is either verbatim manual text or a normalisation of it
 * that keeps the verbatim text alongside.
 */

/** One positioned text run from a PDF text layer (PDF units, y up). */
export interface TextItem {
  x: number;
  y: number;
  w: number;
  h: number;
  s: string;
  f?: string;
}

export interface TextPage {
  page: number;
  width: number;
  height: number;
  items: TextItem[];
}

export interface ManualText {
  source: string;
  sha256: string;
  numPages: number;
  pages: TextPage[];
}

export interface ManualEnumeration {
  /** Verbatim left-hand side, e.g. `0`, `00X`, `10X`. */
  value: string;
  meaning: string;
}

export interface ManualSpecification {
  number: number;
  label: string;
  /** `Y` → true, `N` → false; anything else is null with the raw kept. */
  tune: boolean | null;
  tune_raw: string;
  /** Superscript table-note references printed beside the row (e.g. tune `N 2`). */
  note_refs?: string[];
  /** Verbatim, e.g. `0`, `0.000`, `9.2 E18`, `N/A`. */
  default: string;
  /** Verbatim manual type letter(s), e.g. `I`, `R`, `B`. */
  type: string;
  /** Verbatim, e.g. `Note 1`, `Full`, `0 - 2`, `N/A`. */
  range: string;
  /** De-hyphenated, whitespace-normalised description. */
  description: string;
  /** Description exactly as printed, one entry per printed line. */
  description_lines: string[];
  enumerations: ManualEnumeration[];
  /** True when the manual describes this specification as a block address. */
  is_block_address: boolean;
  /** Set when one printed row covered several specifications, e.g. `S2 - S5`. */
  range_row?: string;
  /**
   * Set when the manual elided this row with a line of bullets between two
   * printed rows with identical cells, e.g. `S10 … S34`; the cells are those
   * printed rows' cells.
   */
  elided_between?: string;
  manual_page: number;
}

export interface ManualOutput {
  blk: string;
  type: string;
  description: string;
  description_lines: string[];
  manual_page: number;
}

export interface ManualNote {
  /** Verbatim note label, e.g. `1.` or `NOTE:`. */
  label: string;
  text: string;
  manual_page: number;
  /** Where the note was printed: after the spec table, or in the preamble. */
  context: "specifications" | "outputs" | "general";
}

export interface ManualSymbol {
  /** Title text inside the symbol as printed, e.g. `T D -D IG`. */
  title_raw: string | null;
  /** Title with PDF letter-spacing removed, e.g. `TD-DIG`. */
  title: string | null;
  /** Specification pins top-to-bottom as drawn, e.g. `["S1","S2"]`. */
  inputs: string[];
  /** Output pins top-to-bottom as drawn, e.g. `["N","N+1"]`. */
  outputs: string[];
  /** Every text run inside the symbol region, verbatim. */
  items: Array<{ x: number; y: number; s: string }>;
}

export interface FunctionCodeSchema {
  function_code: number;
  name: string;
  description: string;
  description_lines: string[];
  symbol: ManualSymbol;
  outputs: ManualOutput[];
  specifications: ManualSpecification[];
  spec_count: number;
  max_spec_number: number;
  notes: ManualNote[];
  manual_page: number;
  manual_pages: number[];
  manual_section: string;
  diagnostics: string[];
}

export interface FixedBlock {
  block_address: string;
  description: string;
  /** Function code that owns the block in the manual table, when printed. */
  function_code: number | null;
  /**
   * PRINTED when the code is on this row; ROW_GROUP when inherited from the
   * nearest printed code above it (the table leaves grouped rows blank).
   */
  function_code_source: "PRINTED" | "ROW_GROUP";
  manual_page: number;
}

export interface ManualKnowledgeBase {
  schema_version: 1;
  source: {
    document: string;
    title: string;
    file: string;
    sha256: string;
    pages: number;
  };
  /** Manual table of fixed block addresses, with its printed scope. */
  fixed_blocks: {
    table: string;
    scope: string;
    manual_page: number;
    blocks: FixedBlock[];
  } | null;
  function_codes: FunctionCodeSchema[];
  diagnostics: string[];
}
