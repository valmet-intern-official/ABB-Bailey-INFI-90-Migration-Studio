import type { Field, FieldStatus, FieldType } from "../decoder/types";

export class DecodeError extends Error {
  constructor(
    message: string,
    readonly offset: number
  ) {
    super(`${message} @0x${offset.toString(16)}`);
  }
}

export function hex(buf: Uint8Array, start = 0, end = buf.length): string {
  let out = "";
  for (let i = start; i < end; i++) {
    out += (i > start ? " " : "") + buf[i].toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Bounded little-endian reader that records every field it consumes, so a
 * record's decoded fields always tile its byte range exactly.
 */
export class FieldReader {
  readonly fields: Field[] = [];
  pos: number;

  constructor(
    readonly buf: Buffer,
    readonly start: number,
    readonly end: number
  ) {
    this.pos = start;
  }

  remaining(): number {
    return this.end - this.pos;
  }

  private need(n: number, name: string) {
    if (this.pos + n > this.end) {
      throw new DecodeError(`field "${name}" needs ${n} bytes, ${this.remaining()} left`, this.pos);
    }
  }

  private push(
    name: string,
    type: FieldType,
    length: number,
    value: Field["value"],
    status: FieldStatus,
    note?: string,
    interpretations?: Field["interpretations"]
  ): Field {
    const f: Field = {
      name,
      type,
      offset: this.pos,
      length,
      value,
      rawHex: hex(this.buf, this.pos, this.pos + length),
      status,
    };
    if (note) f.note = note;
    if (interpretations) f.interpretations = interpretations;
    this.fields.push(f);
    this.pos += length;
    return f;
  }

  peekU32(at = this.pos): number | null {
    return at + 4 <= this.end ? this.buf.readUInt32LE(at) : null;
  }

  u16(name: string, status: FieldStatus = "UNRESOLVED", note?: string): number {
    this.need(2, name);
    const v = this.buf.readUInt16LE(this.pos);
    this.push(name, "u16", 2, v, status, note);
    return v;
  }

  u32(name: string, status: FieldStatus = "UNRESOLVED", note?: string): number {
    this.need(4, name);
    const v = this.buf.readUInt32LE(this.pos);
    this.push(name, "u32", 4, v, status, note, u32Interpretations(this.buf, this.pos));
    return v;
  }

  i32(name: string, status: FieldStatus = "UNRESOLVED", note?: string): number {
    this.need(4, name);
    const v = this.buf.readInt32LE(this.pos);
    this.push(name, "i32", 4, v, status, note);
    return v;
  }

  /** Object reference: 1-based record ordinal, 0 = null. Target validated by the object graph. */
  ref(name: string, note?: string): number {
    this.need(4, name);
    const v = this.buf.readUInt32LE(this.pos);
    this.push(name, "ref", 4, v, "KNOWN", note);
    return v;
  }

  f32(name: string, status: FieldStatus = "CANDIDATE", note?: string): number {
    this.need(4, name);
    const v = this.buf.readFloatLE(this.pos);
    this.push(name, "f32", 4, v, status, note, u32Interpretations(this.buf, this.pos));
    return v;
  }

  f64(name: string, status: FieldStatus = "CANDIDATE", note?: string): number {
    this.need(8, name);
    const v = this.buf.readDoubleLE(this.pos);
    this.push(name, "f64", 8, v, status, note, {
      fixed16: v / 65536,
    });
    return v;
  }

  /** Signed 32-bit 16.16 fixed-point coordinate. */
  fx(name: string, status: FieldStatus = "CANDIDATE", note?: string): number {
    this.need(4, name);
    const raw = this.buf.readInt32LE(this.pos);
    this.push(name, "fx16", 4, raw / 65536, status, note, {
      int32: raw,
      float32: this.buf.readFloatLE(this.pos),
    });
    return raw / 65536;
  }

  /** NUL-terminated Latin-1 string (terminator included in the field). */
  cstr(name: string, status: FieldStatus = "KNOWN", note?: string): string {
    let i = this.pos;
    while (i < this.end && this.buf[i] !== 0) i++;
    if (i >= this.end) throw new DecodeError(`unterminated string "${name}"`, this.pos);
    const v = this.buf.toString("latin1", this.pos, i);
    this.push(name, "cstr", i - this.pos + 1, v, status, note);
    return v;
  }

  /** u32 byte length followed by that many Latin-1 bytes (no terminator). */
  lstr(name: string, status: FieldStatus = "KNOWN", note?: string): string {
    this.need(4, `${name}.length`);
    const len = this.buf.readUInt32LE(this.pos);
    this.push(`${name}.length`, "u32", 4, len, "KNOWN", "byte length of following string");
    this.need(len, name);
    const v = this.buf.toString("latin1", this.pos, this.pos + len);
    this.push(name, "lstr", len, v, status, note);
    return v;
  }

  bytes(name: string, n: number, status: FieldStatus = "UNRESOLVED", note?: string): Field {
    this.need(n, name);
    return this.push(name, "bytes", n, hex(this.buf, this.pos, this.pos + n), status, note);
  }

  /** Consume everything left as one explicit unresolved range (never silently dropped). */
  rest(name = "unresolved_tail", note?: string): Field | null {
    const n = this.remaining();
    if (n <= 0) return null;
    return this.bytes(name, n, "UNRESOLVED", note ?? "bytes not explained by the current decoder revision");
  }
}

function u32Interpretations(buf: Buffer, at: number) {
  return {
    int32: buf.readInt32LE(at),
    float32: buf.readFloatLE(at),
    fixed16: buf.readInt32LE(at) / 65536,
  };
}
