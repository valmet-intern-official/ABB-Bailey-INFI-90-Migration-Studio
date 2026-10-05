import fs from "node:fs";
import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { allSheetPlotPdfs } from "@/lib/cad-plot";
import { loadProject } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 300;

/** All original sheet PDFs joined page by page, with no cover, footer or markup added. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const project = loadProject(id);
  const files = await allSheetPlotPdfs(id);
  if (!project || !files) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (files.length === 0) {
    return NextResponse.json({ error: "No CAD sheet PDFs available" }, { status: 404 });
  }

  const out = await PDFDocument.create();
  for (const file of files) {
    const src = await PDFDocument.load(fs.readFileSync(file));
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const page of pages) out.addPage(page);
  }
  const bytes = await out.save();
  const name = `${(project.meta.module || project.meta.name || "cad").replace(/[^\w.-]+/g, "_")}_CAD_Sheets.pdf`;
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "no-store",
    },
  });
}
