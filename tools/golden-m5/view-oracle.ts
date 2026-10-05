import fs from "node:fs";
import path from "node:path";
import { readPdf } from "./lib/pdf";
import { normalizePage } from "./lib/oracle";
import { oracleSvg, svgToPng } from "./lib/raster";

const [pdfFile, pagesArg, rotArg, outDir = "tools/golden-m5/out/view"] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const pages = readPdf(pdfFile);
for (const n of pagesArg.split(",").map(Number)) {
  const p = normalizePage(pages[n - 1], Number(rotArg) as 0 | 90);
  const file = path.join(outDir, `${path.basename(pdfFile, ".pdf").replace(/\s+/g, "_")}_p${n}.png`);
  await svgToPng(oracleSvg(p), file, 3);
  console.log(`${file}  cad=${p.cadName}`);
}
