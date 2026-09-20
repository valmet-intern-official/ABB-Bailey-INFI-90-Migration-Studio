import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { projectArtifactsDir } from "@/lib/store";

export const runtime = "nodejs";

const ALLOWED: Record<string, string> = {
  "io-xlsx": "IO_List.xlsx",
  "logic-xlsx": "Logic_Specification.xlsx",
  "cad-pdf": "CAD_Logic.pdf",
  "m1-pdf": "M1_Graphics.pdf",
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
