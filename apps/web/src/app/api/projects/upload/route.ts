import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { processModuleZip } from "@infi90/parsers";
import { ensureDataRoot, saveProject } from "@/lib/store";
import { writeArtifacts } from "@/lib/artifacts";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    ensureDataRoot();
    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "ZIP file required" }, { status: 400 });
    }

    if (!/\.zip$/i.test(file.name)) {
      return NextResponse.json(
        { error: "Only .zip Bailey Bus/Module packages are accepted" },
        { status: 400 }
      );
    }

    const maxUploadMb = Number(process.env.MAX_UPLOAD_MB || "100");
    const maxBytes = Math.max(1, maxUploadMb) * 1024 * 1024;
    if (file.size <= 0) {
      return NextResponse.json({ error: "Uploaded ZIP is empty" }, { status: 400 });
    }
    if (file.size > maxBytes) {
      return NextResponse.json(
        { error: `ZIP exceeds maximum size of ${maxUploadMb} MB` },
        { status: 413 }
      );
    }

    const loop = String(form.get("loop") || "") || undefined;
    const cpu = String(form.get("cpu") || "") || undefined;
    const moduleName = String(form.get("module") || "") || undefined;
    const projectName = String(form.get("name") || "") || undefined;

    const safeName = path.basename(file.name).replace(/[^\w.\-()+ ]+/g, "_");
    const uploads = path.join(ensureDataRoot(), "uploads");
    fs.mkdirSync(uploads, { recursive: true });
    const zipPath = path.join(uploads, `${Date.now()}_${safeName}`);
    const buf = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(zipPath, buf);

    const workDir = path.join(ensureDataRoot(), "work", `${Date.now()}`);
    fs.mkdirSync(workDir, { recursive: true });

    const started = Date.now();
    console.info(
      JSON.stringify({
        event: "migration.upload.start",
        zipName: safeName,
        bytes: buf.length,
        at: new Date().toISOString(),
      })
    );

    const project = processModuleZip({
      zipPath,
      workDir,
      projectName: projectName || safeName.replace(/\.zip$/i, ""),
      loop,
      cpu,
      module: moduleName,
    });

    // Ephemeral session only — no project library / index is maintained.
    saveProject(project);
    const { errors } = await writeArtifacts(project);

    console.info(
      JSON.stringify({
        event: "migration.upload.complete",
        job_id: project.meta.id,
        project_id: project.meta.id,
        upload_id: path.basename(zipPath),
        status: errors.length ? "COMPLETED_WITH_WARNINGS" : "COMPLETED",
        stage: "artifacts",
        duration_ms: Date.now() - started,
        error_count: errors.length,
        warning_count: project.validation?.length ?? 0,
        cadCount: project.stats?.cadCount,
        at: new Date().toISOString(),
      })
    );

    return NextResponse.json({
      id: project.meta.id,
      name: project.meta.name,
      session: true,
      meta: project.meta,
      stats: project.stats,
      inventoryCount: project.inventory.length,
      validationCount: project.validation.length,
      artifactErrors: errors,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "migration.upload.failed",
        status: "FAILED",
        error: err instanceof Error ? err.message : String(err),
        at: new Date().toISOString(),
      })
    );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Processing failed" },
      { status: 500 }
    );
  }
}
