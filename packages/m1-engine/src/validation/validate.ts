import type { DecodedM1 } from "../decoder/types";
import { buildSceneGraph, type SceneGraph } from "../scene/scene";
import { layoutScene } from "../render/layout";
import { renderSvg } from "../render/svg";
import { fallbackPalette, type Palette } from "../render/palette";
import { registerToReference, type RefMapping } from "./align";
import { calibratePalette, sampleColors, type CalibrationResult, type ColorSample } from "./calibrate";
import { compareToReference, matchAllPages, type ComparisonImages, type ComparisonMetrics, type PageMatch } from "./compare";
import { rasterizeSvg } from "./raster";
import { extractReferencePages, type ReferencePage } from "./reference-pdf";

export interface FileValidation {
  file: string;
  match: PageMatch;
  mapping: RefMapping | null;
  metrics: ComparisonMetrics | null;
  images: ComparisonImages | null;
}

export interface ValidationRun {
  referencePages: number;
  calibration: CalibrationResult | null;
  files: FileValidation[];
}

const RENDER_WIDTH = 1280;

async function renderForValidation(scene: SceneGraph, palette: Palette) {
  const layout = layoutScene(scene, { palette, width: RENDER_WIDTH, showPlaceholders: false });
  return { layout, raster: await rasterizeSvg(renderSvg(layout)) };
}

/**
 * Reference validation. The reference is an oracle only: it selects pages,
 * aligns images, scores the output and (optionally) calibrates palette RGB.
 * It never adds, moves or removes scene content.
 */
export async function validateAgainstReference(
  decoded: DecodedM1[],
  referencePdf: Buffer,
  opts: { calibrate?: boolean; scenes?: SceneGraph[] } = {}
): Promise<ValidationRun> {
  const pages = await extractReferencePages(referencePdf);
  const scenes = opts.scenes ?? decoded.map((d) => buildSceneGraph(d));
  if (scenes.length !== decoded.length) throw new Error("validation scene count does not match the decoded files");
  const pageById = new Map<number, ReferencePage>(pages.map((p) => [p.page, p]));

  const prelim: { scene: SceneGraph; match: PageMatch; mapping: RefMapping | null }[] = [];
  const samples: ColorSample[] = [];
  const first = await Promise.all(scenes.map(async (scene) => ({ scene, ...(await renderForValidation(scene, fallbackPalette())) })));
  const matches = await matchAllPages(first.map((f) => ({ file: f.scene.file, render: f.raster, ext: f.scene.extent, scale: f.layout.scale })), pages);
  for (let i = 0; i < first.length; i++) {
    const { scene, layout, raster } = first[i];
    const match = matches[i];
    const ref = match.originalPage ? pageById.get(match.originalPage) : undefined;
    const mapping = ref ? registerToReference(raster, layout.scale, ref, scene.extent) : null;
    if (ref && mapping && opts.calibrate !== false) samples.push(...sampleColors(scene.file, layout, mapping, ref));
    prelim.push({ scene, match, mapping });
  }

  const calibration = opts.calibrate !== false && samples.length ? calibratePalette(samples) : null;
  const palette = calibration?.palette ?? fallbackPalette();

  const files: FileValidation[] = [];
  for (const p of prelim) {
    const ref = p.match.originalPage ? pageById.get(p.match.originalPage) : undefined;
    if (!ref || !p.mapping) {
      files.push({ file: p.scene.file, match: p.match, mapping: null, metrics: null, images: null });
      continue;
    }
    const { raster } = await renderForValidation(p.scene, palette);
    const { metrics, images } = await compareToReference(p.scene, raster, ref, p.mapping);
    files.push({ file: p.scene.file, match: p.match, mapping: p.mapping, metrics, images });
  }
  return { referencePages: pages.length, calibration, files };
}
