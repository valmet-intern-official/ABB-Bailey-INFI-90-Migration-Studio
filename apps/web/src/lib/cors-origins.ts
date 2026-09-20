/**
 * Edge-safe CORS origin helpers (usable from middleware + Node route handlers).
 * Do not import Node-only modules here.
 */

/** Production Vercel hosts for this product (exact match). */
export const DEFAULT_CORS_ORIGINS = [
  "https://abb-bailey-infi90-migration-studio.vercel.app",
  "https://infi90-migration-studio.vercel.app",
  "https://abb-bailey-infi-90-migration-studio.vercel.app",
] as const;

/** Hostname prefixes that may appear on Vercel production + preview URLs. */
const VERCEL_HOST_PREFIXES = [
  "abb-bailey-infi90-migration-studio",
  "infi90-migration-studio",
  "abb-bailey-infi-90-migration-studio",
] as const;

/** Allowed browser origins for CORS (comma-separated env + defaults). */
export function getCorsOrigins(): string[] {
  const raw =
    process.env.CORS_ORIGINS?.trim() || process.env.FRONTEND_ORIGIN?.trim();
  const fromEnv = raw
    ? raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  return [...new Set([...fromEnv, ...DEFAULT_CORS_ORIGINS])];
}

/** True when Origin is an allowed Vercel host for this app (prod or preview). */
export function isAllowedVercelOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return false;
    const host = url.hostname;
    if (!host.endsWith(".vercel.app")) return false;
    return VERCEL_HOST_PREFIXES.some(
      (prefix) => host === `${prefix}.vercel.app` || host.startsWith(`${prefix}-`)
    );
  } catch {
    return false;
  }
}

export function resolveCorsOrigin(requestOrigin: string | null): string | null {
  if (!requestOrigin) return null;
  const allowed = getCorsOrigins();
  if (allowed.includes(requestOrigin)) return requestOrigin;
  if (isAllowedVercelOrigin(requestOrigin)) return requestOrigin;
  if (
    process.env.NODE_ENV !== "production" &&
    (requestOrigin.startsWith("http://localhost:") ||
      requestOrigin.startsWith("http://127.0.0.1:"))
  ) {
    return requestOrigin;
  }
  return null;
}
