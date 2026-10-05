import { KNOWN_CLASSES } from "../decoder/records";

/**
 * Submodel files shipped with the display are the same record stream as a
 * graphic, behind one of two headers:
 *
 * - `m1gms4u` — identical to a graphic.
 * - `!!<gms>` version 12 — a fixed pad, then a u32 preamble per record.
 * - `!!<gms>` version 8 — a u16 preamble per record.
 *
 * Both are rewritten to a standard graphic buffer so the existing decoder
 * applies unchanged. Record bodies are not modified.
 */
const GRAPHIC = "m1gms4u\n";
const GMS = "!!<gms>\n";
const KNOWN = new Set<string>(KNOWN_CLASSES);

export function normalizeSubmodel(buf: Buffer): Buffer {
  const magic = buf.toString("latin1", 0, Math.min(8, buf.length));
  if (magic === GRAPHIC) return buf;
  if (magic !== GMS) throw new Error(`not a graphic or submodel (magic ${JSON.stringify(magic)})`);
  const version = buf.length >= 12 ? buf.readUInt32LE(8) : 0;
  const modelAt = indexOfMarker(buf, "Model");
  if (modelAt < 0) throw new Error("submodel has no Model record");
  const body = version <= 8 ? expandU16Preambles(buf.subarray(modelAt - 2)) : buf.subarray(modelAt - 4);
  return wrapGraphic(body);
}

function wrapGraphic(body: Buffer): Buffer {
  const header = Buffer.alloc(20);
  header.write(GRAPHIC, 0, "latin1");
  header.writeUInt32LE(0x10, 8);
  header.writeUInt32LE(1, 12);
  return Buffer.concat([header, body]);
}

/** Version-8 records store the preamble as u16. Widen it to the u32 the decoder expects. */
function expandU16Preambles(body: Buffer): Buffer {
  const marks = markerOffsets(body);
  if (!marks.length) throw new Error("submodel record stream is empty");
  const parts: Buffer[] = [];
  for (let i = 0; i < marks.length; i++) {
    const nameAt = marks[i];
    if (nameAt < 2) continue;
    const pre = body.readUInt16LE(nameAt - 2);
    const end = i + 1 < marks.length ? marks[i + 1] - 2 : body.length;
    const pre32 = Buffer.alloc(4);
    pre32.writeUInt32LE(pre, 0);
    parts.push(pre32, body.subarray(nameAt, end));
  }
  return Buffer.concat(parts);
}

function markerOffsets(buf: Buffer): number[] {
  const out: number[] = [];
  const s = buf.toString("latin1");
  const re = /([A-Za-z_][A-Za-z0-9_]{0,63})\+\0/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (!KNOWN.has(m[1])) continue;
    if (m.index >= 1 && /[0-9A-Za-z_]/.test(s[m.index - 1])) continue;
    out.push(m.index);
  }
  return out;
}

function indexOfMarker(buf: Buffer, name: string): number {
  const needle = `${name}+\0`;
  let from = 0;
  for (;;) {
    const at = buf.indexOf(needle, from);
    if (at < 0) return -1;
    if (at < 1 || !/[0-9A-Za-z_]/.test(String.fromCharCode(buf[at - 1]))) return at;
    from = at + 1;
  }
}
