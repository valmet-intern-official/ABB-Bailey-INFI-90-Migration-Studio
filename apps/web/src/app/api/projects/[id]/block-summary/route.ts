import { NextResponse } from "next/server";
import { loadBlockSummary } from "@/lib/block-summary";
import { CAD_LOGIC_MISSING } from "@/lib/cad-logic-store";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const summary = loadBlockSummary(id);
  if (!summary) return NextResponse.json({ error: CAD_LOGIC_MISSING }, { status: 404 });
  return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
}
