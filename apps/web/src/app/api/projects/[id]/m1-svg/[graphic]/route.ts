import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { m1GraphicToSvg } from "@infi90/renderers";
import { loadProject, projectArtifactsDir } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; graphic: string }> }
) {
  const { id, graphic } = await ctx.params;
  const decoded = decodeURIComponent(graphic);
  const project = loadProject(id);

  // Live render so page-size fixes apply without re-upload
  const m1 = project?.graphics.find(
    (g) =>
      g.filename.toUpperCase() === decoded.toUpperCase() ||
      g.filename.replace(/\.m1$/i, "").toUpperCase() ===
        decoded.replace(/\.m1$/i, "").toUpperCase()
  );
  if (m1) {
    const svg = m1GraphicToSvg(m1);
    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const name = decoded.replace(/\.m1$/i, ".svg");
  const filePath = path.join(projectArtifactsDir(id), "m1-svg", name);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "SVG not found" }, { status: 404 });
  }
  const svg = fs.readFileSync(filePath, "utf8");
  return new NextResponse(svg, {
    headers: { "Content-Type": "image/svg+xml; charset=utf-8" },
  });
}
