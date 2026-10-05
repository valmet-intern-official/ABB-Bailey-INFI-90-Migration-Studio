import { NextResponse } from "next/server";
import { exportM1Graphics } from "@/lib/m1-export";
import { isValidSessionId, loadM1Index } from "@/lib/m1-session";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isValidSessionId(id)) return NextResponse.json({ error: "invalid session" }, { status: 400 });
  if (!loadM1Index(id)) return NextResponse.json({ error: "session not found" }, { status: 404 });
  let body: { categories?: unknown; variant?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const categoryIds = Array.isArray(body.categories) ? body.categories.filter((c): c is string => typeof c === "string") : undefined;
  const variant = body.variant === "marking" ? "marking" : "original";
  try {
    const out = await exportM1Graphics(id, { categoryIds, variant });
    return new Response(new Uint8Array(out.body), {
      headers: {
        "content-type": out.contentType,
        "content-disposition": `attachment; filename="${out.filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
