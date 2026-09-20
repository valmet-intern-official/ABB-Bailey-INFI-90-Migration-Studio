import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { processModuleZip } from "@infi90/parsers";
import { ensureDataRoot, loadProject, saveProject } from "@/lib/store";
import { writeArtifacts } from "@/lib/artifacts";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Re-run the decode pipeline for an existing session against its original
 * upload. Sessions persist their parsed model, so a decoder improvement is
 * otherwise invisible until the archive is uploaded again. The session id is
 * preserved so any open viewer URL keeps working.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const existing = loadProject(id);
    if (!existing) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const uploads = path.join(ensureDataRoot(), "uploads");
    const zipName = existing.meta.sourceZipName;
    if (!zipName || !fs.existsSync(uploads)) {
      return NextResponse.json(
        { error: "Original upload is no longer available — please re-upload" },
        { status: 409 }
      );
    }

    // Depending on when the session was created, sourceZipName is either the
    // stored name (`<timestamp>_<original>`) or the user's original filename.
    const stored = fs.readdirSync(uploads);
    const wanted = zipName.toLowerCase();
    const candidate =
      stored.find((f) => f.toLowerCase() === wanted) ??
      stored
        .filter((f) => f.toLowerCase().endsWith(`_${wanted}`))
        .sort()
        .pop();
    if (!candidate) {
      return NextResponse.json(
        { error: `No stored upload matching ${zipName} — please re-upload` },
        { status: 409 }
      );
    }

    const workDir = path.join(ensureDataRoot(), "work", `redecode_${Date.now()}`);
    fs.mkdirSync(workDir, { recursive: true });

    const project = processModuleZip({
      zipPath: path.join(uploads, candidate),
      workDir,
      projectName: existing.meta.name,
      loop: existing.meta.loop,
      cpu: existing.meta.cpu,
      module: existing.meta.module,
    });

    project.meta.id = id;
    project.meta.createdAt = existing.meta.createdAt;
    saveProject(project);
    const { errors } = await writeArtifacts(project);

    const decoded = project.cadSheets.filter(
      (s) => s.engineeringModel?.blocks[0]?.trace.sourceMethod === "CAD_NATIVE"
    );
    const blockTotal = project.cadSheets.reduce(
      (n, s) => n + (s.engineeringModel?.stats.blockCount ?? 0),
      0
    );
    const connTotal = project.cadSheets.reduce(
      (n, s) => n + (s.engineeringModel?.stats.connectionCount ?? 0),
      0
    );

    return NextResponse.json({
      id,
      cadSheets: project.cadSheets.length,
      nativeDecoded: decoded.length,
      blockTotal,
      connTotal,
      artifactErrors: errors,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Re-decode failed" },
      { status: 500 }
    );
  }
}
