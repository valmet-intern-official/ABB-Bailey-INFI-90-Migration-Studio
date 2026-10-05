/**
 * `.LBR` symbol library decoder — CONFIRMED.
 *
 * CAD sheets reference symbols by an 8-character name only; the drawn shape
 * lives in the library named at CAD header offset 0x090.
 *
 * File layout. The file is a sequence of 512-byte blocks. Directory blocks
 * are recognised by their 16-byte header, whose word 6 is 1 and word 7 is the
 * entry count (1..31); entries follow at a 16-byte stride:
 *   +0  char[8] name
 *   +8  uint16  block      1-based 512-byte block number
 *   +10 uint16  word       1-based word index within that block
 *   +12 uint16  = 6
 *   +14 uint16  lengthWords
 * so the body starts at byte (block - 1) * 512 + (word - 1) * 2.
 *
 * Symbol body:
 *   +0  uint16  = 9
 *   +2  uint16  = 6
 *   +4  uint16  headerWords   (17)
 *   +6  uint16  streamWords   headerWords + streamWords = lengthWords
 *   +8  x1 y1 x2 y2           definition bounding box
 *   +16 char[8] name
 *   +24 uint16  insertionX
 *   +26 uint16  insertionY
 *   then a record stream in exactly the `.CAD` record grammar
 *   (1 polyline, 2/3 two-point, 4 arc, 5 text, 9 nested symbol instance).
 *
 * Validation: every body in every library in the archive chains exactly to
 * its declared length (7107LIB1 186/186, SAMA 133/133, ...). A wrong address
 * unit or header size desynchronises within one record, so this is a
 * mechanical confirmation. Placing the `DBORDH` definition by the translation
 * (instance insertion - definition insertion) reproduces the CAD instance
 * bounding box exactly.
 */
import { decodeRecordRange, type RawCadRecord } from "../records/decode";

const BLOCK = 512;

export interface LbrSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface LbrSymbol {
  name: string;
  /** Source library file name. */
  library: string;
  /** Byte offset of the body — provenance for every primitive. */
  offset: number;
  lengthWords: number;
  bbox: { x1: number; y1: number; x2: number; y2: number };
  insertionX: number;
  insertionY: number;
  /** Body records, decoded with the CAD record grammar, in definition space. */
  records: RawCadRecord[];
  /** True when the body's record chain consumed exactly `lengthWords`. */
  clean: boolean;
  /** Straight segments of type 1 records, kept for older callers. */
  segments: LbrSegment[];
  /** Names of nested symbol instances. */
  references: string[];
}

export interface LbrLibrary {
  name: string;
  symbols: Map<string, LbrSymbol>;
  directoryEntries: number;
  /** Bodies whose record chain did not end exactly on the declared length. */
  uncleanBodies: string[];
}

function readName(buf: Buffer, at: number): string | null {
  if (at + 8 > buf.length) return null;
  const raw = buf.subarray(at, at + 8).toString("latin1");
  if (!/^[\x20-\x7E]{8}$/.test(raw)) return null;
  const t = raw.trim();
  return t.length > 0 ? t : null;
}

/** Every directory entry, from every directory block. */
export function readLbrDirectory(
  buf: Buffer
): Array<{ name: string; offset: number; lengthWords: number; directoryAt: number }> {
  const out: Array<{ name: string; offset: number; lengthWords: number; directoryAt: number }> = [];
  for (let base = BLOCK; base + 16 <= buf.length; base += BLOCK) {
    const count = buf.readUInt16LE(base + 14);
    if (buf.readUInt16LE(base + 12) !== 1 || count < 1 || count > 31) continue;
    const local: typeof out = [];
    let ok = true;
    for (let i = 0; i < count; i++) {
      const at = base + 16 + i * 16;
      const name = readName(buf, at);
      if (!name || buf.readUInt16LE(at + 12) !== 6) {
        ok = false;
        break;
      }
      const block = buf.readUInt16LE(at + 8);
      const word = buf.readUInt16LE(at + 10);
      const lengthWords = buf.readUInt16LE(at + 14);
      const offset = (block - 1) * BLOCK + (word - 1) * 2;
      if (block < 1 || word < 1 || offset + lengthWords * 2 > buf.length) {
        ok = false;
        break;
      }
      local.push({ name, offset, lengthWords, directoryAt: at });
    }
    if (ok) out.push(...local);
  }
  return out;
}

export function parseLbrLibrary(buf: Buffer, name: string): LbrLibrary {
  const symbols = new Map<string, LbrSymbol>();
  const uncleanBodies: string[] = [];
  const dir = readLbrDirectory(buf);
  for (const e of dir) {
    const h = e.offset;
    const headerWords = buf.readUInt16LE(h + 4);
    const streamWords = buf.readUInt16LE(h + 6);
    const end = h + e.lengthWords * 2;
    const { records, clean } = decodeRecordRange(buf, h + headerWords * 2, end);
    const consumed = records.length
      ? records[records.length - 1].offset + records[records.length - 1].lengthBytes
      : h + headerWords * 2;
    const exact = clean && headerWords + streamWords === e.lengthWords && consumed === end;
    if (!exact) uncleanBodies.push(e.name);
    symbols.set(e.name.toUpperCase(), {
      name: e.name,
      library: name,
      offset: h,
      lengthWords: e.lengthWords,
      bbox: {
        x1: buf.readUInt16LE(h + 8),
        y1: buf.readUInt16LE(h + 10),
        x2: buf.readUInt16LE(h + 12),
        y2: buf.readUInt16LE(h + 14),
      },
      insertionX: buf.readUInt16LE(h + 24),
      insertionY: buf.readUInt16LE(h + 26),
      records,
      clean: exact,
      segments: records
        .filter((r) => r.kind === "polyline")
        .flatMap((r) =>
          r.points.slice(1).map((p, i) => ({ x1: r.points[i].x, y1: r.points[i].y, x2: p.x, y2: p.y }))
        ),
      references: [
        ...new Set(records.filter((r) => r.kind === "symbol" && r.symbolName).map((r) => r.symbolName!)),
      ],
    });
  }
  return { name, symbols, directoryEntries: dir.length, uncleanBodies };
}

/** Several libraries searched as one registry, first library wins. */
export class SymbolRegistry {
  private readonly byName = new Map<string, LbrSymbol>();
  readonly libraries: string[] = [];

  add(lib: LbrLibrary) {
    this.libraries.push(lib.name);
    for (const [key, sym] of lib.symbols) {
      if (!this.byName.has(key)) this.byName.set(key, sym);
    }
  }

  get(name: string | undefined): LbrSymbol | undefined {
    if (!name) return undefined;
    return this.byName.get(name.trim().toUpperCase());
  }

  has(name: string | undefined): boolean {
    return this.get(name) !== undefined;
  }

  get size(): number {
    return this.byName.size;
  }

  /** Symbols whose body chained exactly. */
  get drawable(): number {
    let n = 0;
    for (const s of this.byName.values()) if (s.clean) n++;
    return n;
  }
}
