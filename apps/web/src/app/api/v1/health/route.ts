import { NextRequest } from "next/server";
import { healthResponse } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return healthResponse(req);
}

export async function GET(req: NextRequest) {
  return healthResponse(req);
}
