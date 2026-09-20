/**
 * Little-endian cursor over a SCAD 5.3 `.CAD` buffer.
 *
 * Deliberately minimal: every offset used by the record decoder is derived
 * from confirmed layout in docs/cad-reverse-engineering.md, so the reader
 * exposes raw primitives rather than interpreting anything.
 */

/** Confirmed: bytes 0..255 are the file header; records begin at 256. */
export const CAD_HEADER_SIZE = 256;

/** Confirmed: the record stream ends at the first "BCCo<C5>" trailer token. */
const TRAILER_TOKEN = Buffer.from("BCCo\xC5", "latin1");

export interface CadFileBounds {
  /** First byte of the record stream. */
  recordsStart: number;
  /** One past the last byte of the record stream. */
  recordsEnd: number;
  /** Offset of the trailer, when present. */
  trailerOffset: number | null;
}

export function cadFileBounds(buf: Buffer): CadFileBounds {
  const idx = buf.indexOf(TRAILER_TOKEN, CAD_HEADER_SIZE);
  return {
    recordsStart: CAD_HEADER_SIZE,
    recordsEnd: idx === -1 ? buf.length : idx,
    trailerOffset: idx === -1 ? null : idx,
  };
}

/** Library binding recorded at header offset 0x90, e.g. `7107lib1`. */
export function readLibraryName(buf: Buffer): string | undefined {
  if (buf.length < 0x98) return undefined;
  const raw = buf.subarray(0x90, 0x98).toString("latin1").replace(/\0+$/, "").trim();
  return raw.length > 0 ? raw : undefined;
}

export function readU16(buf: Buffer, offset: number): number {
  return offset + 2 <= buf.length ? buf.readUInt16LE(offset) : 0;
}

/** Fixed-width, space-padded name field. Returns undefined when not a name. */
export function readNameField(buf: Buffer, offset: number): string | undefined {
  if (offset + 8 > buf.length) return undefined;
  const raw = buf.subarray(offset, offset + 8).toString("latin1");
  if (!/^[\x20-\x7E]{8}$/.test(raw)) return undefined;
  const trimmed = raw.trimEnd();
  return /[A-Za-z0-9]/.test(trimmed) ? trimmed : undefined;
}

/** NUL-separated printable runs inside a byte range. */
export function readStringRuns(
  buf: Buffer,
  from: number,
  to: number,
  minLen = 2
): string[] {
  const out: string[] = [];
  let cur = "";
  const end = Math.min(to, buf.length);
  for (let i = Math.max(0, from); i < end; i++) {
    const b = buf[i];
    if (b >= 32 && b <= 126) {
      cur += String.fromCharCode(b);
    } else {
      const t = cur.trim();
      if (t.length >= minLen) out.push(t);
      cur = "";
    }
  }
  const t = cur.trim();
  if (t.length >= minLen) out.push(t);
  return out;
}
