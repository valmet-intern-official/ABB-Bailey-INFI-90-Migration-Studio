/**
 * KNOWN      — structure proven by the parser (counts that match array
 *              lengths, strings, references whose targets exist).
 * CANDIDATE  — interpretation supported by evidence but not proven
 *              (colour index, line width, 16.16 coordinates, …).
 * UNRESOLVED — raw value preserved, meaning unknown.
 */
export type FieldStatus = "KNOWN" | "CANDIDATE" | "UNRESOLVED";

export type FieldType =
  | "u16"
  | "u32"
  | "i32"
  | "f32"
  | "f64"
  | "fx16"
  | "ref"
  | "cstr"
  | "lstr"
  | "bytes";

export interface Field {
  name: string;
  type: FieldType;
  offset: number;
  length: number;
  value: number | string;
  rawHex: string;
  status: FieldStatus;
  note?: string;
  interpretations?: Record<string, number>;
}

export interface M1Header {
  offset: 0;
  length: number;
  magic: string;
  fields: Field[];
}

export interface RefSlot {
  field: string;
  targetId: number;
  /** Role inferred from the field that holds the reference. */
  role: string;
}

export interface M1Record {
  /** 0-based position in the stream. */
  index: number;
  /** Object identity: 1-based record ordinal (see RULE-ID-001). */
  id: number;
  offset: number;
  endOffset: number;
  length: number;
  className: string;
  known: boolean;
  recordType: string;
  fields: Field[];
  refs: RefSlot[];
  decodeError?: string;
  /** Bytes inside the record not explained by typed fields. */
  unresolvedBytes: number;
  decoded: Record<string, unknown>;
}

export interface CoverageGap {
  kind: "gap" | "overlap";
  start: number;
  end: number;
}

export interface CoverageReport {
  fileSize: number;
  headerBytes: number;
  recordBytes: number;
  coveredBytes: number;
  ok: boolean;
  gaps: CoverageGap[];
  fieldLevel: {
    typedBytes: number;
    unresolvedBytes: number;
    recordsWithUnresolved: number;
    fieldGaps: { recordIndex: number; start: number; end: number }[];
  };
}

export interface MarkerCandidate {
  offset: number;
  name: string;
  accepted: boolean;
  reason: string;
}

export interface DecodedM1 {
  file: string;
  size: number;
  sha256: string;
  header: M1Header;
  records: M1Record[];
  coverage: CoverageReport;
  markerCandidates: MarkerCandidate[];
  decoderRevision: string;
}
