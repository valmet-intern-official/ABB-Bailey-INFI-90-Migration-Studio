import path from "node:path";
import fs from "node:fs";

/**
 * Server and shared environment accessors.
 * Public frontend values must use NEXT_PUBLIC_* only.
 */

/**
 * Resolve the monorepo root (opened workspace folder) so generated
 * sessions/artifacts land under `<repo>/data`, not `apps/web/data`
 * when Next.js is started with cwd = apps/web.
 */
export function findRepoRoot(start = process.cwd()): string {
  let dir = path.resolve(start);
  for (let i = 0; i < 10; i++) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
          name?: string;
          workspaces?: unknown;
        };
        if (
          pkg.name === "infi90-migration-studio" ||
          (Array.isArray(pkg.workspaces) &&
            pkg.workspaces.some(
              (w: string) => w === "apps/*" || w === "packages/*"
            ))
        ) {
          return dir;
        }
      } catch {
        /* keep walking */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(start);
}

export function getStorageRoot(): string {
  const fromEnv = process.env.STORAGE_ROOT?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(findRepoRoot(), "data");
}

export { getCorsOrigins } from "@/lib/cors-origins";

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function getServiceName(): string {
  return process.env.SERVICE_NAME?.trim() || "infi90-migration-api";
}

/** CAD sheet SVG/PDF layout engine: source = faithful reconstruct (default), v2 = hierarchical, v1 = paint. */
export function getCadRenderEngine(): "source" | "v1" | "v2" {
  const v = (process.env.CAD_RENDER_ENGINE || "source").trim().toLowerCase();
  if (v === "v1") return "v1";
  if (v === "v2") return "v2";
  return "source";
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
