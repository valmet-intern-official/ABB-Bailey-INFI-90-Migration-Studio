/**
 * Trailer decoder — the `BCCo SPC LIST` function-block specification table.
 *
 * The trailer is 6.92% of every `.CAD` file and carries the engineering data
 * the record stream does not: each configured function block's Bailey block
 * address, its numeric function code, and its S1..Sn specification values.
 * The vendor's plot draws exactly these values, which is how the layout was
 * established.
 *
 * Layout — CONFIRMED by length chaining. Each entry's length walks the list
 * and lands exactly on the following `BCCo ATR LIST` token:
 *
 *   "BCCo" C5 "SPC" C5 "LIST"      13 bytes
 *   ... 15 bytes of section header ...
 *   entries:
 *     +0  uint16  lengthWords   entry size in 16-bit words
 *     +2  uint16  blockNumber   Bailey block address
 *     +4  uint16  functionCode  numeric FC, e.g. 82, 90, 12, 35, 33
 *     +6  ...     payload       specification values
 *
 * Worked example, `2061000A.CAD`, matching the reference plot exactly:
 *   len=28 block=15   fc=82     len=12 block=20   fc=90
 *   len=28 block=1024 fc=82     len=8  block=1050 fc=12
 *   len=28 block=9000 fc=82     len=7  block=1055 fc=35
 *                               len=4  block=1056 fc=33
 *
 * The payload holds IEEE-754 float32 values (1.0, 60.0, 0.25, 0.1 observed).
 * Their index-to-Sn assignment is NOT established, so they are reported as
 * ordered candidates with the raw bytes retained rather than being labelled
 * S1..Sn on a guess.
 *
 * The gap between the section token and the first entry is NOT a fixed size.
 * A fixed 15 bytes fits some files and desynchronises 89% of the archive, so
 * it is recovered per file by constraint: the only acceptable offset is one
 * whose length chain terminates exactly on the next section token. That is a
 * hard, self-validating condition, not a preference.
 */

const SPC_TOKEN = Buffer.from("BCCo\xC5SPC\xC5LIST", "latin1");
const ATR_TOKEN = Buffer.from("BCCo\xC5ATR\xC5LIST", "latin1");
const END_TOKEN = Buffer.from("END\xC5CAD\xC5FILE", "latin1");
/** Largest section-header gap to consider when solving for alignment. */
const MAX_SECTION_HEADER = 96;
/** Bailey block addresses and function codes both live in sane ranges. */
const MAX_BLOCK = 9999;
const MAX_FC = 250;

/**
 * One 4-byte specification slot.
 *
 * The payload is not uniformly float32: 44.7% of slots are zero and 34.8%
 * decode as denormal floats, while the vendor's plot shows integer
 * specifications such as 20..29. The encoding therefore varies by function
 * code in a way that is not yet established, so every reading is preserved and
 * the ambiguity is marked rather than resolved by preference.
 */
export interface SpecCandidate {
  /** Ordinal position in the payload, 0-based. */
  index: number;
  /** Byte offset within the file. */
  offset: number;
  /** Payload bytes read as a little-endian float32. */
  float: number;
  /** The same bytes read as two little-endian uint16 values. */
  words: [number, number];
  /** The same bytes read as one little-endian uint32. */
  uint32: number;
  /** The same bytes as hex, so nothing is lost to interpretation. */
  raw: string;
  /**
   * Which reading looks physically plausible. `ambiguous` means more than one
   * reading is defensible and the caller must not assume either.
   */
  likely: "zero" | "float" | "integer" | "ambiguous";
}

function classifySlot(float: number, words: [number, number], u32: number): SpecCandidate["likely"] {
  if (u32 === 0) return "zero";
  const absF = Math.abs(float);
  const floatPlausible = Number.isFinite(float) && absF >= 1e-4 && absF < 1e9;
  // Bailey specifications are small counts, times and engineering ranges.
  const intPlausible = words[1] === 0 && words[0] > 0 && words[0] <= 30000;
  if (floatPlausible && intPlausible) return "ambiguous";
  if (floatPlausible) return "float";
  if (intPlausible) return "integer";
  return "ambiguous";
}

export interface BlockSpecification {
  /** Byte offset of the entry — provenance. */
  offset: number;
  lengthBytes: number;
  blockNumber: number;
  /** Numeric Bailey function code, decoded from source. */
  functionCode: number;
  /** Ordered specification value candidates. */
  specs: SpecCandidate[];
  /** Payload bytes not consumed as a whole float32. */
  residualHex?: string;
}

export interface DecodedTrailer {
  present: boolean;
  spcOffset: number | null;
  atrOffset: number | null;
  endOffset: number | null;
  specifications: BlockSpecification[];
  /** True when the entry chain ended exactly on the next section token. */
  chainClean: boolean;
  /** Solved gap between the section token and the first entry. */
  sectionHeaderBytes: number | null;
  diagnostics: string[];
  /** Trailer bytes not accounted for by a decoded structure. */
  unexplainedBytes: number;
}

export function decodeTrailer(buf: Buffer): DecodedTrailer {
  const spcOffset = buf.indexOf(SPC_TOKEN);
  const atrOffset = buf.indexOf(ATR_TOKEN);
  const endOffset = buf.indexOf(END_TOKEN);
  const diagnostics: string[] = [];

  if (spcOffset === -1) {
    return {
      present: false,
      spcOffset: null,
      atrOffset: atrOffset === -1 ? null : atrOffset,
      endOffset: endOffset === -1 ? null : endOffset,
      specifications: [],
      chainClean: false,
      sectionHeaderBytes: null,
      diagnostics: ["TRAILER_NO_SPC_LIST"],
      unexplainedBytes: 0,
    };
  }

  // Entries run until the next section token, whichever comes first.
  const stop =
    atrOffset > spcOffset
      ? atrOffset
      : endOffset > spcOffset
        ? endOffset
        : buf.length;

  /**
   * Walk the entry chain from `from`. Returns the entries and whether the
   * walk finished exactly on `stop`, which is the acceptance condition.
   */
  const walk = (
    from: number
  ): { entries: BlockSpecification[]; clean: boolean; end: number; sane: number } => {
    const entries: BlockSpecification[] = [];
    let off = from;
    let sane = 0;
    while (off + 6 <= stop) {
      const lengthWords = buf.readUInt16LE(off);
      const lengthBytes = lengthWords * 2;
      if (lengthWords < 3 || off + lengthBytes > stop) break;

      const blockNumber = buf.readUInt16LE(off + 2);
      const functionCode = buf.readUInt16LE(off + 4);
      if (blockNumber >= 1 && blockNumber <= MAX_BLOCK && functionCode <= MAX_FC) sane++;

      const specs: SpecCandidate[] = [];
      let at = off + 6;
      let index = 0;
      while (at + 4 <= off + lengthBytes) {
        const slice = buf.subarray(at, at + 4);
        const float = slice.readFloatLE(0);
        const words: [number, number] = [slice.readUInt16LE(0), slice.readUInt16LE(2)];
        const uint32 = slice.readUInt32LE(0);
        specs.push({
          index,
          offset: at,
          float,
          words,
          uint32,
          raw: slice.toString("hex"),
          likely: classifySlot(float, words, uint32),
        });
        at += 4;
        index++;
      }
      const tailBytes = off + lengthBytes - at;

      entries.push({
        offset: off,
        lengthBytes,
        blockNumber,
        functionCode,
        specs,
        residualHex:
          tailBytes > 0 ? buf.subarray(at, off + lengthBytes).toString("hex") : undefined,
      });

      off += lengthBytes;
      if (off === stop) return { entries, clean: true, end: off, sane };
    }
    return { entries, clean: false, end: off, sane };
  };

  // Solve for the section-header size: accept only an offset whose chain
  // closes exactly on the next section token. Among those, prefer the one
  // whose entries carry the most plausible block/FC values, then the earliest.
  let best: { from: number; result: ReturnType<typeof walk> } | null = null;
  const firstPossible = spcOffset + SPC_TOKEN.length;
  for (let h = 0; h <= MAX_SECTION_HEADER; h += 1) {
    const from = firstPossible + h;
    if (from + 6 > stop) break;
    const r = walk(from);
    if (!r.clean || r.entries.length === 0) continue;
    if (
      !best ||
      r.sane > best.result.sane ||
      (r.sane === best.result.sane && r.entries.length > best.result.entries.length)
    ) {
      best = { from, result: r };
    }
  }

  if (!best) {
    // No alignment closes the chain; report rather than emit dubious entries.
    diagnostics.push(
      `TRAILER_SPC_UNALIGNED: no section-header size in 0..${MAX_SECTION_HEADER} closes the entry chain`
    );
    return {
      present: true,
      spcOffset,
      atrOffset: atrOffset === -1 ? null : atrOffset,
      endOffset: endOffset === -1 ? null : endOffset,
      specifications: [],
      chainClean: false,
      sectionHeaderBytes: null,
      diagnostics,
      unexplainedBytes: Math.max(0, stop - firstPossible),
    };
  }

  return {
    present: true,
    spcOffset,
    atrOffset: atrOffset === -1 ? null : atrOffset,
    endOffset: endOffset === -1 ? null : endOffset,
    specifications: best.result.entries,
    chainClean: true,
    sectionHeaderBytes: best.from - firstPossible,
    diagnostics,
    unexplainedBytes: 0,
  };
}

/** Index specifications by Bailey block address. */
export function specificationsByBlock(
  t: DecodedTrailer
): Map<number, BlockSpecification> {
  const out = new Map<number, BlockSpecification>();
  for (const s of t.specifications) {
    // Later entries win only if the earlier one carried no payload.
    const prev = out.get(s.blockNumber);
    if (!prev || prev.specs.length < s.specs.length) out.set(s.blockNumber, s);
  }
  return out;
}
