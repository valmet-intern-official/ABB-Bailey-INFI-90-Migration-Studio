import fs from "node:fs";
import path from "node:path";
import { CAD_LOGIC_FILE, type CadLogic } from "@/lib/function-blocks";
import { projectArtifactsDir } from "@/lib/store";

const cache = new Map<string, { mtimeMs: number; data: CadLogic }>();

/** The session's per-sheet function-block schedule, or null when it has not been generated. */
export function loadCadLogic(id: string): CadLogic | null {
  const file = path.join(projectArtifactsDir(id), CAD_LOGIC_FILE);
  if (!fs.existsSync(file)) return null;
  const { mtimeMs } = fs.statSync(file);
  const hit = cache.get(id);
  if (hit && hit.mtimeMs === mtimeMs) return hit.data;
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as CadLogic;
  cache.set(id, { mtimeMs, data });
  return data;
}

export const CAD_LOGIC_MISSING = "Function-block specifications are not available for this session";
