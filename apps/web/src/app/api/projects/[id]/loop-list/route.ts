import { NextResponse } from "next/server";
import { loopListCells, loopListRows } from "@infi90/core";
import { loadLoopList } from "@/lib/loop-list";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const list = loadLoopList(id);
  if (!list) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  const rows = list.loops.flatMap((l) =>
    loopListRows(l).map((r) => ({ loopId: l.id, cells: loopListCells(r) }))
  );
  return NextResponse.json(
    { loops: list.loops.filter((l) => l.loopTag), rows },
    { headers: { "Cache-Control": "no-store" } }
  );
}
