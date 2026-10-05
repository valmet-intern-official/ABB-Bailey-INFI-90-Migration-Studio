/**
 * Reader for an engineering IO list spreadsheet with "Loop Tag" and
 * "Device Tag" columns. Used to check the CAD loop-tag extraction against a
 * reference list; it is not a source of loop tags.
 */
import * as XLSX from "xlsx";

export interface TagMapEntry {
  loopTag: string;
  deviceTag: string;
  /** Device-tag spellings listed for the same row (zero-padded, dash-less). */
  aliases: string[];
  ioType?: "AI" | "AO" | "DI" | "DO";
  /** Loop-PCU-module-slave-channel, e.g. 2-07-10-03-01. */
  address?: { loop: number; pcu: number; module: number; slave: number; channel: number; text: string };
  description?: string;
  sheet: string;
  row: number;
}

export interface TagMap {
  source: string;
  entries: TagMapEntry[];
}

const IO_TYPES = ["AI", "AO", "DI", "DO"] as const;
const cellText = (v: unknown) => (v == null ? "" : String(v).trim());
export const normalizeTag = (t: string) => t.toUpperCase().replace(/[^A-Z0-9]/g, "");

function findColumn(rows: string[][], headerRow: number, re: RegExp): number {
  for (const r of [headerRow, headerRow + 1]) {
    const i = (rows[r] ?? []).findIndex((c) => re.test(c));
    if (i >= 0) return i;
  }
  return -1;
}

function parseSheet(name: string, sheet: XLSX.WorkSheet): TagMapEntry[] {
  const rows = (XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false }) as unknown[][]).map((r) => r.map(cellText));
  const headerRow = rows.findIndex((r) => r.some((c) => /^loop\s*tag$/i.test(c)) && r.some((c) => /^device\s*tag$/i.test(c)));
  if (headerRow < 0) return [];
  const col = {
    loop: rows[headerRow].findIndex((c) => /^loop\s*tag$/i.test(c)),
    device: rows[headerRow].findIndex((c) => /^device\s*tag$/i.test(c)),
    zero: findColumn(rows, headerRow, /^zero\s*device\s*tag$/i),
    dash: findColumn(rows, headerRow, /^dash\s*device\s*tag$/i),
    pcu: findColumn(rows, headerRow, /^pcu$/i),
    description: findColumn(rows, headerRow, /^tag\s*description$/i),
  };
  const typeCols = IO_TYPES.map((t) => [t, findColumn(rows, headerRow, new RegExp(`^${t}$`))] as const).filter(([, i]) => i >= 0);
  const out: TagMapEntry[] = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const loopTag = row[col.loop] ?? "";
    const deviceTag = row[col.device] ?? "";
    if (!loopTag || !deviceTag || /^spare$/i.test(deviceTag)) continue;
    const marked = typeCols.filter(([, i]) => row[i] && row[i] !== "0").map(([t]) => t);
    const m = col.pcu >= 0 ? /^(\d+)-(\d+)-(\d+)-(\d+)-(\d+)$/.exec(row[col.pcu] ?? "") : null;
    out.push({
      loopTag,
      deviceTag,
      aliases: [col.zero, col.dash].map((i) => (i >= 0 ? row[i] : "")).filter(Boolean),
      ioType: marked.length === 1 ? marked[0] : undefined,
      address: m ? { loop: +m[1], pcu: +m[2], module: +m[3], slave: +m[4], channel: +m[5], text: m[0] } : undefined,
      description: col.description >= 0 ? row[col.description] || undefined : undefined,
      sheet: name,
      row: r + 1,
    });
  }
  return out;
}

/** Parse a reference IO list (.xls, .xlsx or .csv). Returns null when no sheet has Loop Tag and Device Tag columns. */
export function parseTagMap(data: Buffer, source: string): TagMap | null {
  const wb = XLSX.read(data, { type: "buffer" });
  const seen = new Set<string>();
  const entries: TagMapEntry[] = [];
  for (const name of wb.SheetNames) {
    for (const e of parseSheet(name, wb.Sheets[name])) {
      const key = [e.loopTag, normalizeTag(e.deviceTag), e.address?.text ?? "", e.ioType ?? ""].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(e);
    }
  }
  return entries.length ? { source, entries } : null;
}
