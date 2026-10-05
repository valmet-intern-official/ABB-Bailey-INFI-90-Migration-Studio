import fs from "node:fs";
import path from "node:path";
import { decodeM1 } from "../src/decoder/scanner";
import { validateAgainstReference } from "../src/validation/validate";
import { encodePng } from "../src/validation/raster";

const [dir, pdf, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const decoded = fs
  .readdirSync(dir)
  .filter((x) => /\.m1$/i.test(x))
  .sort()
  .map((f) => decodeM1(fs.readFileSync(path.join(dir, f)), f));
const t0 = Date.now();
const run = await validateAgainstReference(decoded, fs.readFileSync(pdf));
console.log(`validated in ${((Date.now() - t0) / 1000).toFixed(1)} s, pages=${run.referencePages}`);
for (const f of run.files) {
  const m = f.metrics;
  console.log(
    f.file.padEnd(20),
    `orig=p${f.match.originalPage} mark=p${f.match.markingPage}`,
    f.mapping ? `s=${f.mapping.s.toFixed(3)} x0=${f.mapping.x0.toFixed(1)} y0=${f.mapping.y0.toFixed(1)} reg=${f.mapping.score.toFixed(3)}` : "",
    m ? `pix=${m.pixelSimilarity.toFixed(3)} edgeP=${m.edgePrecision.toFixed(3)} edgeR=${m.edgeRecall.toFixed(3)} F1=${m.edgeF1.toFixed(3)} IoU=${m.foregroundIoU.toFixed(3)} hist=${m.histogramIntersection.toFixed(3)}` : ""
  );
  if (f.images) {
    const b = path.join(outDir, f.file.replace(/\.m1$/i, ""));
    fs.writeFileSync(b + "-side.png", await encodePng(f.images.sideBySide));
    fs.writeFileSync(b + "-overlay.png", await encodePng(f.images.overlay));
  }
}
if (run.calibration) {
  fs.writeFileSync(path.join(outDir, "palette.json"), JSON.stringify(run.calibration.palette, null, 1));
  const e = run.calibration.palette.entries;
  console.log("calibrated indices:", Object.keys(e).length, "rejected:", Object.keys(run.calibration.rejected).length);
  for (const [i, v] of Object.entries(e)) console.log(`  ${i.padStart(3)} rgb(${v.rgb.join(",")})  ${v.evidence}`);
  for (const [i, v] of Object.entries(run.calibration.rejected)) console.log(`  rejected ${i}: ${v.reason}`);
}
