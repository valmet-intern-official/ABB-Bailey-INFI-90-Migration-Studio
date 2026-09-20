import path from "node:path";
import {
  classifyExtension,
  type FileKind,
  type InventoryFile,
  parseProvenanceFromPath,
} from "@infi90/core";

export interface ClassifiedArchive {
  files: InventoryFile[];
  byKind: Partial<Record<FileKind, InventoryFile[]>>;
  provenance: { loop?: string; cpu?: string; module?: string };
}

export function classifyFiles(
  entries: { relativePath: string; size: number }[]
): ClassifiedArchive {
  const files: InventoryFile[] = entries.map((e) => {
    const filename = path.posix.basename(e.relativePath.replace(/\\/g, "/"));
    const extension = path.extname(filename);
    return {
      relativePath: e.relativePath.replace(/\\/g, "/"),
      filename,
      extension,
      kind: classifyExtension(extension),
      size: e.size,
    };
  });

  const byKind: ClassifiedArchive["byKind"] = {};
  for (const f of files) {
    (byKind[f.kind] ??= []).push(f);
  }

  // Prefer deepest path that contains L/P/M
  let provenance: ClassifiedArchive["provenance"] = {};
  for (const f of files) {
    const p = parseProvenanceFromPath(f.relativePath);
    if (p.loop || p.cpu || p.module) {
      provenance = { ...provenance, ...p };
    }
  }
  // Also try parent folder names like M5/
  if (!provenance.module) {
    for (const f of files) {
      const m = f.relativePath.match(/(^|\/)(M\d+)(\/|$)/i);
      if (m) provenance.module = m[2].toUpperCase();
    }
  }

  return { files, byKind, provenance };
}
