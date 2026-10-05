import { NextResponse } from "next/server";
import { CAD_LOGIC_MISSING, loadCadLogic } from "@/lib/cad-logic-store";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const logic = loadCadLogic(id);
  if (!logic) return NextResponse.json({ error: CAD_LOGIC_MISSING }, { status: 404 });
  return NextResponse.json({ sheets: logic }, { headers: { "Cache-Control": "no-store" } });
}
