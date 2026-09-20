import { NextRequest, NextResponse } from "next/server";
import { getServiceName, storageWritable } from "@/lib/env";
import { applyCorsHeaders, corsPreflight } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function healthResponse(req: NextRequest) {
  if (req.method === "OPTIONS") {
    return corsPreflight(req) ?? new NextResponse(null, { status: 204 });
  }

  const storage = storageWritable();
  const healthy = storage.ok;
  const body = {
    status: healthy ? "healthy" : "degraded",
    service: getServiceName(),
    timestamp: new Date().toISOString(),
    checks: {
      storage: {
        status: storage.ok ? "ok" : "fail",
        detail: storage.ok ? "writable" : storage.detail,
      },
      migrationEngine: {
        status: "ok",
        mode: "in-process",
        note: "CAD parse/export runs synchronously in the API process",
      },
    },
  };

  const res = NextResponse.json(body, { status: healthy ? 200 : 503 });
  return applyCorsHeaders(req, res);
}
