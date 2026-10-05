import { NextResponse } from "next/server";
import { isValidSessionId, loadM1Status } from "@/lib/m1-session";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isValidSessionId(id)) return NextResponse.json({ error: "invalid session" }, { status: 400 });
  const status = loadM1Status(id);
  if (!status) return NextResponse.json({ error: "session not found" }, { status: 404 });
  return NextResponse.json(status, { headers: { "cache-control": "no-store" } });
}
