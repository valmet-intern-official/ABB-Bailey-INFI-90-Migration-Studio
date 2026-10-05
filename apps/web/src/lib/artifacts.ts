import path from "node:path";
import type { CorrelatedProject } from "@infi90/core";
import { exportIoListExcel, exportLoopListExcel } from "@infi90/exporters";
import { renderCadSheetsPdf, writeCadSvgs } from "@infi90/renderers";
import { writeCadSpecPdf } from "@/lib/function-blocks";
import { loadLoopList } from "@/lib/loop-list";
import { projectArtifactsDir } from "@/lib/store";

export const LOOP_LIST_XLSX = "Loop_List.xlsx";

export async function writeArtifacts(project: CorrelatedProject, opts: { extractDir?: string } = {}) {
  const artifacts = projectArtifactsDir(project.meta.id);
  const errors: string[] = [];

  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  await run("IO Excel", () =>
    exportIoListExcel(project, path.join(artifacts, "IO_List.xlsx"))
  );
  const cadPdf = path.join(artifacts, "CAD_Logic.pdf");
  await run("CAD PDF", async () => {
    // Drawings plus S1…SN specifications need the raw CAD set; without it only the drawings are rendered.
    if (opts.extractDir) {
      try {
        if (writeCadSpecPdf(project, opts.extractDir, cadPdf)) return;
      } catch (e) {
        errors.push(`CAD PDF specifications: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await renderCadSheetsPdf(project.cadSheets, cadPdf);
  });
  await run("Loop List Excel", async () => {
    const list = loadLoopList(project.meta.id, project);
    if (list) await exportLoopListExcel(list, path.join(artifacts, LOOP_LIST_XLSX));
  });
  await run("CAD SVG", () =>
    writeCadSvgs(project.cadSheets, path.join(artifacts, "cad-svg"))
  );

  return { artifacts, errors };
}
