import fs from "node:fs";
import path from "node:path";
import { decodeM1 } from "../src/decoder/scanner";
import { buildSceneGraph } from "../src/scene/scene";
import { layoutScene } from "../src/render/layout";
import { renderSvg } from "../src/render/svg";
import { svgToPng } from "../src/render/png";
import { fallbackPalette, type Palette } from "../src/render/palette";

const [dir, outDir, paletteFile, ...only] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const palette: Palette = paletteFile && paletteFile !== "-" ? JSON.parse(fs.readFileSync(paletteFile, "utf8")) : fallbackPalette();
for (const f of fs.readdirSync(dir).filter((x) => /\.m1$/i.test(x)).sort()) {
  if (only.length && !only.some((o) => f.startsWith(o))) continue;
  const d = decodeM1(fs.readFileSync(path.join(dir, f)), f);
  const scene = buildSceneGraph(d);
  const layout = layoutScene(scene, { palette });
  const svg = renderSvg(layout, { title: f });
  const base = path.join(outDir, f.replace(/\.m1$/i, ""));
  fs.writeFileSync(base + ".svg", svg);
  fs.writeFileSync(base + ".png", await svgToPng(svg));
  const e = scene.extent;
  console.log(f, `extent=[${e.minX.toFixed(1)},${e.minY.toFixed(1)}]-[${e.maxX.toFixed(1)},${e.maxY.toFixed(1)}]`, `nodes=${scene.nodes.length}`, `issues=${scene.issues.length}`, JSON.stringify(scene.stats));
}
