import path from "node:path";
import fs from "node:fs";

/**
 * Server and shared environment accessors.
 * Public frontend values must use NEXT_PUBLIC_* only.
 */

export function getStorageRoot(): string {
  const fromEnv = process.env.STORAGE_ROOT?.trim();
  if (fromEnv) return fromEnv;
  return path.join(process.cwd(), "data");
}

/** Allowed browser origins for CORS (comma-separated). */
export function getCorsOrigins(): string[] {
  const raw =
    process.env.CORS_ORIGINS?.trim() || process.env.FRONTEND_ORIGIN?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function getServiceName(): string {
  return process.env.SERVICE_NAME?.trim() || "infi90-migration-api";
}

export function storageWritable(): { ok: boolean; detail: string } {
  try {
    const root = getStorageRoot();
    fs.mkdirSync(root, { recursive: true });
    const probe = path.join(root, ".healthwrite");
    fs.writeFileSync(probe, String(Date.now()), "utf8");
    fs.unlinkSync(probe);
    return { ok: true, detail: root };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
