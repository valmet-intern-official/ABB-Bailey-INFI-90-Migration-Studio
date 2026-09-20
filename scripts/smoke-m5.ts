import fs from "node:fs";
import path from "node:path";
import { processModuleZip } from "../packages/parsers/src/pipeline.ts";
import {
  exportIoListExcel,
  exportLogicExcel,
} from "../packages/exporters/src/excel.ts";
import {
  renderCadSheetsPdf,
  renderM1GraphicsPdf,
  writeCadSvgs,
} from "../packages/renderers/src/pdf.ts";

async function main() {
  const root = process.cwd();
  const work = path.join(root, "apps/web/data/work-test");
  fs.mkdirSync(work, { recursive: true });

  console.log("Processing M5.zip…");
  const project = processModuleZip({
    zipPath: path.join(root, "Input/M5.zip"),
    workDir: work,
    module: "M5",
    loop: "L3",
    cpu: "P7",
  });

  console.log("CAD", project.stats.cadCount, "M1", project.stats.m1Count);
  console.log("IO", project.stats.ioByType);
  console.log("logic", project.logicRecords.length);
  console.log("validation errors", project.stats.unresolvedCount);
  console.log("OUT entries mapped IO", project.ioRecords.length);

  const art = path.join(work, "artifacts");
  fs.mkdirSync(art, { recursive: true });
  await exportIoListExcel(project, path.join(art, "IO_List.xlsx"));
  await exportLogicExcel(project, path.join(art, "Logic_Specification.xlsx"));
  await renderCadSheetsPdf(project.cadSheets, path.join(art, "CAD_Logic.pdf"));
  await renderM1GraphicsPdf(
    project.graphics,
    path.join(art, "M1_Graphics.pdf")
  );
  await writeCadSvgs(project.cadSheets.slice(0, 5), path.join(art, "cad-svg"));
  console.log("Wrote artifacts to", art);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
