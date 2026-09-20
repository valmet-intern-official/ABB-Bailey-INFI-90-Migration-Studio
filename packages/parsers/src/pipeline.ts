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
import { correlateSheets } from "@infi90/cad-engine";
import type { CadSheetParse } from "@infi90/core";

/** Resolve IREF/OREF targets across the whole sheet set. */
function correlateCadSheets(sheets: CadSheetParse[]) {
  const models = sheets
    .map((s) => s.engineeringModel)
    .filter((m): m is NonNullable<typeof m> => Boolean(m));
  if (models.length > 0) correlateSheets(models);
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

  const cadSheets = (classified.byKind.CAD ?? []).map((f) =>
    parseCadFile(readArchiveFile(extractDir, f.relativePath), f.filename)
  );
  // Cross-sheet links need the whole sheet set, so resolve them after parsing.
  correlateCadSheets(cadSheets);

  const graphics = (classified.byKind.M1 ?? []).map((f) =>
    parseM1File(readArchiveFile(extractDir, f.relativePath), f.filename)
  );

  return correlateProject({
    meta,
    inventory: classified.files,
    out,
    refTags,
    xrf,
    errRecords,
    cadSheets,
    graphics,
  });
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

  const cadSheets = (classified.byKind.CAD ?? []).map((f) =>
    parseCadFile(
      fs.readFileSync(path.join(extractDir, f.relativePath)),
      f.filename
    )
  );
  correlateCadSheets(cadSheets);
  const graphics = (classified.byKind.M1 ?? []).map((f) =>
    parseM1File(
      fs.readFileSync(path.join(extractDir, f.relativePath)),
      f.filename
    )
  );

  return correlateProject({
    meta,
    inventory: classified.files,
    out,
    refTags,
    xrf,
    errRecords,
    cadSheets,
    graphics,
  });
}
