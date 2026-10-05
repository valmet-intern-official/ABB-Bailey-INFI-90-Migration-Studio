import fs from "node:fs";
import path from "node:path";
import { reconstructModule, writePdf, type RenderItem } from "@infi90/cad-engine";
import { buildScene, OVERLAY_LAYERS, sheetOverlays, type ArchiveTime } from "@infi90/cad-forensics";
import type { CorrelatedProject } from "@infi90/core";
import { findRepoRoot, getStorageRoot } from "@/lib/env";
import { loadProject, projectArtifactsDir } from "@/lib/store";

/**
 * Per-sheet plot PDF.
 *
 * When the archive contains a PDF with the same name as the CAD sheet, those
 * bytes are served unchanged. Otherwise the PDF is the source-coordinate plot
 * of that CAD sheet (the same display list as the viewer SVG, including the
 * S1..SN / N+k overlay, written with PDF operators at page size).
 */

const jobs = new Map<string, Promise<Map<string, string>>>();

function listFiles(dir: string, depth: number, out: string[]) {
  if (depth < 0 || !fs.existsSync(dir)) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (/^(node_modules|\.git|\.next)$/i.test(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(full, depth - 1, out);
    else out.push(full);
  }
}

function cadDirectories(): string[] {
  const roots = [path.join(findRepoRoot(), "tools", "fc-manual", "cache", "m10", "M10")];
  const work = path.join(getStorageRoot(), "work");
  if (fs.existsSync(work)) {
    for (const name of fs.readdirSync(work)) {
      const dir = path.join(work, name);
      roots.push(path.join(dir, "extract"));
      roots.push(dir);
    }
  }
  return roots;
}

/** Directory that holds this session's CAD files and their support files. */
function findModuleDir(want: Set<string>): string | null {
  let best: { dir: string; score: number } | null = null;
  for (const root of cadDirectories()) {
    if (!fs.existsSync(root)) continue;
    const files: string[] = [];
    listFiles(root, 3, files);
    const cads = files.filter((f) => want.has(path.basename(f).toUpperCase()));
    if (!best || cads.length > best.score) best = { dir: root, score: cads.length };
    if (cads.length >= want.size && want.size > 0) return root;
  }
  return best && best.score > 0 ? best.dir : null;
}

function plotDir(projectId: string) {
  const dir = path.join(projectArtifactsDir(projectId), "cad-plot");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function plotName(filename: string) {
  return `${filename.replace(/\.CAD$/i, "")}.pdf`;
}

function buildPlots(project: CorrelatedProject): Map<string, string> {
  const dir = plotDir(project.meta.id);
  const want = new Set(project.cadSheets.map((s) => s.filename.toUpperCase()));
  const out = new Map<string, string>();
  for (const name of want) {
    const file = path.join(dir, plotName(name));
    if (fs.existsSync(file)) out.set(name, file);
  }
  if (out.size === want.size) return out;

  const moduleDir = findModuleDir(want);
  if (!moduleDir) return out;

  const files: string[] = [];
  listFiles(moduleDir, 3, files);

  for (const file of files) {
    if (!/\.pdf$/i.test(file)) continue;
    const key = path.basename(file).replace(/\.PDF$/i, ".CAD").toUpperCase();
    if (!want.has(key) || out.has(key)) continue;
    const dest = path.join(dir, plotName(key));
    fs.copyFileSync(file, dest);
    out.set(key, dest);
  }
  if (out.size === want.size) return out;

  const cadFiles = files.filter((f) => /\.CAD$/i.test(f) && want.has(path.basename(f).toUpperCase())).sort();
  if (cadFiles.length === 0) return out;

  const { reconstructed, overlays } = sceneSheets(project, moduleDir, cadFiles);
  for (const sheet of reconstructed.sheets) {
    const key = sheet.filename.toUpperCase();
    if (!want.has(key) || out.has(key)) continue;
    const dest = path.join(dir, plotName(key));
    const items = [...sheet.items, ...(overlays.get(sheet.filename) ?? [])];
    fs.writeFileSync(dest, writePdf([{ items, label: sheet.filename }], sheet.filename, { layers: OVERLAY_LAYERS }));
    out.set(key, dest);
  }
  return out;
}

/**
 * Reconstructed sheets plus the scene overlay (S labels, N+k addresses, plot
 * stamp, S1..SN values) drawn onto each sheet. Plot stamps come from the
 * extracted files' mtimes (preserved from the ZIP).
 */
function sceneSheets(project: CorrelatedProject, moduleDir: string, cadFiles: string[]) {
  const cads = cadFiles.map((f) => ({ name: path.basename(f), data: fs.readFileSync(f) }));
  const reconstructed = reconstructModule({ cads, extractDir: moduleDir });
  try {
    const archiveTimes = new Map<string, ArchiveTime>();
    for (const f of cadFiles) {
      archiveTimes.set(path.basename(f).toUpperCase(), {
        entry: path.relative(path.dirname(moduleDir), f).replace(/\\/g, "/"),
        mtime: fs.statSync(f).mtime,
      });
    }
    const moduleName = project.meta.module || project.meta.name || "module";
    const { scene } = buildScene({ module: moduleName, cads, extractDir: moduleDir, archiveTimes, reconstructed });
    const base = new Map(reconstructed.sheets.map((s) => [s.filename, s.items]));
    return { reconstructed, overlays: sheetOverlays(scene, base).items };
  } catch (err) {
    console.warn("[cad-plot] scene overlay failed; plotting sheets without S1..SN data:", err instanceof Error ? err.message : err);
    return { reconstructed, overlays: new Map<string, RenderItem[]>() };
  }
}

function plots(project: CorrelatedProject): Promise<Map<string, string>> {
  let job = jobs.get(project.meta.id);
  if (!job) {
    job = Promise.resolve().then(() => buildPlots(project));
    jobs.set(project.meta.id, job);
    job.catch(() => jobs.delete(project.meta.id));
  }
  return job;
}

export function sheetPlotPdf(projectId: string, sheet: string): Promise<string | null> {
  const project = loadProject(projectId);
  if (!project) return Promise.resolve(null);
  const key = decodeURIComponent(sheet).replace(/\.PDF$/i, ".CAD").toUpperCase();
  const known = project.cadSheets.some((s) => s.filename.toUpperCase() === key);
  if (!known) return Promise.resolve(null);
  return plots(project).then((map) => map.get(key) ?? null);
}

/** Every sheet PDF of the project, in sheet-list order. */
export async function allSheetPlotPdfs(projectId: string): Promise<string[] | null> {
  const project = loadProject(projectId);
  if (!project) return null;
  const map = await plots(project);
  return project.cadSheets
    .map((s) => map.get(s.filename.toUpperCase()))
    .filter((f): f is string => !!f);
}
