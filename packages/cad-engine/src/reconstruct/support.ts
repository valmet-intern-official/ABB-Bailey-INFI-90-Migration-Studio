/**
 * Parsers for the INFI 90 supporting files that travel with a module's CAD
 * sheets. Each parser keeps the raw line or byte range for every record so
 * reports can quote the evidence verbatim.
 */

const sheetOf = (path: string) => /([0-9A-Z]{8})\.CAD/i.exec(path)?.[1]?.toUpperCase() ?? null;

// ---------------------------------------------------------------- I90XREF.OUT
export interface XrefOutRow {
  sheet: string;
  direction: "output" | "input";
  description: string;
  /** Address of the signal on its own sheet. */
  source: string | null;
  destinations: Array<{ reference: string; sheet: string | null }>;
  line: number;
}

export function parseXrefOut(text: string): XrefOutRow[] {
  const rows: XrefOutRow[] = [];
  let sheet: string | null = null;
  let direction: "output" | "input" | null = null;
  let cur: XrefOutRow | null = null;
  const lines = text.split(/\r?\n/);
  const addDests = (row: XrefOutRow, s: string) => {
    for (const m of s.matchAll(/([A-Z0-9]{4}-\d{2}\.\d{2})(?:\s+([0-9A-Z]{8}))?/g)) {
      row.destinations.push({ reference: m[1], sheet: m[2] ?? null });
    }
  };
  lines.forEach((raw, i) => {
    const line = raw.replace(/\0/g, "");
    const h = /([0-9A-Z]{8})\.CAD\s+(Outputs|Inputs)\s*$/i.exec(line);
    if (h) {
      sheet = h[1].toUpperCase();
      direction = /^out/i.test(h[2]) ? "output" : "input";
      cur = null;
      return;
    }
    if (!sheet || !direction || /^-{5,}/.test(line.trim()) || /Description\s+Source/.test(line)) return;
    if (!line.trim()) { cur = null; return; }
    // Description occupies columns 0..31, source 32..47, destinations after.
    const desc = line.slice(0, 32).trim();
    if (desc) {
      const src = /^[A-Z0-9]{4}-\d{2}\.\d{2}/.exec(line.slice(32, 48).trim())?.[0] ?? null;
      cur = { sheet, direction, description: desc, source: src, destinations: [], line: i + 1 };
      rows.push(cur);
      addDests(cur, line.slice(48));
    } else if (cur) {
      addDests(cur, line);
    }
  });
  return rows;
}

// ---------------------------------------------------------------- I90XREF.ERR
export interface XrefErrRow {
  direction: "input" | "output";
  description: string;
  reference: string | null;
  sheet: string | null;
  line: number;
  raw: string;
}

export function parseXrefErr(text: string): XrefErrRow[] {
  const out: XrefErrRow[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const m = /^Unrslvd (Inp|Out):\s*(.*?)\s+([A-Z0-9]{4}-\d{2}\.\d{2})?\s*In:\s*(\S+)/.exec(raw);
    if (!m) return;
    out.push({
      direction: m[1] === "Inp" ? "input" : "output",
      description: m[2].trim(),
      reference: m[3] ?? null,
      sheet: sheetOf(m[4]),
      line: i + 1,
      raw: raw.trim(),
    });
  });
  return out;
}

// ---------------------------------------------------------------- I90XREF.XRF
export interface XrefLog {
  sheetsToProcess: number | null;
  sheetsRead: string[];
  sheetsResolved: string[];
  blankDescriptions: Record<string, number>;
  otherLines: string[];
}

export function parseXrefLog(text: string): XrefLog {
  const log: XrefLog = { sheetsToProcess: null, sheetsRead: [], sheetsResolved: [], blankDescriptions: {}, otherLines: [] };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const n = /No\. of CAD Sheets to Process\s*=\s*(\d+)/.exec(line);
    if (n) { log.sheetsToProcess = Number(n[1]); continue; }
    if (/^Reading:/.test(line)) { const s = sheetOf(line); if (s) log.sheetsRead.push(s); continue; }
    if (/^Resolve:/.test(line)) { const s = sheetOf(line); if (s) log.sheetsResolved.push(s); continue; }
    if (/^Blank description/.test(line)) { const s = sheetOf(line); if (s) log.blankDescriptions[s] = (log.blankDescriptions[s] ?? 0) + 1; continue; }
    log.otherLines.push(line);
  }
  return log;
}

// ---------------------------------------------------------------- *.VFY
export interface VfyBlock {
  sheet: string | null;
  blockNumber: number;
  issue: string;
  srcFc: number | null;
  refFc: number | null;
  specs: Array<{ name: string; description: string; src: string | null; ref: string | null }>;
}

export interface VfyReport {
  sourceBlocksTotal: number | null;
  referenceBlocksTotal: number | null;
  differentBlocksTotal: number | null;
  drawingFiles: string[];
  reference: string | null;
  blocks: VfyBlock[];
  /** FC number -> descriptive name, as printed by the verifier. */
  fcNames: Record<number, string>;
  /** FC number -> spec name (S1..) -> description. */
  specNames: Record<number, Record<string, string>>;
}

export function parseVfy(text: string): VfyReport {
  const r: VfyReport = { sourceBlocksTotal: null, referenceBlocksTotal: null, differentBlocksTotal: null, drawingFiles: [], reference: null, blocks: [], fcNames: {}, specNames: {} };
  let sheet: string | null = null;
  let blk: VfyBlock | null = null;
  let spec: VfyBlock["specs"][number] | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    let m: RegExpExecArray | null;
    if ((m = /Source\s+Blocks Total\s*:\s*(\d+)/.exec(line))) r.sourceBlocksTotal = Number(m[1]);
    else if ((m = /Reference Blocks Total\s*:\s*(\d+)/.exec(line))) r.referenceBlocksTotal = Number(m[1]);
    else if ((m = /Different Blocks Total\s*:\s*(\d+)/.exec(line))) r.differentBlocksTotal = Number(m[1]);
    else if ((m = /^Reference Type\s*:\s*(.*)$/.exec(line))) r.reference = m[1].trim();
    else if (/^Drawing File\s*:/.test(line)) { sheet = sheetOf(line); if (sheet) r.drawingFiles.push(sheet); }
    else if ((m = /^Block Number\s+(\d+)(?:\s+FC:\s*(\d+)\s+(.*))?$/.exec(line.trim()))) {
      blk = { sheet, blockNumber: Number(m[1]), issue: "", srcFc: m[2] ? Number(m[2]) : null, refFc: null, specs: [] };
      if (m[2] && m[3]) r.fcNames[Number(m[2])] = m[3].trim();
      r.blocks.push(blk);
      spec = null;
    } else if (blk && (m = /^\s*(SRC|REF): Blk\s+\d+\s+FC:\s*(\d+)\s+(.*)$/.exec(line))) {
      const fc = Number(m[2]);
      r.fcNames[fc] = m[3].trim();
      if (m[1] === "SRC") blk.srcFc = fc; else blk.refFc = fc;
    } else if (blk && (m = /^\s+(S\d+)\s+(.*)$/.exec(line)) && !/^(SRC|REF):/.test(m[2])) {
      spec = { name: m[1], description: m[2].trim(), src: null, ref: null };
      blk.specs.push(spec);
      const fc = blk.srcFc ?? blk.refFc;
      if (fc != null) (r.specNames[fc] ??= {})[m[1]] = m[2].trim();
    } else if (spec && (m = /^\s+(SRC|REF):\s*(.*)$/.exec(line))) {
      if (m[1] === "SRC") spec.src = m[2].trim(); else spec.ref = m[2].trim();
    } else if (blk && line.trim() && !blk.issue && !/^\s+(SRC|REF)/.test(line)) {
      blk.issue = line.trim();
    }
  }
  return r;
}

// ---------------------------------------------------------------- *.CFG
export interface CfgEntry {
  offset: number;
  lengthWords: number;
  blockNumber: number;
  functionCode: number;
  words: number[];
}

/**
 * Locate CFG entries anchored on (block, function code) pairs declared by the
 * CAD trailers. The CFG shares the trailer's entry grammar
 * `[lengthWords, block, fc, spec words...]` but pads entries to page
 * boundaries, so entries are found by anchor rather than by one chain.
 */
export function locateCfgEntries(buf: Buffer, anchors: Array<{ blockNumber: number; functionCode: number }>): {
  entries: Map<number, CfgEntry>;
  notFound: Array<{ blockNumber: number; functionCode: number }>;
  fcMismatch: Array<{ blockNumber: number; cadFc: number; cfgFc: number; offset: number }>;
} {
  const byBlock = new Map<number, Array<{ offset: number; len: number; fc: number }>>();
  for (let off = 512; off + 6 <= buf.length; off += 2) {
    const len = buf.readUInt16LE(off);
    if (len < 3 || len > 400 || off + len * 2 > buf.length) continue;
    const blk = buf.readUInt16LE(off + 2);
    const fc = buf.readUInt16LE(off + 4);
    if (blk < 1 || blk > 9999 || fc < 1 || fc > 250) continue;
    const l = byBlock.get(blk) ?? [];
    l.push({ offset: off, len, fc });
    byBlock.set(blk, l);
  }
  const entries = new Map<number, CfgEntry>();
  const notFound: Array<{ blockNumber: number; functionCode: number }> = [];
  const fcMismatch: Array<{ blockNumber: number; cadFc: number; cfgFc: number; offset: number }> = [];
  for (const a of anchors) {
    const cands = byBlock.get(a.blockNumber) ?? [];
    const hit = cands.find((c) => c.fc === a.functionCode);
    if (hit) {
      const words: number[] = [];
      for (let i = 3; i < hit.len; i++) words.push(buf.readUInt16LE(hit.offset + i * 2));
      entries.set(a.blockNumber, { offset: hit.offset, lengthWords: hit.len, blockNumber: a.blockNumber, functionCode: hit.fc, words });
    } else if (cands.length === 1) {
      fcMismatch.push({ blockNumber: a.blockNumber, cadFc: a.functionCode, cfgFc: cands[0].fc, offset: cands[0].offset });
    } else {
      notFound.push(a);
    }
  }
  return { entries, notFound, fcMismatch };
}

// ---------------------------------------------------------------- REF / BND
/** Printable fixed-width descriptor strings from a binary REF/BND database. */
export function extractDescriptors(buf: Buffer, minLen = 3): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i <= buf.length; i++) {
    const c = i < buf.length ? buf[i] : 0;
    if (c >= 32 && c < 127) { cur += String.fromCharCode(c); continue; }
    for (const part of cur.split(/\s{3,}/)) {
      const t = part.trim();
      if (t.length >= minLen) out.push(t);
    }
    cur = "";
  }
  return out;
}

// ---------------------------------------------------------------- MHD
export function parseModuleHeader(buf: Buffer): { moduleType: string | null; prefix: string | null; strings: string[] } {
  const strings = extractDescriptors(buf, 2);
  const moduleType = strings.map((s) => /\b(MFP\d+|MFC\d+|BRC\d+|IMMFP\d+)\b/.exec(s)?.[1]).find(Boolean) ?? null;
  const prefix = strings.map((s) => /^([A-Z]{2})$/.exec(s.trim())?.[1]).find(Boolean) ?? null;
  return { moduleType, prefix, strings };
}

// ---------------------------------------------------------------- LST / LOG
export function listedSheets(text: string): string[] {
  return [...text.matchAll(/([0-9A-Z]{8})\.CAD/gi)].map((m) => m[1].toUpperCase());
}
