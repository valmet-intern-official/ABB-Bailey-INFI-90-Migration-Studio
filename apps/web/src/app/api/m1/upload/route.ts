import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { M1BusyError, startM1Session } from "@/lib/m1-session";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (!files.length) return NextResponse.json({ error: "Upload one or more .M1 files or a ZIP of them" }, { status: 400 });
    const maxBytes = Math.max(1, Number(process.env.MAX_UPLOAD_MB || "100")) * 1024 * 1024;
    const total = files.reduce((n, f) => n + f.size, 0);
    if (total > maxBytes) return NextResponse.json({ error: "Upload exceeds the maximum size" }, { status: 413 });
    const bad = files.find((f) => !/\.(m1|zip)$/i.test(f.name));
    if (bad) return NextResponse.json({ error: `${bad.name} is not an .M1 file or ZIP` }, { status: 400 });

    const uploads = await Promise.all(
      files.map(async (f) => ({ name: path.basename(f.name).replace(/[^\w.\-()+ ]+/g, "_"), data: Buffer.from(await f.arrayBuffer()) }))
    );
    const refFile = form.get("reference");
    let reference: Buffer | null = null;
    if (refFile instanceof File && refFile.size > 0) {
      if (!/\.pdf$/i.test(refFile.name)) return NextResponse.json({ error: "Reference must be a PDF" }, { status: 400 });
      reference = Buffer.from(await refFile.arrayBuffer());
    }

    const { id } = startM1Session(uploads, reference);
    console.info(JSON.stringify({ event: "m1.extract.start", id, uploads: uploads.length, bytes: total, reference: Boolean(reference) }));
    return NextResponse.json({ id, state: "running", statusUrl: `/api/m1/${id}/status` }, { status: 202 });
  } catch (err) {
    if (err instanceof M1BusyError) return NextResponse.json({ error: err.message }, { status: 429 });
    console.error(JSON.stringify({ event: "m1.extract.failed", error: err instanceof Error ? err.message : String(err) }));
    return NextResponse.json({ error: err instanceof Error ? err.message : "M1 extraction failed" }, { status: 500 });
  }
}
