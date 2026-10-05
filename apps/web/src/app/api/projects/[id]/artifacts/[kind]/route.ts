import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { exportBlockSummaryExcel, exportIoListExcel, exportLoopListExcel } from "@infi90/exporters";
import { LOOP_LIST_XLSX } from "@/lib/artifacts";
import { BLOCK_SUMMARY_XLSX, loadBlockSummary } from "@/lib/block-summary";
import { loadLoopList } from "@/lib/loop-list";
import { loadProject, projectArtifactsDir } from "@/lib/store";

export const runtime = "nodejs";

const ALLOWED: Record<string, string> = {
  "io-xlsx": "IO_List.xlsx",
  "loop-xlsx": LOOP_LIST_XLSX,
  "blocks-xlsx": BLOCK_SUMMARY_XLSX,
  "cad-pdf": "CAD_Logic.pdf",
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; kind: string }> }
) {
  const { id, kind } = await ctx.params;
  const filename = ALLOWED[kind];
  if (!filename) {
    return NextResponse.json({ error: "Unknown artifact" }, { status: 400 });
  }
  const filePath = path.join(projectArtifactsDir(id), filename);
  if (kind === "io-xlsx") {
    const project = loadProject(id);
    if (project) await exportIoListExcel(project, filePath);
  }
  if (kind === "loop-xlsx") {
    // Built per download so sessions decoded before the Loop List existed still get one.
    const list = loadLoopList(id);
    if (list) await exportLoopListExcel(list, filePath);
  }
  if (kind === "blocks-xlsx") {
    const summary = loadBlockSummary(id);
    if (summary) await exportBlockSummaryExcel(summary, filePath);
  }
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Artifact missing" }, { status: 404 });
  }
  const data = fs.readFileSync(filePath);
  const contentType = filename.endsWith(".pdf")
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return new NextResponse(data, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
