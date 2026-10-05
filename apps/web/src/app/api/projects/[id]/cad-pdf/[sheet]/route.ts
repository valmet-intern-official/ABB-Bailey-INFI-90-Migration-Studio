import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { sheetPlotPdf } from "@/lib/cad-plot";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; sheet: string }> }
) {
  const { id, sheet } = await ctx.params;
  const file = await sheetPlotPdf(id, decodeURIComponent(sheet));
  if (!file) {
    return NextResponse.json({ error: "Sheet PDF not found" }, { status: 404 });
  }
  const bytes = fs.readFileSync(file);
  const filename = path.basename(file);
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=86400",
    },
  });
}
