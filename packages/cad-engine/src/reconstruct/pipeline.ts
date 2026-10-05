/**
 * Module-level source-faithful reconstruction used by the product pipeline.
 *
 * Mirrors tools/golden-m5/run.ts: learn pin templates across the CAD set,
 * load bound .LBR libraries, build DrawingSheets, calibrate zones, resolve
 * IREF/OREF, render SVG, and adapt to EngineeringSheetModel for the UI.
 */
import fs from "node:fs";
import path from "node:path";
import type { EngineeringSheetModel } from "@infi90/core";
import { readLibraryName } from "../binary/reader";
import { parseLbrLibrary, SymbolRegistry } from "../lbr/library";
import { decodeRecordStream } from "../records/decode";
import { buildDrawingSheet, type ZoneGrid } from "./build";
import { renderSheet, toSvg, type Item } from "./render";
import {
  applyZoneGrid,
  calibrateZoneGrid,
  resolveReferences,
} from "./resolve";
import * as S from "./support";
import { learnPinTemplates } from "./templates";
import { drawingSheetToEngineeringModel } from "./toEngineering";
import type { DrawingSheet } from "./types";

const ZONE_SEED: ZoneGrid = { dx: -35, dy: 2140, pitch: 100 };

export interface CadBuffer {
  name: string;
  data: Buffer;
}

export interface ReconstructModuleOptions {
  cads: CadBuffer[];
  /** Extracted archive root — support files and in-zip libraries are read here. */
  extractDir?: string;
  /** Extra roots to search for .LBR files named by CAD headers. */
  librarySearchRoots?: string[];
}

export interface ReconstructedSheet {
  filename: string;
  drawing: DrawingSheet;
  /** Page display list the SVG was written from (PDF writers reuse it). */
  items: Item[];
  svg: string;
  engineeringModel: EngineeringSheetModel;
  renderStats: {
    libraryPrimitives: number;
    fallbackGlyphs: number;
    libraryGlyphs: number;
    missingLibrarySymbols: string[];
  };
}

export interface ReconstructModuleResult {
  sheets: ReconstructedSheet[];
  librariesLoaded: string[];
  zoneGrid: ZoneGrid | null;
  /** Module header (`*.MHD`) fields, when the archive has one. */
  moduleHeader?: { moduleType: string | null; prefix: string | null; strings: string[] };
}

function walkFiles(root: string, depth: number, out: string[]): void {
  if (depth < 0 || !fs.existsSync(root)) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      if (/^(node_modules|\.git|\.next|data|apps|Output|deliverables|work)$/i.test(e.name)) {
        continue;
      }
      walkFiles(full, depth - 1, out);
    } else if (/\.LBR$/i.test(e.name)) {
      out.push(full);
    }
  }
}

/** Locate .LBR files by the library name stamped in each CAD header. */
export function findSymbolLibraries(
  names: string[],
  searchRoots: string[]
): Array<{ name: string; path: string; data: Buffer }> {
  const candidates: string[] = [];
  for (const root of searchRoots) {
    walkFiles(root, 6, candidates);
  }
  const found: Array<{ name: string; path: string; data: Buffer }> = [];
  const seen = new Set<string>();
  for (const n of names) {
    const want = `${n.toUpperCase()}.LBR`;
    const hits = candidates
      .filter((c) => path.basename(c).toUpperCase() === want)
      .sort((a, b) => a.length - b.length);
    if (!hits[0] || seen.has(want)) continue;
    seen.add(want);
    found.push({
      name: path.basename(hits[0]),
      path: hits[0],
      data: fs.readFileSync(hits[0]),
    });
  }
  return found;
}

function readText(extractDir: string | undefined, name: string): string {
  if (!extractDir) return "";
  const walk = (dir: string): string | null => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        const hit = walk(full);
        if (hit != null) return hit;
      } else if (e.name.toUpperCase() === name.toUpperCase()) {
        return fs.readFileSync(full, "latin1");
      }
    }
    return null;
  };
  try {
    return walk(extractDir) ?? "";
  } catch {
    return "";
  }
}

function readByPattern(extractDir: string | undefined, re: RegExp): Buffer | null {
  if (!extractDir) return null;
  const walk = (dir: string): Buffer | null => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        const hit = walk(full);
        if (hit) return hit;
      } else if (re.test(e.name)) {
        return fs.readFileSync(full);
      }
    }
    return null;
  };
  try {
    return walk(extractDir);
  } catch {
    return null;
  }
}

function defaultSearchRoots(extractDir?: string): string[] {
  const roots: string[] = [];
  if (extractDir) roots.push(extractDir);
  // Walk up from cwd / extractDir looking for the monorepo (LBR lives under Raw Data…).
  let dir = path.resolve(extractDir || process.cwd());
  for (let i = 0; i < 8; i++) {
    roots.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (process.env.CAD_LIBRARY_ROOT?.trim()) {
    roots.unshift(path.resolve(process.env.CAD_LIBRARY_ROOT.trim()));
  }
  return [...new Set(roots)];
}

/**
 * Reconstruct every CAD sheet in a module archive.
 * Safe to call with an empty CAD list (returns empty result).
 */
export function reconstructModule(
  opts: ReconstructModuleOptions
): ReconstructModuleResult {
  const cads = opts.cads.filter((c) => /\.CAD$/i.test(c.name));
  if (cads.length === 0) {
    return { sheets: [], librariesLoaded: [], zoneGrid: null };
  }

  const libNames = [
    ...new Set(
      cads
        .map((c) => readLibraryName(c.data))
        .filter((x): x is string => Boolean(x))
    ),
  ];
  const registry = new SymbolRegistry();
  const libraries = findSymbolLibraries(
    libNames,
    opts.librarySearchRoots ?? defaultSearchRoots(opts.extractDir)
  );
  // Also load any .LBR shipped inside the extract tree.
  if (opts.extractDir) {
    const inZip: string[] = [];
    walkFiles(opts.extractDir, 4, inZip);
    for (const p of inZip) {
      const name = path.basename(p);
      if (libraries.some((l) => l.name.toUpperCase() === name.toUpperCase())) continue;
      libraries.push({ name, path: p, data: fs.readFileSync(p) });
    }
  }
  for (const l of libraries) {
    registry.add(parseLbrLibrary(l.data, l.name));
  }

  const templates = learnPinTemplates(
    cads.map((c) => decodeRecordStream(c.data).records)
  );

  const extractDir = opts.extractDir;
  const outText = readText(extractDir, "I90XREF.OUT");
  const errText = readText(extractDir, "I90XREF.ERR");
  const vfyBuf = readByPattern(extractDir, /\.VFY$/i);
  const refBuf = readByPattern(extractDir, /\.REF$/i);
  const bndBuf = readByPattern(extractDir, /\.BND$/i);
  const mhdBuf = readByPattern(extractDir, /\.MHD$/i);

  const out = S.parseXrefOut(outText);
  const err = S.parseXrefErr(errText);
  const vfy = S.parseVfy(vfyBuf?.toString("latin1") ?? "");
  const refDescriptors = S.extractDescriptors(refBuf ?? Buffer.alloc(0));
  const bndDescriptors = S.extractDescriptors(bndBuf ?? Buffer.alloc(0));
  const mhd = S.parseModuleHeader(mhdBuf ?? Buffer.alloc(0));
  const specNames = vfy.specNames;

  const drawings = cads.map((f) =>
    buildDrawingSheet(f.data, f.name, {
      registry,
      templates,
      zoneGrid: ZONE_SEED,
      specNames,
    })
  );

  const calibration = calibrateZoneGrid(drawings, out);
  applyZoneGrid(drawings, calibration.grid);

  const registrySet = new Set(
    [...refDescriptors, ...bndDescriptors].map((s) => s.trim().toUpperCase())
  );
  const modulePrefix = mhd.prefix ?? "BQ";
  const moduleStem = cads[0].name.replace(/\.CAD$/i, "").slice(0, 5);
  resolveReferences(drawings, {
    modulePrefix,
    moduleStem,
    out,
    err,
    registry: registrySet,
  });

  const sheets: ReconstructedSheet[] = drawings.map((drawing) => {
    const { items, stats } = renderSheet(drawing, registry);
    return {
      filename: drawing.file,
      drawing,
      items,
      svg: toSvg(items, drawing.file),
      engineeringModel: drawingSheetToEngineeringModel(drawing),
      renderStats: stats,
    };
  });

  return {
    sheets,
    librariesLoaded: libraries.map((l) => l.path),
    zoneGrid: calibration.grid,
    moduleHeader: mhdBuf ? mhd : undefined,
  };
}
