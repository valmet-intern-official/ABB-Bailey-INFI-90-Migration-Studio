/**
 * Record-stream decoder for SCAD 5.3 `.CAD` files.
 *
 * Every layout below is CONFIRMED: each rule was proposed from individual
 * files and then re-tested against the whole 7,320-file corpus by
 * `tools/cad-forensics/verify-hypotheses.ts`, which reports a 100% pass rate
 * over 762,038 records. See docs/cad-reverse-engineering.md for the evidence.
 *
 * Nothing is discarded. Bytes the schema does not explain are preserved
 * verbatim on `residualHex`, and any field that could not be interpreted with
 * confidence is named in `unresolved`.
 *
 * Common prefix, every record type:
 *
 *   +0  uint16  type          1..12
 *   +2  uint16  lengthWords   record size in 16-bit words, including header
 *   +4  uint16  layer         1..16
 *
 * Type 1 — polyline (wires and drawing rules)
 *   +6  uint16  style         0..3
 *   +8  (uint16 x, uint16 y) * (lengthWords - 4) / 2      up to 53 vertices
 *
 * Types 2, 3 — two-point primitive
 *   +6  x1  +8 y1  +10 x2  +12 y2
 *
 * Type 4 — three-point primitive
 *   +6  x1  +8 y1  +10 x2  +12 y2  +14 x3  +16 y3
 *
 * Type 5 — text
 *   +6  x1  +8 y1  +10 x2  +12 y2   text extent box
 *   +14 uint16  height        low 15 bits; bit 15 is a flag
 *   +16 uint16  rotation      0 / 90 / 180 / 270
 *   +18 char[]  text          to end of record, text then padding
 *
 * Types 6, 7, 8, 9, 10, 11, 12 — symbol instance
 *   +6  x1  +8 y1  +10 x2  +12 y2   bounding box
 *   +14 char[8]  symbolName
 *   +22 uint16  insertionX
 *   +24 uint16  insertionY
 *   +26 uint16  rotation      0 / 90 / 180 / 270
 *   +28 uint16  flags
 *   then, by type:
 *     6  +30 uint16   blockNumber   Bailey block address, 1..9999
 *     8  +30 char[30] tag           signal tag / description
 *        +60 char[10] reference     'XXXX-NN.NN' cross-reference address
 *     7  +32 array of 40-byte entries: char[10] reference + char[30] tag
 */
import { cadFileBounds, readU16 } from "../binary/reader";

export type CadRecordKind =
  | "polyline"
  | "primitive2"
  | "primitive3"
  | "text"
  | "symbol"
  | "unknown";

export interface CadPoint {
  x: number;
  y: number;
}

/** One terminal reference slot inside a type 7 record. */
export interface CadTerminalEntry {
  slot: number;
  reference?: string;
  tag?: string;
}

export interface RawCadRecord {
  /** Byte offset in the source file — provenance for every decoded entity. */
  offset: number;
  type: number;
  lengthBytes: number;
  /** Drawing level, 1..16. */
  layer: number;
  kind: CadRecordKind;

  /** Vertices for polylines and 2/3-point primitives, in source coordinates. */
  points: CadPoint[];
  /** Bounding box for symbols and text; zero for pure geometry records. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;

  symbolName?: string;
  insertionX?: number;
  insertionY?: number;
  /** Degrees, one of 0 / 90 / 180 / 270. */
  rotation?: number;
  flags?: number;
  /** Bailey function block address (type 6). */
  blockNumber?: number;
  /** Signal tag / description (type 8, and type 7 entries). */
  tag?: string;
  /** Fixed-format cross-reference address 'XXXX-NN.NN' (type 8). */
  reference?: string;
  /** Terminal reference array (type 7). */
  entries?: CadTerminalEntry[];

  text?: string;
  textHeight?: number;
  /** Bit 15 of the height word; meaning not established. */
  textHeightFlag?: boolean;
  /** Line style for polylines, 0..3; meaning not established. */
  style?: number;

  /** Every 16-bit word, so no source value is ever lost. */
  words: number[];
  /**
   * Non-zero values carried in positions the schema does not interpret,
   * preserved with their byte offsets rather than discarded.
   */
  reserved?: Array<{ at: number; value: number }>;
  /** Bytes the schema does not explain, as hex. Empty when fully explained. */
  residualHex?: string;
  /** Names of fields present but not confidently interpreted. */
  unresolved: string[];
}

export interface DecodedRecordStream {
  records: RawCadRecord[];
  diagnostics: string[];
  /** True when the length chain reached the trailer cleanly. */
  clean: boolean;
  /** Byte accounting for this file. */
  coverage: {
    totalBytes: number;
    headerBytes: number;
    recordBytes: number;
    trailerBytes: number;
    /** Non-zero record bytes not explained by any schema field. */
    residualBytes: number;
  };
}

const SYMBOL_TYPES = new Set([6, 7, 8, 9, 10, 11, 12]);
const POLYLINE_TYPE = 1;
const TEXT_TYPE = 5;
const TWO_POINT_TYPES = new Set([2, 3]);
const THREE_POINT_TYPE = 4;

/** Fields are space-padded in some files and NUL-padded in others. */
function readPaddedText(buf: Buffer, from: number, len: number): string | undefined {
  const end = Math.min(from + len, buf.length);
  if (from >= end) return undefined;
  let out = "";
  for (let i = from; i < end; i++) {
    const c = buf[i];
    if (c < 32 || c > 126) break;
    out += String.fromCharCode(c);
  }
  const t = out.trim();
  return t.length > 0 ? t : undefined;
}

/** The rigid 'XXXX-NN.NN' reference address, or undefined when blank. */
function readReference(buf: Buffer, from: number): string | undefined {
  if (from + 10 > buf.length) return undefined;
  const s = buf.subarray(from, from + 10);
  if (s[4] !== 0x2d || s[7] !== 0x2e) return undefined;
  let out = "";
  for (const c of s) out += c >= 32 && c <= 126 ? String.fromCharCode(c) : " ";
  const t = out.trim();
  return t.length > 0 ? t : undefined;
}

export function decodeRecordStream(buf: Buffer): DecodedRecordStream {
  const { recordsStart, recordsEnd, trailerOffset } = cadFileBounds(buf);
  const records: RawCadRecord[] = [];
  const diagnostics: string[] = [];
  let clean = true;
  let off = recordsStart;
  let recordBytes = 0;
  let residualBytes = 0;

  while (off + 4 <= recordsEnd) {
    // Records are word-aligned; runs of 0x0000 between them are padding.
    if (readU16(buf, off) === 0) {
      off += 2;
      continue;
    }

    const type = readU16(buf, off);
    const lengthWords = readU16(buf, off + 2);
    const lengthBytes = lengthWords * 2;

    if (lengthWords < 4 || off + lengthBytes > recordsEnd) {
      diagnostics.push(
        `PARSER_RECORD_DESYNC at ${off}: type=${type} lengthWords=${lengthWords}`
      );
      clean = false;
      break;
    }

    const end = off + lengthBytes;
    const body = buf.subarray(off, end);
    recordBytes += lengthBytes;

    // Tracks which bytes the schema accounts for, so residue is measurable
    // rather than assumed away.
    const seen = new Uint8Array(lengthBytes);
    const claim = (from: number, len: number) => {
      for (let i = from; i < Math.min(from + len, lengthBytes); i++) seen[i] = 1;
    };
    claim(0, 6); // type, lengthWords, layer

    const words: number[] = [];
    for (let w = 0; w + 2 <= lengthBytes; w += 2) words.push(body.readUInt16LE(w));

    const rec: RawCadRecord = {
      offset: off,
      type,
      lengthBytes,
      layer: words[2] ?? 0,
      kind: "unknown",
      points: [],
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 0,
      words,
      unresolved: [],
    };

    if (type === POLYLINE_TYPE) {
      rec.kind = "polyline";
      rec.style = words[3];
      claim(6, 2);
      const nPoints = Math.floor((lengthWords - 4) / 2);
      for (let i = 0; i < nPoints; i++) {
        const at = 8 + i * 4;
        if (at + 4 > lengthBytes) break;
        rec.points.push({ x: body.readUInt16LE(at), y: body.readUInt16LE(at + 2) });
        claim(at, 4);
      }
      rec.unresolved.push("style");
    } else if (TWO_POINT_TYPES.has(type)) {
      rec.kind = "primitive2";
      rec.points.push({ x: words[3], y: words[4] }, { x: words[5], y: words[6] });
      claim(6, 8);
      // Types 2 and 3 share a layout but not, apparently, a meaning; the
      // primitive each one draws is not established.
      rec.unresolved.push("primitiveKind");
    } else if (type === THREE_POINT_TYPE) {
      rec.kind = "primitive3";
      rec.points.push(
        { x: words[3], y: words[4] },
        { x: words[5], y: words[6] },
        { x: words[7], y: words[8] }
      );
      claim(6, 12);
      // Three points are consistent with both an arc and a filled triangle;
      // the evidence does not distinguish them.
      rec.unresolved.push("primitiveKind");
    } else if (type === TEXT_TYPE) {
      rec.kind = "text";
      rec.x1 = words[3];
      rec.y1 = words[4];
      rec.x2 = words[5];
      rec.y2 = words[6];
      const raw = words[7] ?? 0;
      rec.textHeight = raw & 0x7fff;
      rec.textHeightFlag = (raw & 0x8000) !== 0;
      rec.rotation = words[8];
      rec.text = readPaddedText(body, 18, lengthBytes - 18);
      claim(6, 12);
      claim(18, lengthBytes - 18);
      if (rec.textHeightFlag) rec.unresolved.push("textHeightFlagBit15");
    } else if (SYMBOL_TYPES.has(type)) {
      rec.kind = "symbol";
      rec.x1 = words[3];
      rec.y1 = words[4];
      rec.x2 = words[5];
      rec.y2 = words[6];
      rec.symbolName = readPaddedText(body, 14, 8);
      rec.insertionX = words[11];
      rec.insertionY = words[12];
      rec.rotation = words[13];
      rec.flags = words[14];
      claim(6, 24); // bbox, name, insertion, rotation, flags

      if (type === 6) {
        rec.blockNumber = words[15];
        claim(30, 2);
      } else if (type === 8) {
        rec.tag = readPaddedText(body, 30, 30);
        rec.reference = readReference(body, 60);
        claim(30, 40);
      } else if (type === 7) {
        rec.entries = [];
        for (let at = 32, slot = 0; at + 40 <= lengthBytes; at += 40, slot++) {
          const reference = readReference(body, at);
          const tag = readPaddedText(body, at + 10, 30);
          claim(at, 40);
          if (!reference && !tag) continue;
          rec.entries.push({ slot, reference, tag });
        }
      } else if (type === 9) {
        // An 8-byte text slot that is blank in every observed record.
        rec.tag = readPaddedText(body, 30, 8);
        claim(30, 8);
      }
    }

    if (rec.kind === "unknown") {
      rec.text = readPaddedText(body, 6, lengthBytes - 6);
      rec.unresolved.push(`type${type}Layout`);
    }

    // Sweep: any non-zero value in a position the schema does not interpret is
    // kept with its offset and named, so nothing is silently dropped.
    const reserved: Array<{ at: number; value: number }> = [];
    for (let i = 0; i + 2 <= lengthBytes; i += 2) {
      if (seen[i] && seen[i + 1]) continue;
      const value = body.readUInt16LE(i);
      if (value === 0) {
        claim(i, 2);
        continue;
      }
      reserved.push({ at: i, value });
      rec.unresolved.push(`type${type}+${i}`);
      claim(i, 2);
    }
    if (reserved.length > 0) rec.reserved = reserved;

    // Whatever is still unaccounted for (odd trailing byte) is kept as hex.
    const residual: number[] = [];
    for (let i = 0; i < lengthBytes; i++) {
      if (!seen[i] && body[i] !== 0) residual.push(i);
    }
    if (residual.length > 0) {
      residualBytes += residual.length;
      rec.residualHex = residual
        .map((i) => `${i}:${body[i].toString(16).padStart(2, "0")}`)
        .join(" ");
    }

    records.push(rec);
    off = end;
  }

  return {
    records,
    diagnostics,
    clean,
    coverage: {
      totalBytes: buf.length,
      headerBytes: Math.min(recordsStart, buf.length),
      recordBytes,
      trailerBytes: trailerOffset == null ? 0 : buf.length - trailerOffset,
      residualBytes,
    },
  };
}
