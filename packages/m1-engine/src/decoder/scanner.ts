import crypto from "node:crypto";
import { FieldReader } from "../binary/reader";
import { KNOWN_CLASSES, getDecoder } from "./records";
import type {
  CoverageGap,
  CoverageReport,
  DecodedM1,
  M1Header,
  M1Record,
  MarkerCandidate,
} from "./types";

/**
 * 1.0.0 initial record decoders
 * 1.1.0 G_TRect_30 text prefix u32; header slot 0 decoded as dynPropRef (RULE-HDR-002)
 */
export const DECODER_REVISION = "m1-decoder/1.1.0";

export const M1_MAGIC = "m1gms4u\n";
export const HEADER_LENGTH = 20;
const KNOWN = new Set<string>(KNOWN_CLASSES);
const MARKER_RE = /[A-Za-z_][A-Za-z0-9_]{0,63}\+\0/g;

export class CoverageError extends Error {
  constructor(
    readonly file: string,
    readonly gaps: CoverageGap[]
  ) {
    super(
      `${file}: binary coverage incomplete — ${gaps
        .map((g) => `${g.kind} 0x${g.start.toString(16)}..0x${g.end.toString(16)}`)
        .join(", ")}`
    );
  }
}

function decodeHeader(buf: Buffer): M1Header {
  const r = new FieldReader(buf, 0, Math.min(HEADER_LENGTH, buf.length));
  const magicField = r.bytes("magic", 8, "KNOWN", "format signature");
  const magic = buf.toString("latin1", 0, 8);
  magicField.value = magic;
  if (magic !== M1_MAGIC) {
    throw new Error(`not an M1 graphic: magic ${JSON.stringify(magic)}`);
  }
  r.u32("header.u32_0", "UNRESOLVED", "0x10 in every supplied file");
  r.u32("header.u32_1", "UNRESOLVED", "1 in every supplied file");
  r.u32("header.u32_2", "UNRESOLVED", "0 in every supplied file");
  return { offset: 0, length: HEADER_LENGTH, magic, fields: r.fields };
}

/**
 * Candidate record starts: "<Identifier>+\0" preceded by a u32 preamble.
 * Only known record families become boundaries on their own; every other
 * candidate is reported (and accepted only if it falls in bytes that no
 * decoder explained).
 */
function findMarkers(buf: Buffer): { offset: number; name: string }[] {
  const s = buf.toString("latin1");
  const out: { offset: number; name: string }[] = [];
  MARKER_RE.lastIndex = HEADER_LENGTH;
  let m: RegExpExecArray | null;
  while ((m = MARKER_RE.exec(s))) {
    if (m.index < HEADER_LENGTH + 4) continue;
    if (buf[m.index - 1] !== 0 && buf[m.index - 1] !== undefined) {
      const prev = buf[m.index - 1];
      if ((prev >= 0x30 && prev <= 0x39) || (prev >= 0x41 && prev <= 0x5a) || (prev >= 0x61 && prev <= 0x7a) || prev === 0x5f) {
        continue;
      }
    }
    out.push({ offset: m.index, name: m[0].slice(0, -2) });
  }
  return out;
}

function decodeRecord(
  buf: Buffer,
  index: number,
  start: number,
  end: number,
  className: string
): M1Record {
  const r = new FieldReader(buf, start, end);
  const preamble = r.u32(
    "preamble",
    className === "PtArray" ? "KNOWN" : "CANDIDATE",
    className === "PtArray" ? "2 × point count" : "0 for every non-array record"
  );
  r.cstr("className", "KNOWN", "record family marker");
  const known = KNOWN.has(className);
  const rec: M1Record = {
    index,
    id: index + 1,
    offset: start,
    endOffset: end,
    length: end - start,
    className,
    known,
    recordType: known ? className : "UNKNOWN_RECORD",
    fields: r.fields,
    refs: [],
    unresolvedBytes: 0,
    decoded: {},
  };
  const decoder = getDecoder(className);
  if (decoder) {
    const mark = r.fields.length;
    const pos = r.pos;
    try {
      const res = decoder(r, { preamble });
      rec.decoded = res.decoded;
      rec.refs = res.refs;
      r.rest("unresolved_tail");
    } catch (e) {
      rec.decodeError = e instanceof Error ? e.message : String(e);
      r.fields.splice(mark);
      r.pos = pos;
      r.rest("undecoded_body", `decoder failed: ${rec.decodeError}`);
    }
  } else {
    r.rest("unknown_body", "no decoder for this record family");
  }
  rec.unresolvedBytes = r.fields
    .filter((f) => f.status === "UNRESOLVED" && f.type === "bytes")
    .reduce((n, f) => n + f.length, 0);
  return rec;
}

function verifyCoverage(size: number, header: M1Header, records: M1Record[]): CoverageReport {
  const gaps: CoverageGap[] = [];
  let cursor = header.length;
  for (const r of records) {
    if (r.offset > cursor) gaps.push({ kind: "gap", start: cursor, end: r.offset });
    if (r.offset < cursor) gaps.push({ kind: "overlap", start: r.offset, end: cursor });
    cursor = r.endOffset;
  }
  if (cursor < size) gaps.push({ kind: "gap", start: cursor, end: size });
  if (cursor > size) gaps.push({ kind: "overlap", start: size, end: cursor });

  let typedBytes = 0;
  let unresolvedBytes = 0;
  let recordsWithUnresolved = 0;
  const fieldGaps: CoverageReport["fieldLevel"]["fieldGaps"] = [];
  for (const r of records) {
    let c = r.offset;
    for (const f of r.fields) {
      if (f.offset !== c) fieldGaps.push({ recordIndex: r.index, start: c, end: f.offset });
      c = f.offset + f.length;
      if (f.type === "bytes" && f.status === "UNRESOLVED") unresolvedBytes += f.length;
      else typedBytes += f.length;
    }
    if (c !== r.endOffset) fieldGaps.push({ recordIndex: r.index, start: c, end: r.endOffset });
    if (r.unresolvedBytes > 0) recordsWithUnresolved++;
  }
  const recordBytes = records.reduce((n, r) => n + r.length, 0);
  return {
    fileSize: size,
    headerBytes: header.length,
    recordBytes,
    coveredBytes: header.length + recordBytes,
    ok: gaps.length === 0 && fieldGaps.length === 0 && header.length + recordBytes === size,
    gaps,
    fieldLevel: { typedBytes, unresolvedBytes, recordsWithUnresolved, fieldGaps },
  };
}

export interface DecodeOptions {
  /** Throw CoverageError when coverage fails (default true). */
  strict?: boolean;
}

export function decodeM1(buf: Buffer, file: string, opts: DecodeOptions = {}): DecodedM1 {
  const strict = opts.strict ?? true;
  const header = decodeHeader(buf);
  const candidates = findMarkers(buf);

  const boundaries = candidates.filter((c) => KNOWN.has(c.name));
  const markerCandidates: MarkerCandidate[] = [];

  // First pass: decode between known boundaries.
  const firstPass = boundaries.map((b, i) => {
    const start = b.offset - 4;
    const end = i + 1 < boundaries.length ? boundaries[i + 1].offset - 4 : buf.length;
    return { start, end, name: b.name };
  });

  // Unknown candidates inside bytes that a known decoder could not explain
  // become UNKNOWN_RECORD boundaries; candidates inside typed fields are rejected.
  const probe = firstPass.map((seg, i) => decodeRecord(buf, i, seg.start, seg.end, seg.name));
  const extraStarts: { start: number; name: string }[] = [];
  for (const c of candidates) {
    if (KNOWN.has(c.name)) {
      markerCandidates.push({ offset: c.offset, name: c.name, accepted: true, reason: "known record family" });
      continue;
    }
    const owner = probe.find((p) => c.offset >= p.offset && c.offset < p.endOffset);
    const field = owner?.fields.find((f) => c.offset >= f.offset && c.offset < f.offset + f.length);
    if (field && !(field.type === "bytes" && field.status === "UNRESOLVED")) {
      markerCandidates.push({
        offset: c.offset,
        name: c.name,
        accepted: false,
        reason: `inside decoded field ${owner!.className}#${owner!.id}.${field.name} (${field.type})`,
      });
    } else {
      markerCandidates.push({
        offset: c.offset,
        name: c.name,
        accepted: true,
        reason: "marker in unexplained bytes — treated as UNKNOWN_RECORD",
      });
      extraStarts.push({ start: c.offset - 4, name: c.name });
    }
  }

  let records = probe;
  if (extraStarts.length) {
    const merged = [
      ...firstPass.map((s) => ({ start: s.start, name: s.name, extra: false })),
      ...extraStarts.map((s) => ({ ...s, extra: true })),
    ].sort((a, b) => a.start - b.start);
    // A record cannot begin inside the preamble + "<name>+\0" of the record
    // before it. Known boundaries win over UNKNOWN_RECORD candidates.
    const headerEnd = (s: { start: number; name: string }) => s.start + 4 + s.name.length + 2;
    const starts: typeof merged = [];
    const rejectOverlap = (s: { start: number; name: string }, over: { start: number; name: string }) => {
      const mc = markerCandidates.find((m) => m.offset === s.start + 4 && m.name === s.name);
      if (mc) {
        mc.accepted = false;
        mc.reason = `implied record start overlaps the header of ${over.name} @0x${(over.start + 4).toString(16)}`;
      }
    };
    for (const s of merged) {
      const prev = starts[starts.length - 1];
      if (prev && s.start < headerEnd(prev) && (s.extra || prev.extra)) {
        if (s.extra) {
          rejectOverlap(s, prev);
          continue;
        }
        rejectOverlap(prev, s);
        starts.pop();
      }
      starts.push(s);
    }
    records = starts.map((s, i) =>
      decodeRecord(buf, i, s.start, i + 1 < starts.length ? starts[i + 1].start : buf.length, s.name)
    );
  }

  const coverage = verifyCoverage(buf.length, header, records);
  if (strict) {
    const residual: CoverageGap[] = records.flatMap((r) =>
      r.fields.filter((f) => f.type === "bytes" && f.status === "UNRESOLVED").map((f) => ({ kind: "gap" as const, start: f.offset, end: f.offset + f.length }))
    );
    if (coverage.gaps.length || residual.length) throw new CoverageError(file, [...coverage.gaps, ...residual]);
  }

  return {
    file,
    size: buf.length,
    sha256: crypto.createHash("sha256").update(buf).digest("hex"),
    header,
    records,
    coverage,
    markerCandidates,
    decoderRevision: DECODER_REVISION,
  };
}
