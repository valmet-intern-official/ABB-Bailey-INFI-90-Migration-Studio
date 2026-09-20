/**
 * `.LBR` symbol library decoder.
 *
 * CAD sheets reference symbols by an 8-character name only; the drawn shape
 * lives in the library. Decoding it is what lets the renderer draw authentic
 * engineering symbols instead of bounding boxes.
 *
 * Directory — CONFIRMED. Entries run at a fixed 16-byte stride from +528:
 *   +0  char[8] name
 *   +8  uint16  offsetHi     body offset = offsetHi * 256 + offsetLo
 *   +10 uint16  offsetLo
 *   +12 uint16  = 6
 *   +14 uint16  length       body length in bytes
 * Verified by chaining: every entry's offset equals the previous entry's
 * offset plus its length, with zero breaks across every library.
 *
 * Bodies are a variable-length primitive stream, so they are NOT a fixed
 * stride (a `BOX2` body even embeds a nested `TITLE` symbol reference). The
 * line primitive is confirmed as a 16-byte record:
 *   +0 x1  +2 y1  +4 x2  +6 y2  then the literal bytes 01 00 08 00 02 00 00 00
 *
 * UNRESOLVED — the unit of the directory offset/length fields.
 * Read as bytes, the directory region (528..1024) overlaps the first body
 * offset (769), which is impossible. Read as 16-bit words, `BAI` and `LEY`
 * (the two halves of the Bailey logo) decode to 85 and 87 segments covering
 * 70% and 79% of their bodies — strong evidence — but `LINE`, `BOX1` and
 * `BOX2` then yield nothing, while at byte offsets those same three produce
 * perfectly formed primitives. Neither reading explains every entry, so
 * `segments` is reported as EXPERIMENTAL and callers must not treat it as
 * authoritative symbol geometry. Consumers should rely on the confirmed
 * per-instance bounding box from the CAD record instead, which is exact.
 */

const DIR_START = 528;
const DIR_STRIDE = 16;
/** Trailing descriptor that marks a 16-byte line primitive. */
const LINE_SIGNATURE = Buffer.from([0x01, 0x00, 0x08, 0x00, 0x02, 0x00, 0x00, 0x00]);

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
  /** Byte offset of the body — provenance for every extracted segment. */
  offset: number;
  length: number;
  /**
   * EXPERIMENTAL. Line primitives found by signature scan. The body offset
   * unit is unresolved (see the file header), so these are not authoritative
   * and must not be used to draw symbols.
   */
  segments: LbrSegment[];
  /** Extent of the extracted geometry in the library's coordinate space. */
  extent?: { minX: number; minY: number; maxX: number; maxY: number };
  /** Body bytes not accounted for by the line primitive. */
  undecodedBytes: number;
  /** Names of symbols this body references, when detectable. */
  references: string[];
}

export interface LbrLibrary {
  name: string;
  symbols: Map<string, LbrSymbol>;
  /** Directory entries whose offset did not chain from the previous entry. */
  chainBreaks: number;
}

function readName(buf: Buffer, at: number): string | null {
  if (at + 8 > buf.length) return null;
  const raw = buf.subarray(at, at + 8).toString("latin1");
  if (!/^[\x20-\x7E]{8}$/.test(raw)) return null;
  const t = raw.trim();
  return t.length > 0 ? t : null;
}

/** Parse the symbol directory. */
export function readLbrDirectory(
  buf: Buffer
): Array<{ name: string; offset: number; length: number }> {
  const out: Array<{ name: string; offset: number; length: number }> = [];
  for (let at = DIR_START; at + DIR_STRIDE <= buf.length; at += DIR_STRIDE) {
    const name = readName(buf, at);
    if (!name) break;
    const hi = buf.readUInt16LE(at + 8);
    const lo = buf.readUInt16LE(at + 10);
    const length = buf.readUInt16LE(at + 14);
    const offset = hi * 256 + lo;
    if (offset + length > buf.length) break;
    out.push({ name, offset, length });
  }
  return out;
}

/** Extract every confirmed line primitive from a symbol body. */
function extractSegments(body: Buffer): {
  segments: LbrSegment[];
  undecodedBytes: number;
  references: string[];
} {
  const segments: LbrSegment[] = [];
  const claimed = new Uint8Array(body.length);
  const references: string[] = [];

  // A line primitive is identified by its trailing descriptor, which makes the
  // scan robust to the variable-length records interleaved around it.
  for (let at = 0; at + 16 <= body.length; at += 2) {
    if (!body.subarray(at + 8, at + 16).equals(LINE_SIGNATURE)) continue;
    segments.push({
      x1: body.readUInt16LE(at),
      y1: body.readUInt16LE(at + 2),
      x2: body.readUInt16LE(at + 4),
      y2: body.readUInt16LE(at + 6),
    });
    for (let i = at; i < at + 16; i++) claimed[i] = 1;
    at += 14; // continue past this primitive
  }

  // Nested symbol references show up as 8-byte padded names in the body.
  for (let at = 0; at + 8 <= body.length; at += 2) {
    if (claimed[at]) continue;
    const n = readName(body, at);
    if (n && /^[A-Z][A-Z0-9/_.\-+=()#]*$/i.test(n)) references.push(n);
  }

  let undecoded = 0;
  for (let i = 0; i < body.length; i++) if (!claimed[i]) undecoded++;

  return { segments, undecodedBytes: undecoded, references: [...new Set(references)] };
}

export function parseLbrLibrary(buf: Buffer, name: string): LbrLibrary {
  const dir = readLbrDirectory(buf);
  const symbols = new Map<string, LbrSymbol>();
  let chainBreaks = 0;

  for (let i = 0; i < dir.length; i++) {
    const e = dir[i];
    if (i > 0 && e.offset !== dir[i - 1].offset + dir[i - 1].length) chainBreaks++;

    const body = buf.subarray(e.offset, e.offset + e.length);
    const { segments, undecodedBytes, references } = extractSegments(body);

    let extent: LbrSymbol["extent"];
    if (segments.length > 0) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const s of segments) {
        minX = Math.min(minX, s.x1, s.x2);
        minY = Math.min(minY, s.y1, s.y2);
        maxX = Math.max(maxX, s.x1, s.x2);
        maxY = Math.max(maxY, s.y1, s.y2);
      }
      extent = { minX, minY, maxX, maxY };
    }

    symbols.set(e.name.toUpperCase(), {
      name: e.name,
      library: name,
      offset: e.offset,
      length: e.length,
      segments,
      extent,
      undecodedBytes,
      references,
    });
  }

  return { name, symbols, chainBreaks };
}

/** Several libraries searched as one registry. */
export class SymbolRegistry {
  private readonly byName = new Map<string, LbrSymbol>();
  readonly libraries: string[] = [];

  add(lib: LbrLibrary) {
    this.libraries.push(lib.name);
    for (const [key, sym] of lib.symbols) {
      const existing = this.byName.get(key);
      // Prefer the definition that actually yielded geometry.
      if (!existing || existing.segments.length < sym.segments.length) {
        this.byName.set(key, sym);
      }
    }
  }

  get(name: string | undefined): LbrSymbol | undefined {
    if (!name) return undefined;
    return this.byName.get(name.trim().toUpperCase());
  }

  get size(): number {
    return this.byName.size;
  }

  /** Symbols that yielded at least one confirmed segment. */
  get drawable(): number {
    let n = 0;
    for (const s of this.byName.values()) if (s.segments.length > 0) n++;
    return n;
  }
}
