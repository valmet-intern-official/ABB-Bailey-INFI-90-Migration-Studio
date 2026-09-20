import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { cadSheetToSvg } from "@infi90/renderers";
import { loadProject, projectArtifactsDir } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; sheet: string }> }
) {
  const { id, sheet } = await ctx.params;
  const decoded = decodeURIComponent(sheet);
  const project = loadProject(id);

  // Prefer live render from engineering model so layout fixes apply immediately
  const cad = project?.cadSheets.find(
    (s) =>
      s.filename.toUpperCase() === decoded.toUpperCase() ||
      s.filename.replace(/\.CAD$/i, "").toUpperCase() ===
        decoded.replace(/\.CAD$/i, "").toUpperCase()
  );
  if (cad) {
    const svg = cadSheetToSvg(cad);
    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const name = decoded.replace(/\.CAD$/i, ".svg");
  const filePath = path.join(projectArtifactsDir(id), "cad-svg", name);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "SVG not found" }, { status: 404 });
  }
  const svg = fs.readFileSync(filePath, "utf8");
  return new NextResponse(svg, {
    headers: { "Content-Type": "image/svg+xml; charset=utf-8" },
  });
}
