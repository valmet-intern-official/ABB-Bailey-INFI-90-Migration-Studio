/**
 * Symbol-role classification.
 *
 * The names below are those observed in this archive; the registry is
 * extensible and an unrecognised name is classified as a generic symbol with
 * its raw name preserved rather than discarded.
 */

export type SymbolRole =
  | "border"
  | "frame"
  | "connector"
  | "input-ref"
  | "output-ref"
  | "logic"
  | "io-module"
  | "generic";

/** Drawing furniture — the sheet frame, not engineering content. */
const BORDER = new Set(["DBORDH", "DBORDV", "TITLE", "REV"]);

/** 12x12 junction nodes; 35,053 instances archive-wide. */
const CONNECTOR = new Set(["N90CNECT"]);

const INPUT_REF = new Set(["IREF", "IREFO", "IREFI"]);
const OUTPUT_REF = new Set(["OREF", "OREFO", "OREFI"]);

/** Bailey function blocks seen in the fixtures. Not an exhaustive universe. */
const LOGIC = new Set([
  "AND", "AND2", "AND4", "AND8",
  "OR", "OR2", "OR4", "OR8",
  "NOT", "XOR", "SR", "QOR",
  "TD-DIG", "T-DIG", "T-AN", "ETIMER",
  "PID", "SUM", "ADD", "SUB", "MUL", "DIV",
  "H/L", "HLAG", "LEAD", "RAMP", "RCM",
  "SEQ", "SEQGEN", "SEQMON", "REMSET",
  "DSUM", "DIGRP", "TSTALM", "MSDVDR",
  "M/A", "M/A-M", "A/M", "ON/OFF", "TREND",
  "RECIPR", "BMUX", "RMUX", "RDEMUX",
  "P=0", "F(x)",
]);

/** I/O and termination-side blocks. */
const IO_PREFIX = [
  /^RDI\d/i, /^RDO\d/i, /^AI\d/i, /^AO\d/i, /^DI\d/i, /^DO\d/i,
  /^TAI\d/i, /^TAO\d/i, /^TCS/i, /^DSO\d/i, /^TUIN/i, /^TUOUT/i,
];

const IO_EXACT = new Set([
  "DI1SYS", "DO2SYS", "AI5SYS", "AI5FLD", "DI/L", "DO/L", "AO/L", "AI/L",
]);

export function classifySymbol(name: string | undefined): SymbolRole {
  if (!name) return "generic";
  const n = name.trim().toUpperCase();

  if (BORDER.has(n)) return "border";
  if (n === "LINE" || n === "BOX1" || n === "BOX2") return "frame";
  if (CONNECTOR.has(n)) return "connector";
  if (INPUT_REF.has(n)) return "input-ref";
  if (OUTPUT_REF.has(n)) return "output-ref";
  if (LOGIC.has(n)) return "logic";
  if (IO_EXACT.has(n)) return "io-module";
  if (IO_PREFIX.some((re) => re.test(n))) return "io-module";
  return "generic";
}

/**
 * Numeric Bailey function codes, recovered from the source.
 *
 * These are not hand-written: each pair was decoded by joining a record-stream
 * symbol name to its `BCCo SPC LIST` trailer entry through the Bailey block
 * address, then cross-validated archive-wide. All 82 distinct names map to
 * exactly one function code, agreeing on 69,091 of 69,091 observations
 * (100.00%). See `tools/cad-forensics/verify-fc-map.ts`.
 *
 * This table is only a fallback for blocks whose sheet has no trailer entry;
 * `decodeCadSheet` prefers the per-block code read from the file.
 *
 * An earlier hand-written table here was wrong — it had AND=33 / NOT=34 /
 * OR=37, whereas the source says NOT=33, SR=34, AND2=37, OR2=39.
 */
const FC_NUMBER: Record<string, number> = {
  A: 2, ADAPT: 24, AIS: 132, "AO/L": 30, AND2: 37, AND4: 38, APID: 156, AS0: 149,
  BASBOQ: 138, BLINK: 61, BMUX: 119,
  "CISI/O": 79,
  DDRIVE: 123, DELPID: 19, DIGDEF: 128, DIGRP: 84, DIV: 17, "DO/L": 45, DOGRP: 83, DSUM: 65,
  "EEX/MFC": 90, ETIMER: 86, EXP: 172,
  FT: 3, FX: 1,
  "H/L": 12, HISEL: 10,
  INPOL: 168, INTEGR: 166,
  LIMIT: 6, LOSEL: 11,
  "M/A-M": 80, MOVAVG: 165, MSDVDR: 129, MULT: 16,
  NOT: 33,
  "ON/OFF": 50, OR2: 39, OR4: 40,
  PID: 18, PULPOS: 4,
  QOR: 36,
  RCM: 62, RDEMUX: 126, RECIPB: 117, RECIPR: 118, REDAI: 96, REMSET: 68, RESTR: 140, RMUX: 120,
  SEGCRM: 82, SEQGEN: 161, SEQMGR: 135, SEQMON: 124, SEQMST: 141, SEQSLV: 142, SMITH: 160,
  SQRT: 7, SR: 34, SUM: 15, SUM4: 14,
  "T-AN": 9, "T-DIG": 59, "TD-DIG": 35, TEXT: 151, TREND: 66, TSTALM: 69, TSTQ: 31,
  "UP/DN": 85,
  VELLIM: 8,
  XOR: 101,
};

export function functionCodeNumber(name: string | undefined): number | undefined {
  if (!name) return undefined;
  return FC_NUMBER[name.trim().toUpperCase()];
}

/** Extract engineering parameters carried alongside a block, e.g. `TO=5 SEC`. */
export function extractParameters(strings: string[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (const s of strings) {
    const kv = s.match(/^\s*([A-Z][A-Z0-9._/-]{0,14})\s*=\s*(.+?)\s*$/i);
    if (kv) {
      params[kv[1].toUpperCase()] = kv[2];
      continue;
    }
    const spec = s.match(/^\s*S(\d{1,2})(?:\s*[:=]\s*|\s+)(.+?)\s*$/i);
    if (spec) params[`S${spec[1]}`] = spec[2];
  }
  return params;
}
