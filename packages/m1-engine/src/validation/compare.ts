import type { BBox } from "../geometry/transform";
import type { SceneGraph } from "../scene/scene";
import type { RefMapping } from "./align";
import { matchScore, prepareReference, prepareRender } from "./align";
import { crop, dilate, edges, gray, resize } from "./raster";
import type { RasterImage, ReferencePage } from "./reference-pdf";

export interface PageMatch {
  file: string;
  originalPage: number | null;
  markingPage: number | null;
  scores: { page: number; ncc: number; redPixels: number }[];
}

function ncc(a: Float32Array, b: Float32Array): number {
  let ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= a.length;
  mb /= b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Marking-tag overlays are drawn in red / orange-red (255,0,0) and (255,68,0); tolerant to JPEG noise. */
function redPixels(img: RasterImage): number {
  let n = 0;
  for (let i = 0; i < img.width * img.height; i++) {
    const r = img.rgb[i * 3], g = img.rgb[i * 3 + 1], b = img.rgb[i * 3 + 2];
    if (r > 190 && g < 110 && b < 70 && r - g > 120) n++;
  }
  return n;
}

/**
 * Assign every render to a reference page pair. Consecutive near-identical
 * pages form a pair (original + with-marking-tag); files are assigned to pairs
 * greedily by structural similarity with one file per pair.
 */
export async function matchAllPages(
  renders: { file: string; render: RasterImage; ext: BBox; scale: number }[],
  pages: ReferencePage[]
): Promise<PageMatch[]> {
  const TW = 160;
  const thumbs = await Promise.all(pages.map(async (p) => gray(await resize(p, TW, 120))));
  const pairs: [number, number | null][] = [];
  const adj = thumbs.map((t, i) => (i + 1 < thumbs.length ? ncc(t, thumbs[i + 1]) : -1));
  for (let i = 0; i < pages.length; i++) {
    // A pair's internal similarity is a local maximum versus the next boundary.
    if (i + 1 < pages.length && adj[i] > 0.2 && adj[i] > (adj[i + 1] ?? -1)) {
      pairs.push([i, i + 1]);
      i++;
    } else pairs.push([i, null]);
  }

  const table: { r: number; p: number; score: number }[] = [];
  const perFile: PageMatch["scores"][] = [];
  const prepared = pages.map((p) => prepareReference(p));
  // Edges shared by several renders (common frames, menu bars) cannot tell
  // pages apart; match on the edges that are distinctive for each render.
  const preparedRenders = renders.map((r) => prepareRender(r.render));
  const sameSize = renders.every((r) => r.render.width === renders[0].render.width && r.render.height === renders[0].render.height);
  const shared = new Uint8Array(sameSize && renders.length ? renders[0].render.width * renders[0].render.height : 0);
  if (sameSize) {
    for (const pr of preparedRenders) {
      const W = pr.img.width;
      const mask = new Uint8Array(shared.length);
      for (const [x, y] of pr.edgePoints) mask[y * W + x] = 1;
      const d = dilate(mask, W, pr.img.height, 1);
      for (let i = 0; i < d.length; i++) if (d[i] && shared[i] < 255) shared[i]++;
    }
  }
  for (let r = 0; r < renders.length; r++) {
    const { render, ext, scale } = renders[r];
    let pr = preparedRenders[r];
    if (sameSize) {
      const distinct = pr.edgePoints.filter(([x, y]) => shared[y * render.width + x] <= 2);
      if (distinct.length >= 150) pr = { img: pr.img, edgePoints: distinct };
    }
    const scores: PageMatch["scores"] = pages.map((p, i) => ({ page: p.page, ncc: matchScore(pr, scale, prepared[i], ext), redPixels: redPixels(p) }));
    perFile.push(scores);
    pairs.forEach(([a, b], pi) => table.push({ r, p: pi, score: Math.max(scores[a].ncc, b === null ? -1 : scores[b].ncc) }));
  }
  table.sort((x, y) => y.score - x.score);
  const fileTaken = new Set<number>(), pairTaken = new Set<number>();
  const assigned = new Map<number, number>();
  for (const t of table) {
    if (fileTaken.has(t.r) || pairTaken.has(t.p) || t.score < 0.05) continue;
    fileTaken.add(t.r);
    pairTaken.add(t.p);
    assigned.set(t.r, t.p);
  }
  return renders.map((x, r) => {
    const pi = assigned.get(r);
    if (pi === undefined) return { file: x.file, originalPage: null, markingPage: null, scores: perFile[r] };
    const [a, b] = pairs[pi];
    if (b === null) return { file: x.file, originalPage: pages[a].page, markingPage: null, scores: perFile[r] };
    // The marking page is the original plus a red overlay, so it carries more red.
    const [o, m] = redPixels(pages[a]) <= redPixels(pages[b]) ? [a, b] : [b, a];
    return { file: x.file, originalPage: pages[o].page, markingPage: pages[m].page, scores: perFile[r] };
  });
}

export interface ObjectScore {
  objectId: number;
  className: string;
  kind: string;
  edgeRecall: number;
  edgePixels: number;
}

export interface ComparisonMetrics {
  page: number;
  mapping: RefMapping;
  size: { width: number; height: number };
  pixelSimilarity: number;
  edgePrecision: number;
  edgeRecall: number;
  edgeF1: number;
  foregroundIoU: number;
  histogramIntersection: number;
  objectScores: ObjectScore[];
  worstObjects: ObjectScore[];
}

export interface ComparisonImages {
  reference: RasterImage;
  render: RasterImage;
  diff: RasterImage;
  overlay: RasterImage;
  sideBySide: RasterImage;
}

export async function compareToReference(
  scene: SceneGraph,
  render: RasterImage,
  ref: ReferencePage,
  mapping: RefMapping
): Promise<{ metrics: ComparisonMetrics; images: ComparisonImages }> {
  const ext = scene.extent;
  const W = Math.round((ext.maxX - ext.minX) * mapping.s);
  const H = Math.round((ext.maxY - ext.minY) * mapping.s);
  const refImg = crop(ref, Math.round(mapping.x0), Math.round(mapping.y0), W, H);
  const ours = await resize(render, W, H);
  const n = W * H;

  let sad = 0;
  let fgI = 0, fgU = 0;
  const QH = 16;
  const hA = new Float64Array(QH * QH * QH), hB = new Float64Array(QH * QH * QH);
  const diff = Buffer.alloc(n * 3);
  const overlay = Buffer.alloc(n * 3);
  const ga = gray(refImg), gb = gray(ours);
  for (let i = 0; i < n; i++) {
    const ar = refImg.rgb[i * 3], ag = refImg.rgb[i * 3 + 1], ab = refImg.rgb[i * 3 + 2];
    const br = ours.rgb[i * 3], bg = ours.rgb[i * 3 + 1], bb = ours.rgb[i * 3 + 2];
    const d = (Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb)) / 3;
    sad += d;
    const fa = ga[i] > 30, fb = gb[i] > 30;
    if (fa && fb) fgI++;
    if (fa || fb) fgU++;
    hA[((ar >> 4) * QH + (ag >> 4)) * QH + (ab >> 4)]++;
    hB[((br >> 4) * QH + (bg >> 4)) * QH + (bb >> 4)]++;
    const v = Math.min(255, Math.round(d * 2));
    diff[i * 3] = v;
    diff[i * 3 + 1] = Math.round(v * 0.25);
    diff[i * 3 + 2] = 0;
    overlay[i * 3] = Math.round(gb[i]);
    overlay[i * 3 + 1] = Math.round(ga[i]);
    overlay[i * 3 + 2] = Math.round(gb[i]);
  }
  let inter = 0;
  for (let i = 0; i < hA.length; i++) inter += Math.min(hA[i], hB[i]);

  const eA = edges(refImg), eB = edges(ours);
  const dA = dilate(eA, W, H, 2), dB = dilate(eB, W, H, 2);
  let tpB = 0, nB = 0, tpA = 0, nA = 0;
  for (let i = 0; i < n; i++) {
    if (eB[i]) {
      nB++;
      if (dA[i]) tpB++;
    }
    if (eA[i]) {
      nA++;
      if (dB[i]) tpA++;
    }
  }
  const precision = nB ? tpB / nB : 0;
  const recall = nA ? tpA / nA : 0;

  const k = mapping.s;
  const objectScores: ObjectScore[] = [];
  for (const node of scene.nodes) {
    if (!node.bbox || node.kind === "marker" || node.kind === "placeholder") continue;
    const x0 = Math.max(0, Math.floor((node.bbox.minX - ext.minX) * k) - 1);
    const x1 = Math.min(W - 1, Math.ceil((node.bbox.maxX - ext.minX) * k) + 1);
    const y0 = Math.max(0, Math.floor((ext.maxY - node.bbox.maxY) * k) - 1);
    const y1 = Math.min(H - 1, Math.ceil((ext.maxY - node.bbox.minY) * k) + 1);
    let e = 0, hit = 0;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        if (eB[i]) {
          e++;
          if (dA[i]) hit++;
        }
      }
    if (e >= 8) objectScores.push({ objectId: node.objectId, className: node.className, kind: node.kind, edgeRecall: hit / e, edgePixels: e });
  }
  const worstObjects = [...objectScores].sort((a, b) => a.edgeRecall - b.edgeRecall).slice(0, 25);

  const side = Buffer.alloc(W * 2 * H * 3);
  for (let y = 0; y < H; y++) {
    refImg.rgb.copy(side, y * W * 2 * 3, y * W * 3, (y + 1) * W * 3);
    ours.rgb.copy(side, (y * W * 2 + W) * 3, y * W * 3, (y + 1) * W * 3);
  }

  return {
    metrics: {
      page: ref.page,
      mapping,
      size: { width: W, height: H },
      pixelSimilarity: 1 - sad / n / 255,
      edgePrecision: precision,
      edgeRecall: recall,
      edgeF1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
      foregroundIoU: fgU ? fgI / fgU : 0,
      histogramIntersection: inter / n,
      objectScores,
      worstObjects,
    },
    images: {
      reference: refImg,
      render: ours,
      diff: { width: W, height: H, rgb: diff },
      overlay: { width: W, height: H, rgb: overlay },
      sideBySide: { width: W * 2, height: H, rgb: side },
    },
  };
}
