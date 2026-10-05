/**
 * Symbol name -> function family. The family selects a documented fallback
 * glyph when the symbol's definition is not available in any supplied
 * library. It never changes engineering data: the source symbol name,
 * function code, block number and geometry are carried unchanged.
 */

export type Family =
  | "connector-in"
  | "connector-out"
  | "junction"
  | "gate-and"
  | "gate-or"
  | "gate-not"
  | "latch"
  | "timer"
  | "transfer"
  | "alarm-compare"
  | "controller"
  | "station"
  | "io-block"
  | "io-slave"
  | "arithmetic"
  | "sequence"
  | "constant"
  | "hardware"
  | "frame"
  | "generic";

const TABLE: Array<[RegExp, Family]> = [
  [/^(IREF|IREFO)$/, "connector-in"],
  [/^OREF$/, "connector-out"],
  [/^N90CNECT$/, "junction"],
  [/^(AND2|AND4)$/, "gate-and"],
  [/^(OR|OR2|OR4|QOR)$/, "gate-or"],
  [/^NOT$/, "gate-not"],
  [/^(SR|REMSET)$/, "latch"],
  [/^(TD-DIG|ETIMER)$/, "timer"],
  [/^(T-AN|T-DIG)$/, "transfer"],
  [/^(H\/L|HISEL|LOSEL|TSTALM|TSTQ|LIMIT|VELLIM)$/, "alarm-compare"],
  [/^(PID|APID|DELPID|ADAPT)$/, "controller"],
  [/^(M\/A-M|MFC\/P|EX\/MFC|EEX\/MFC|RCM|DDRIVE|MSDVDR)$/, "station"],
  [/^(AI\/L|AO\/L|DI\/L|DO\/L|AI\/B|DI\/B|DIGRP|DOGRP)$/, "io-block"],
  [/^(AIS|AS0)$/, "io-slave"],
  [/^(SUM|SUM4|DSUM|MULT|DIV|SQRT|EXP|FX|INTEGR|A|SEGCRM|BMUX|RMUX|ON\/OFF|FT|TEXT)$/, "arithmetic"],
  [/^(SEQ\w*)$/, "sequence"],
  [/^(B0|B1|R0|R1|R-1|R100|R-100|RMIN|RMAX)$/, "constant"],
  [/^(RDI\w+|RDO\w+|NTAI\w+|TAI\w+|TAO\w+|\w+SYS|\w+FLD)$/, "hardware"],
  [/^(DBORDH|LINE|TITLE|REV|BOX1|BOX2)$/, "frame"],
];

export function familyOf(symbolName: string): Family {
  const n = symbolName.trim().toUpperCase();
  for (const [re, f] of TABLE) if (re.test(n)) return f;
  return "generic";
}

/** Short label drawn inside a fallback glyph: the source symbol name. */
export function glyphLabel(symbolName: string): string {
  return symbolName.trim();
}
