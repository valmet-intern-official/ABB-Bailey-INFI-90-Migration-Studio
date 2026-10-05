import { NextResponse } from "next/server";
import { CAD_LOGIC_MISSING, loadCadLogic } from "@/lib/cad-logic-store";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; sheet: string }> }
) {
  const { id, sheet } = await ctx.params;
  const logic = loadCadLogic(id);
  if (!logic) return NextResponse.json({ error: CAD_LOGIC_MISSING }, { status: 404 });
  const name = decodeURIComponent(sheet).toUpperCase();
  const key = /\.CAD$/.test(name) ? name : `${name}.CAD`;
  return NextResponse.json(
    { blocks: logic[key] ?? [] },
    { headers: { "Cache-Control": "no-store" } }
  );
}
