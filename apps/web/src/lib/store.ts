import fs from "node:fs";
import path from "node:path";
import type { CorrelatedProject } from "@infi90/core";
import { getStorageRoot } from "@/lib/env";

/** Ephemeral working data only — not a project library. */
function dataRoot() {
  return getStorageRoot();
}

export function ensureDataRoot() {
  const root = dataRoot();
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, "sessions"), { recursive: true });
  return root;
}

export function sessionDir(sessionId: string) {
  return path.join(ensureDataRoot(), "sessions", sessionId);
}

/** @deprecated use sessionDir — kept for existing artifact paths during migration */
export function projectDir(projectId: string) {
  const next = sessionDir(projectId);
  const legacy = path.join(ensureDataRoot(), "projects", projectId);
  if (fs.existsSync(next)) return next;
  if (fs.existsSync(legacy)) return legacy;
  return next;
}

export function saveSession(project: CorrelatedProject) {
  const dir = sessionDir(project.meta.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "project.json"),
    JSON.stringify(project, null, 2),
    "utf8"
  );
  return dir;
}

/** Alias for upload pipeline compatibility */
export function saveProject(project: CorrelatedProject) {
  return saveSession(project);
}

export function loadSession(sessionId: string): CorrelatedProject | null {
  const candidates = [
    path.join(sessionDir(sessionId), "project.json"),
    path.join(ensureDataRoot(), "projects", sessionId, "project.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf8")) as CorrelatedProject;
    }
  }
  return null;
}

export function loadProject(projectId: string): CorrelatedProject | null {
  return loadSession(projectId);
}

export function sessionArtifactsDir(sessionId: string) {
  const dir = path.join(projectDir(sessionId), "artifacts");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function projectArtifactsDir(projectId: string) {
  return sessionArtifactsDir(projectId);
}
