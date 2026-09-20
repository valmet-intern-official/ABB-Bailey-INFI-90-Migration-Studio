import { NextResponse } from "next/server";
import { loadProject } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const project = loadProject(id);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Strip bulky rawStrings for client payload
  const slim = {
    ...project,
    cadSheets: project.cadSheets.map((s) => ({
      ...s,
      rawStrings: s.rawStrings.slice(0, 40),
    })),
  };
  return NextResponse.json(slim);
}
