/**
 * Loads everything the reconstruction needs from disk: the M5 archive
 * (extracted from Test/M5.zip), the symbol library the sheets bind to, the
 * supporting files, and the pin templates learned from the whole corpus.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { decodeRecordStream, readLibraryName } from "../../../packages/cad-engine/src/index";
import { parseLbrLibrary, SymbolRegistry } from "../../../packages/cad-engine/src/lbr/library";
import { learnPinTemplates, type PinTemplate } from "../../../packages/cad-engine/src/reconstruct/templates";
import * as S from "../../../packages/cad-engine/src/reconstruct/support";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const TEST = path.join(ROOT, "Test");
export const ZIP = path.join(TEST, "M5.zip");
export const OUT = path.join(TEST, "deliverables");

export interface ArchiveFile { name: string; entry: string; data: Buffer; modified: string }

export function readArchive(zipPath = ZIP): ArchiveFile[] {
  const zip = new AdmZip(zipPath);
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  return zip
    .getEntries()
    .filter((e) => !e.isDirectory)
    .map((e) => ({ name: path.basename(e.entryName), entry: e.entryName, data: e.getData(), modified: fmt(e.header.time as Date) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Library search order: a library the sheets name, looked up by file name. */
export function findLibraries(names: string[]): Array<{ name: string; path: string }> {
  const found: Array<{ name: string; path: string }> = [];
  const candidates: string[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 6) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!/^(node_modules|\.git|\.next|data|apps|Output|deliverables|work)$/i.test(e.name)) walk(path.join(d, e.name), depth + 1);
      } else if (/\.LBR$/i.test(e.name)) candidates.push(path.join(d, e.name));
    }
  };
  walk(ROOT, 0);
  for (const n of names) {
    // Prefer the copy in the controller project root over per-loop copies.
    const hits = candidates.filter((c) => path.basename(c).toUpperCase() === `${n.toUpperCase()}.LBR`).sort((a, b) => a.length - b.length);
    if (hits[0]) found.push({ name: path.basename(hits[0]), path: hits[0] });
  }
  return found;
}

export interface Context {
  files: ArchiveFile[];
  cads: ArchiveFile[];
  registry: SymbolRegistry;
  libraries: Array<{ name: string; path: string; sha256: string; entries: number; unclean: string[] }>;
  templates: Map<string, PinTemplate>;
  support: {
    out: S.XrefOutRow[];
    err: S.XrefErrRow[];
    xrf: S.XrefLog;
    vfy: S.VfyReport;
    refDescriptors: string[];
    bndDescriptors: string[];
    mhd: ReturnType<typeof S.parseModuleHeader>;
    cfg: Buffer | null;
    lst: string[];
    log: string[];
  };
}

export function loadContext(): Context {
  const files = readArchive();
  const cads = files.filter((f) => /\.CAD$/i.test(f.name));
  const libNames = [...new Set(cads.map((c) => readLibraryName(c.data)).filter((x): x is string => Boolean(x)))];
  const registry = new SymbolRegistry();
  const libraries: Context["libraries"] = [];
  for (const l of findLibraries(libNames)) {
    const buf = fs.readFileSync(l.path);
    const lib = parseLbrLibrary(buf, l.name);
    registry.add(lib);
    libraries.push({
      name: l.name,
      path: path.relative(ROOT, l.path),
      sha256: (await_sha(buf)),
      entries: lib.directoryEntries,
      unclean: lib.uncleanBodies,
    });
  }
  const templates = learnPinTemplates(cads.map((c) => decodeRecordStream(c.data).records));
  const text = (n: string) => files.find((f) => f.name.toUpperCase() === n.toUpperCase())?.data.toString("latin1") ?? "";
  const bin = (re: RegExp) => files.find((f) => re.test(f.name))?.data ?? null;
  const support: Context["support"] = {
    out: S.parseXrefOut(text("I90XREF.OUT")),
    err: S.parseXrefErr(text("I90XREF.ERR")),
    xrf: S.parseXrefLog(text("I90XREF.XRF")),
    vfy: S.parseVfy(files.find((f) => /\.VFY$/i.test(f.name))?.data.toString("latin1") ?? ""),
    refDescriptors: S.extractDescriptors(bin(/\.REF$/i) ?? Buffer.alloc(0)),
    bndDescriptors: S.extractDescriptors(bin(/\.BND$/i) ?? Buffer.alloc(0)),
    mhd: S.parseModuleHeader(bin(/\.MHD$/i) ?? Buffer.alloc(0)),
    cfg: bin(/\.CFG$/i),
    lst: S.listedSheets(files.find((f) => /^\d+\.LST$/i.test(f.name))?.data.toString("latin1") ?? ""),
    log: S.listedSheets(files.find((f) => /^\d+\.LOG$/i.test(f.name))?.data.toString("latin1") ?? ""),
  };
  return { files, cads, registry, libraries, templates, support };
}

import crypto from "node:crypto";
function await_sha(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
