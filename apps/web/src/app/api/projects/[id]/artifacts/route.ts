import { NextResponse } from "next/server";
import { loadProject } from "@/lib/store";
import { writeArtifacts } from "@/lib/artifacts";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const project = loadProject(id);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { errors } = await writeArtifacts(project);
  return NextResponse.json({ ok: true, errors });
}
