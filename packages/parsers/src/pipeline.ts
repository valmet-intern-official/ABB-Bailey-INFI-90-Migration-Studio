import fs from "node:fs";
import path from "node:path";
import {
  correlateProject,
  newId,
  type CorrelatedProject,
  type ProjectMeta,
} from "@infi90/core";
import { parseCadFile } from "./cad";
import { parseErrFile } from "./err";
import { parseM1File } from "./m1";
import { parseOutFile } from "./out";
import { parseRefFile } from "./ref";
import { classifyFiles } from "./classify";
import { extractZip, readArchiveFile } from "./zip";
import { parseXrfFile } from "./xrf";
import { applyCadLoopTags } from "./loop-tags";
import { correlateSheets, reconstructModule, toSvg, type RenderItem } from "@infi90/cad-engine";
import { buildScene, sheetOverlays, type ArchiveTime } from "@infi90/cad-forensics";
import type { CadSheetParse } from "@infi90/core";

/** Resolve IREF/OREF targets across the whole sheet set. */
function correlateCadSheets(sheets: CadSheetParse[]) {
  const models = sheets
    .map((s) => s.engineeringModel)
    .filter((m): m is NonNullable<typeof m> => Boolean(m));
  if (models.length > 0) correlateSheets(models);
}

type TitleField = { label: string; value: string; at: { x: number; y: number }; labelAt: { x: number; y: number } };
/** The first text line sits within one line height of the DESCRIPTION caption. */
const FIRST_LINE_DY = 30;

/**
 * Split the DESCRIPTION box into the plant-area line (directly under the
 * caption) and the page description (the lines below, top-to-bottom then
 * left-to-right). Line text is kept verbatim.
 */
export function titleDescriptions(fields: TitleField[]): { areaDescription?: string; pageDescription?: string } {
  const lines = fields.filter((f) => /^DESCRIPTION$/i.test(f.label));
  const area = lines.filter((f) => f.labelAt.y - f.at.y < FIRST_LINE_DY);
  const page = lines
    .filter((f) => !area.includes(f))
    .sort((a, b) => b.at.y - a.at.y || a.at.x - b.at.x);
  return {
    areaDescription: area.map((f) => f.value).join(" ") || undefined,
    pageDescription: page.map((f) => f.value).join(" ") || undefined,
  };
}

/**
 * Run the source-faithful reconstruct pipeline over the module CAD set and
 * replace each sheet's engineering model + SVG with the golden-master output.
 * Falls back silently (keeps decodeCadSheet model) if reconstruction throws.
 */
/** Scene overlays (S labels, N+k, plot stamp, S1..SN values) per sheet; empty when the scene cannot be built. */
function overlaysFor(
  result: ReturnType<typeof reconstructModule>,
  cadBuffers: Array<{ name: string; data: Buffer }>,
  extractDir: string,
  cadPaths: Map<string, string>,
  module: string
): Map<string, RenderItem[]> {
  try {
    const archiveTimes = new Map<string, ArchiveTime>();
    for (const [name, rel] of cadPaths) {
      archiveTimes.set(name.toUpperCase(), { entry: rel, mtime: fs.statSync(path.join(extractDir, rel)).mtime });
    }
    const { scene } = buildScene({ module, cads: cadBuffers, extractDir, archiveTimes, reconstructed: result });
    return sheetOverlays(scene, new Map(result.sheets.map((s) => [s.filename, s.items]))).items;
  } catch (err) {
    console.warn("[parsers] scene overlay failed; sheets shown without S1..SN data:", err instanceof Error ? err.message : err);
    return new Map();
  }
}

function applyReconstruct(
  sheets: CadSheetParse[],
  cadBuffers: Array<{ name: string; data: Buffer }>,
  extractDir: string,
  cadPaths: Map<string, string>,
  module: string
): void {
  if (sheets.length === 0) return;
  try {
    const result = reconstructModule({ cads: cadBuffers, extractDir });
    const overlays = overlaysFor(result, cadBuffers, extractDir, cadPaths, module);
    const byName = new Map(
      result.sheets.map((s) => [s.filename.toUpperCase(), s])
    );
    for (const sheet of sheets) {
      const hit = byName.get(sheet.filename.toUpperCase());
      if (!hit) continue;
      sheet.engineeringModel = hit.engineeringModel;
      const extra = overlays.get(hit.filename);
      sheet.reconstructedSvg = extra?.length ? toSvg([...hit.items, ...extra], hit.filename) : hit.svg;
      // Keep table/search lists in sync with the reconstruct model.
      const placed = hit.engineeringModel.blocks.filter(
        (b) => b.type !== "Junction" && b.functionCode
      );
      sheet.functionBlocks = placed.map((block) => {
        const specs: Record<string, string> = {};
        for (const [key, value] of Object.entries(block.parameters)) {
          const m = key.match(/^S(\d{1,2})$/i);
          if (m) specs[`s${Number(m[1])}`] = value;
        }
        return {
          functionCode: block.functionCode!,
          functionCodeNumber: block.functionCodeNumber,
          blockId: block.blockNumber,
          blockNumber: block.blockNumber,
          ...specs,
          logicFormula:
            block.functionCodeNumber != null
              ? `FC${block.functionCodeNumber} ${block.functionCode}`
              : block.functionCode!,
          inputRefs: block.inputRefs,
          outputRefs: block.outputRefs,
          deviceTag: block.deviceTags[0],
          notes: block.label ?? block.notes,
        };
      });
      if (hit.engineeringModel.sheetId) sheet.sheetId = hit.engineeringModel.sheetId;
      if (hit.engineeringModel.title) sheet.title = hit.engineeringModel.title;
      Object.assign(sheet, titleDescriptions(hit.drawing.titleBlock.fields));
      if (!hit.drawing.titleBlock.present) {
        const texts = hit.drawing.texts.map((t) => t.text.trim()).filter((t) => /\S\s+\S/.test(t));
        sheet.titleBlockNote = `no library-defined title block on ${sheet.filename}; free text on the sheet: ${texts.map((t) => `'${t}'`).join(", ") || "none"}`;
      }
    }
  } catch (err) {
    console.warn(
      "[parsers] reconstructModule failed; keeping decodeCadSheet models:",
      err instanceof Error ? err.message : err
    );
  }
}

export interface ProcessOptions {
  zipPath: string;
  workDir: string;
  projectName?: string;
  loop?: string;
  cpu?: string;
  module?: string;
}

export function processModuleZip(opts: ProcessOptions): CorrelatedProject {
  const extractDir = path.join(opts.workDir, "extract");
  if (fs.existsSync(extractDir)) {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
  const extracted = extractZip(opts.zipPath, extractDir);
  const { classified } = extracted;
  const prov = {
    loop: opts.loop || classified.provenance.loop,
    cpu: opts.cpu || classified.provenance.cpu,
    module: opts.module || classified.provenance.module,
  };

  const meta: ProjectMeta = {
    id: newId("proj"),
    name: opts.projectName || extracted.zipName.replace(/\.zip$/i, ""),
    createdAt: new Date().toISOString(),
    sourceZipName: extracted.zipName,
    loop: prov.loop,
    cpu: prov.cpu,
    module: prov.module,
    status: "processing",
  };

  const findFirst = (kind: string) =>
    classified.files.find((f) => f.kind === kind);

  const outFile = findFirst("OUT");
  const refFile = findFirst("REF");
  const xrfFile = findFirst("XRF");
  const errFile = findFirst("ERR");

  const out = outFile
    ? parseOutFile(readArchiveFile(extractDir, outFile.relativePath))
    : undefined;
  const refTags = refFile
    ? parseRefFile(readArchiveFile(extractDir, refFile.relativePath))
    : [];
  const xrf = xrfFile
    ? parseXrfFile(readArchiveFile(extractDir, xrfFile.relativePath))
    : undefined;
  const errRecords = errFile
    ? parseErrFile(readArchiveFile(extractDir, errFile.relativePath))
    : [];

  const cadFiles = classified.byKind.CAD ?? [];
  const cadBuffers = cadFiles.map((f) => ({
    name: f.filename,
    data: readArchiveFile(extractDir, f.relativePath),
  }));
  const cadSheets = cadBuffers.map((f) => parseCadFile(f.data, f.name));
  // Cross-sheet links need the whole sheet set, so resolve them after parsing.
  correlateCadSheets(cadSheets);
  // Source-faithful reconstruct (golden-master path) replaces the legacy model.
  applyReconstruct(cadSheets, cadBuffers, extractDir, new Map(cadFiles.map((f) => [f.filename, f.relativePath])), prov.module || meta.name);

  const graphics = (classified.byKind.M1 ?? []).map((f) =>
    parseM1File(readArchiveFile(extractDir, f.relativePath), f.filename)
  );

  const project = correlateProject({
    meta,
    inventory: classified.files,
    out,
    refTags,
    xrf,
    errRecords,
    cadSheets,
    graphics,
  });
  applyCadLoopTags(project);
  return project;
}

export function processExtractedDir(
  extractDir: string,
  opts: {
    projectName?: string;
    zipName?: string;
    loop?: string;
    cpu?: string;
    module?: string;
  } = {}
): CorrelatedProject {
  const entries: { relativePath: string; size: number }[] = [];
  const walk = (dir: string, relBase = "") => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const rel = relBase ? `${relBase}/${name}` : name;
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full, rel);
      else entries.push({ relativePath: rel.replace(/\\/g, "/"), size: st.size });
    }
  };
  walk(extractDir);
  const classified = classifyFiles(entries);

  const meta: ProjectMeta = {
    id: newId("proj"),
    name: opts.projectName || path.basename(extractDir),
    createdAt: new Date().toISOString(),
    sourceZipName: opts.zipName || `${path.basename(extractDir)}.zip`,
    loop: opts.loop || classified.provenance.loop,
    cpu: opts.cpu || classified.provenance.cpu,
    module: opts.module || classified.provenance.module,
    status: "processing",
  };

  const findFirst = (kind: string) =>
    classified.files.find((f) => f.kind === kind);

  const outFile = findFirst("OUT");
  const refFile = findFirst("REF");
  const xrfFile = findFirst("XRF");
  const errFile = findFirst("ERR");

  const out = outFile
    ? parseOutFile(fs.readFileSync(path.join(extractDir, outFile.relativePath)))
    : undefined;
  const refTags = refFile
    ? parseRefFile(fs.readFileSync(path.join(extractDir, refFile.relativePath)))
    : [];
  const xrf = xrfFile
    ? parseXrfFile(fs.readFileSync(path.join(extractDir, xrfFile.relativePath)))
    : undefined;
  const errRecords = errFile
    ? parseErrFile(fs.readFileSync(path.join(extractDir, errFile.relativePath)))
    : [];

  const cadFiles = classified.byKind.CAD ?? [];
  const cadBuffers = cadFiles.map((f) => ({
    name: f.filename,
    data: fs.readFileSync(path.join(extractDir, f.relativePath)),
  }));
  const cadSheets = cadBuffers.map((f) => parseCadFile(f.data, f.name));
  correlateCadSheets(cadSheets);
  applyReconstruct(cadSheets, cadBuffers, extractDir, new Map(cadFiles.map((f) => [f.filename, f.relativePath])), meta.module || meta.name);
  const graphics = (classified.byKind.M1 ?? []).map((f) =>
    parseM1File(
      fs.readFileSync(path.join(extractDir, f.relativePath)),
      f.filename
    )
  );

  const project = correlateProject({
    meta,
    inventory: classified.files,
    out,
    refTags,
    xrf,
    errRecords,
    cadSheets,
    graphics,
  });
  applyCadLoopTags(project);
  return project;
}
