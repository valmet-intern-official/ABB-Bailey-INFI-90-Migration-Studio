import { NextRequest, NextResponse } from "next/server";
import { getCorsOrigins, isProduction } from "@/lib/env";

function resolveAllowedOrigin(requestOrigin: string | null): string | null {
  if (!requestOrigin) return null;
  const allowed = getCorsOrigins();
  if (allowed.includes(requestOrigin)) return requestOrigin;
  // Local development convenience when CORS_ORIGINS is unset
  if (!isProduction() && allowed.length === 0) {
    if (
      requestOrigin.startsWith("http://localhost:") ||
      requestOrigin.startsWith("http://127.0.0.1:")
    ) {
      return requestOrigin;
    }
  }
  return null;
}

export function applyCorsHeaders(
  req: NextRequest,
  res: NextResponse
): NextResponse {
  const origin = req.headers.get("origin");
  const allowed = resolveAllowedOrigin(origin);
  if (allowed) {
    res.headers.set("Access-Control-Allow-Origin", allowed);
    res.headers.set("Vary", "Origin");
    res.headers.set("Access-Control-Allow-Credentials", "true");
    res.headers.set(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,PATCH,DELETE,OPTIONS"
    );
    res.headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With"
    );
    res.headers.set("Access-Control-Max-Age", "86400");
  }
  return res;
}

export function corsPreflight(req: NextRequest): NextResponse | null {
  if (req.method !== "OPTIONS") return null;
  const res = new NextResponse(null, { status: 204 });
  return applyCorsHeaders(req, res);
}

export function jsonWithCors(
  req: NextRequest,
  body: unknown,
  init?: ResponseInit
): NextResponse {
  return applyCorsHeaders(req, NextResponse.json(body, init));
}
