import type { FunctionCodeSchema } from "./types";

/**
 * Byte width of each manual storage type in a CAD specification payload.
 * Established by layout closure: for 88 of the 89 function codes found in a
 * 7,340-file corpus, the sum of these widths over the manual specification
 * list equals the payload size of every instance. Types absent here (e.g.
 * INT, or a row with no printed type) have no closure evidence.
 */
export const TYPE_WIDTH: Readonly<Record<string, number>> = { I: 2, B: 2, R: 4 };

export type LayoutStatus = "DECODED" | "LAYOUT_MISMATCH" | "LAYOUT_UNRESOLVED";

export interface DecodedSpec {
  number: number;
  label: string;
  type: string;
  offset: number;
  width: number;
  raw_hex: string;
  /** Value as the vendor tools print it (C `%g`, 6 significant digits). */
  raw_value_text: string;
  /** Exact stored value. */
  actual_value: number;
  /** `raw_value_text` parsed back to a number. */
  normalized_value: number;
  diagnostics: string[];
}

export interface DecodedPayload {
  function_code: number;
  status: LayoutStatus;
  expected_bytes: number | null;
  actual_bytes: number;
  raw_hex: string;
  specs: DecodedSpec[];
  diagnostics: string[];
}

const hex = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("hex");

/** C printf `%g` with the MSVC runtime's three-digit exponent. */
export function formatG(x: number, precision = 6): string {
  if (x === 0) return Object.is(x, -0) ? "-0" : "0";
  if (!Number.isFinite(x)) return Number.isNaN(x) ? "nan" : x < 0 ? "-inf" : "inf";
  const [mant, expStr] = x.toExponential(precision - 1).split("e");
  const exp = Number(expStr);
  const strip = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);
  if (exp < -4 || exp >= precision) {
    const sign = exp < 0 ? "-" : "+";
    return `${strip(mant)}e${sign}${String(Math.abs(exp)).padStart(3, "0")}`;
  }
  return strip(x.toFixed(Math.max(0, precision - 1 - exp)));
}

export function expectedPayloadBytes(schema: FunctionCodeSchema): number | null {
  let n = 0;
  for (const s of schema.specifications) {
    const w = TYPE_WIDTH[s.type];
    if (w == null) return null;
    n += w;
  }
  return n;
}

/**
 * Unpacks a trailer specification payload using the manual schema. The
 * payload must close exactly against the schema; otherwise no spec values are
 * produced and the raw bytes are kept.
 */
export function decodePayload(schema: FunctionCodeSchema, payload: Uint8Array): DecodedPayload {
  const expected = expectedPayloadBytes(schema);
  const base = {
    function_code: schema.function_code,
    expected_bytes: expected,
    actual_bytes: payload.length,
    raw_hex: hex(payload),
  };
  if (expected == null) {
    const types = [...new Set(schema.specifications.filter((s) => TYPE_WIDTH[s.type] == null).map((s) => `'${s.type}'`))];
    return { ...base, status: "LAYOUT_UNRESOLVED", specs: [], diagnostics: [`FC${schema.function_code}: storage width unknown for manual type ${types.join(", ")}`] };
  }
  if (expected !== payload.length) {
    return {
      ...base,
      status: "LAYOUT_MISMATCH",
      specs: [],
      diagnostics: [`FC${schema.function_code}: manual schema needs ${expected} bytes, CAD payload has ${payload.length}`],
    };
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const specs: DecodedSpec[] = [];
  let off = 0;
  for (const s of schema.specifications) {
    const width = TYPE_WIDTH[s.type];
    const diagnostics: string[] = [];
    let value: number;
    let text: string;
    if (s.type === "R") {
      value = view.getFloat32(off, true);
      text = formatG(value);
    } else {
      value = view.getUint16(off, true);
      text = String(value);
      if (value >= 0x8000) diagnostics.push(`high bit set; read as unsigned (signed reading would be ${value - 0x10000})`);
    }
    specs.push({
      number: s.number,
      label: s.label,
      type: s.type,
      offset: off,
      width,
      raw_hex: hex(payload.subarray(off, off + width)),
      raw_value_text: text,
      actual_value: value,
      normalized_value: Number(text),
      diagnostics,
    });
    off += width;
  }
  return { ...base, status: "DECODED", specs, diagnostics: [] };
}
