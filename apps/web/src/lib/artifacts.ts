import path from "node:path";
import type { CorrelatedProject } from "@infi90/core";
import {
  exportIoListExcel,
  exportLogicExcel,
} from "@infi90/exporters";
import {
  renderCadSheetsPdf,
  renderM1GraphicsPdf,
  writeCadSvgs,
  writeM1Svgs,
} from "@infi90/renderers";
import { projectArtifactsDir } from "@/lib/store";

export async function writeArtifacts(project: CorrelatedProject) {
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
  await run("Logic Excel", () =>
    exportLogicExcel(project, path.join(artifacts, "Logic_Specification.xlsx"))
  );
  await run("CAD PDF", () =>
    renderCadSheetsPdf(project.cadSheets, path.join(artifacts, "CAD_Logic.pdf"))
  );
  await run("M1 PDF", () =>
    renderM1GraphicsPdf(
      project.graphics,
      path.join(artifacts, "M1_Graphics.pdf")
    )
  );
  await run("CAD SVG", () =>
    writeCadSvgs(project.cadSheets, path.join(artifacts, "cad-svg"))
  );
  await run("M1 SVG", () =>
    writeM1Svgs(project.graphics, path.join(artifacts, "m1-svg"))
  );

  return { artifacts, errors };
}
