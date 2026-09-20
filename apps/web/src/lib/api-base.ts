/**
 * Browser-side API base URL.
 * Empty string = same-origin (local / single-host Render deploy).
 * Set NEXT_PUBLIC_API_BASE_URL to the Render origin when the UI runs on Vercel.
 */
export function getApiBaseUrl(): string {
  const base = (process.env.NEXT_PUBLIC_API_BASE_URL || "").trim().replace(/\/$/, "");
  return base;
}

export function apiUrl(path: string): string {
  const base = getApiBaseUrl();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${normalized}` : normalized;
}
