import { NextResponse } from "next/server";
import { isValidSessionId, loadM1Categories, loadM1Index, saveM1Categories } from "@/lib/m1-session";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isValidSessionId(id)) return NextResponse.json({ error: "invalid session" }, { status: 400 });
  if (!loadM1Index(id)) return NextResponse.json({ error: "session not found" }, { status: 404 });
  return NextResponse.json({ categories: loadM1Categories(id) });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isValidSessionId(id)) return NextResponse.json({ error: "invalid session" }, { status: 400 });
  if (!loadM1Index(id)) return NextResponse.json({ error: "session not found" }, { status: 404 });
  let body: { categories?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    return NextResponse.json({ categories: saveM1Categories(id, body.categories) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
