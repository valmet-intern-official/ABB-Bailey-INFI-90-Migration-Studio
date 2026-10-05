import { NextResponse } from "next/server";
import { loadCadLogic, CAD_LOGIC_MISSING } from "@/lib/cad-logic-store";
import { buildLogicReport } from "@/lib/logic-report";
import { loadProject } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const project = loadProject(id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const logic = loadCadLogic(id);
  if (!logic) return NextResponse.json({ error: CAD_LOGIC_MISSING }, { status: 404 });
  const pdf = await buildLogicReport(project, logic);
  const name = `${(project.meta.module || project.meta.name || "logic").replace(/[^\w.-]+/g, "_")}_Logic_Report.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Length": String(pdf.length),
      "Cache-Control": "no-store",
    },
  });
}
