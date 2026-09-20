import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { classifyFiles, type ClassifiedArchive } from "./classify";

export interface ExtractedArchive {
  extractDir: string;
  classified: ClassifiedArchive;
  zipName: string;
}

const MAX_ENTRY_BYTES = 200 * 1024 * 1024; // 200 MB per entry
const MAX_TOTAL_UNCOMPRESSED = 800 * 1024 * 1024; // 800 MB total

function assertSafeZipEntry(destDir: string, entryName: string) {
  const normalized = entryName.replace(/\\/g, "/");
  if (
    normalized.startsWith("/") ||
    normalized.includes("..") ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    throw new Error(`Unsafe ZIP entry path rejected: ${entryName}`);
  }
  const target = path.resolve(destDir, normalized);
  const root = path.resolve(destDir);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`ZIP path traversal rejected: ${entryName}`);
  }
  return { normalized, target };
}

/**
 * Extract a Bailey package ZIP safely (no path traversal, size caps).
 * Uploaded archives are parsed only — never executed.
 */
export function extractZip(
  zipPath: string,
  destDir: string
): ExtractedArchive {
  fs.mkdirSync(destDir, { recursive: true });
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  let total = 0;

  for (const entry of entries) {
    if (entry.isDirectory) {
      assertSafeZipEntry(destDir, entry.entryName);
      continue;
    }
    const size = entry.header.size;
    if (size > MAX_ENTRY_BYTES) {
      throw new Error(
        `ZIP entry too large (${size} bytes): ${entry.entryName}`
      );
    }
    total += size;
    if (total > MAX_TOTAL_UNCOMPRESSED) {
      throw new Error("ZIP uncompressed size exceeds safety limit");
    }
    const { target } = assertSafeZipEntry(destDir, entry.entryName);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.getData());
  }

  const listed: { relativePath: string; size: number }[] = [];
  const walk = (dir: string, relBase = "") => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const rel = relBase ? `${relBase}/${name}` : name;
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full, rel);
      else
        listed.push({
          relativePath: rel.replace(/\\/g, "/"),
          size: st.size,
        });
    }
  };
  walk(destDir);

  return {
    extractDir: destDir,
    classified: classifyFiles(listed),
    zipName: path.basename(zipPath),
  };
}

export function readArchiveFile(
  extractDir: string,
  relativePath: string
): Buffer {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.includes("..") || normalized.startsWith("/")) {
    throw new Error(`Unsafe archive path: ${relativePath}`);
  }
  const full = path.resolve(extractDir, normalized);
  const root = path.resolve(extractDir);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error(`Unsafe archive path: ${relativePath}`);
  }
  return fs.readFileSync(full);
}
