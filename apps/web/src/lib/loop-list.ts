import fs from "node:fs";
import path from "node:path";
import type { CorrelatedProject, LoopList } from "@infi90/core";
import { buildLoopList } from "@infi90/parsers";
import { loadCadLogic } from "@/lib/cad-logic-store";
import { CAD_LOGIC_FILE } from "@/lib/function-blocks";
import { loadProject, projectArtifactsDir, sessionDir } from "@/lib/store";

const cache = new Map<string, { key: string; data: LoopList }>();

const mtime = (file: string) => (fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0);

/** The session's Loop List, built from its I/O records, CAD wiring and decoded specifications. */
export function loadLoopList(id: string, project?: CorrelatedProject): LoopList | null {
  const key = `${mtime(path.join(sessionDir(id), "project.json"))}:${mtime(path.join(projectArtifactsDir(id), CAD_LOGIC_FILE))}`;
  const hit = cache.get(id);
  if (hit && hit.key === key && !project) return hit.data;
  const p = project ?? loadProject(id);
  if (!p) return null;
  const data = buildLoopList(p, loadCadLogic(id));
  cache.set(id, { key, data });
  return data;
}
