/** Shared file discovery + raw record walking for the forensic tools. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// `apps/web/data` holds the running app's upload + extraction scratch space,
// which is full of byte-identical copies of the real source material.
const SKIP =
  /(^|[\\/])(node_modules|\.next|\.git|out|dist)([\\/]|$)|(^|[\\/])apps[\\/]web[\\/]data([\\/]|$)/i;

/** The authoritative source material, deduplicated by content. */
export const CORPUS_ROOTS = ["Raw Data from Controller", "Input", "fixtures"];

/** Every unique .CAD file in the supplied input material. */
export function cadCorpus(): string[] {
  const seen = new Map<string, string>();
  for (const root of CORPUS_ROOTS) {
    if (!fs.existsSync(root)) continue;
    for (const f of findFiles(root, /\.CAD$/i)) {
      const h = crypto.createHash("sha1").update(fs.readFileSync(f)).digest("hex");
      // Keep the first path seen; roots are ordered most-authoritative first.
      if (!seen.has(h)) seen.set(h, f);
    }
  }
  return [...seen.values()].sort();
}

export function lbrCorpus(): string[] {
  const seen = new Map<string, string>();
  for (const root of CORPUS_ROOTS) {
    if (!fs.existsSync(root)) continue;
    for (const f of findFiles(root, /\.LBR$/i)) {
      const h = crypto.createHash("sha1").update(fs.readFileSync(f)).digest("hex");
      if (!seen.has(h)) seen.set(h, f);
    }
  }
  return [...seen.values()].sort();
}

export function findFiles(root: string, ext: RegExp): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (SKIP.test(full)) continue;
      if (e.isDirectory()) walk(full);
      else if (ext.test(e.name)) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

export const HEADER_SIZE = 256;
const TRAILER_TOKEN = Buffer.from("BCCo\xC5", "latin1");

export interface RawRecord {
  offset: number;
  type: number;
  lengthWords: number;
  lengthBytes: number;
  words: number[];
  /** Raw bytes of the whole record, for byte-level accounting. */
  bytes: Buffer;
}

export interface WalkResult {
  records: RawRecord[];
  recordsStart: number;
  recordsEnd: number;
  trailerOffset: number | null;
  /** Bytes skipped as inter-record NUL padding. */
  paddingBytes: number;
  desyncAt: number | null;
}

export function walkRecords(buf: Buffer): WalkResult {
  const idx = buf.indexOf(TRAILER_TOKEN, HEADER_SIZE);
  const recordsEnd = idx === -1 ? buf.length : idx;
  const records: RawRecord[] = [];
  let paddingBytes = 0;
  let desyncAt: number | null = null;
  let off = HEADER_SIZE;

  while (off + 4 <= recordsEnd) {
    if (buf.readUInt16LE(off) === 0) {
      off += 2;
      paddingBytes += 2;
      continue;
    }
    const type = buf.readUInt16LE(off);
    const lengthWords = buf.readUInt16LE(off + 2);
    const lengthBytes = lengthWords * 2;
    if (lengthWords < 4 || off + lengthBytes > recordsEnd) {
      desyncAt = off;
      break;
    }
    const end = off + lengthBytes;
    const words: number[] = [];
    for (let w = off; w + 2 <= end; w += 2) words.push(buf.readUInt16LE(w));
    records.push({
      offset: off,
      type,
      lengthWords,
      lengthBytes,
      words,
      bytes: buf.subarray(off, end),
    });
    off = end;
  }

  return {
    records,
    recordsStart: HEADER_SIZE,
    recordsEnd,
    trailerOffset: idx === -1 ? null : idx,
    paddingBytes,
    desyncAt,
  };
}

/** Printable runs with their offsets, relative to the record start. */
export function stringRuns(
  b: Buffer,
  minLen = 2
): Array<{ at: number; text: string }> {
  const out: Array<{ at: number; text: string }> = [];
  let cur = "";
  let start = 0;
  for (let i = 0; i <= b.length; i++) {
    const c = i < b.length ? b[i] : 0;
    if (c >= 32 && c <= 126) {
      if (cur === "") start = i;
      cur += String.fromCharCode(c);
    } else {
      if (cur.trim().length >= minLen) out.push({ at: start, text: cur });
      cur = "";
    }
  }
  return out;
}

export function ascii(b: Buffer): string {
  let s = "";
  for (const c of b) s += c >= 32 && c <= 126 ? String.fromCharCode(c) : ".";
  return s;
}
