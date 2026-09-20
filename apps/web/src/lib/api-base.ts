/**
 * Browser-side API base URL.
 * Empty string = same-origin (local / single-host Render deploy).
 * Set NEXT_PUBLIC_API_BASE_URL to the Render origin when the UI runs on Vercel.
 * On Vercel builds, defaults to the production Render API if unset.
 */
const RENDER_API_DEFAULT = "https://infi90-migration-api.onrender.com";

export function getApiBaseUrl(): string {
  const base = (process.env.NEXT_PUBLIC_API_BASE_URL || "").trim().replace(/\/$/, "");
  if (base) return base;
  if (process.env.VERCEL === "1" || process.env.VERCEL === "true") {
    return RENDER_API_DEFAULT;
  }
  return "";
}

export function apiUrl(path: string): string {
  const base = getApiBaseUrl();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${normalized}` : normalized;
}
