import type { BBox } from "../geometry/transform";
import type { RasterImage } from "./reference-pdf";
import { dilate, edges } from "./raster";

/** World → reference pixel: X = x0 + (x − ext.minX)·s ; Y = y0 + (ext.maxY − y)·s. */
export interface RefMapping {
  s: number;
  x0: number;
  y0: number;
  method: string;
  score: number;
  client: { left: number; top: number; right: number; bottom: number };
}

const isCaption = (r: number, g: number, b: number) => b > 90 && b > r + 30;
const isFrame = (r: number, g: number, b: number) => Math.abs(r - g) < 14 && Math.abs(g - b) < 14 && r > 140;

/** Windows-classic window chrome: caption rows on top, grey frame around the client area. */
export function detectClient(img: RasterImage): RefMapping["client"] {
  const { width: W, height: H, rgb } = img;
  const px = (x: number, y: number) => {
    const i = (y * W + x) * 3;
    return [rgb[i], rgb[i + 1], rgb[i + 2]] as const;
  };
  const probeX = Math.floor(W * 0.3);
  let top = 0;
  while (top < 60 && isCaption(...px(probeX, top))) top++;
  if (top === 0) while (top < 40 && isCaption(...px(Math.floor(W * 0.05), top))) top++;
  while (top < 80 && isFrame(...px(probeX, top))) top++;
  const midY = Math.floor(H / 2);
  let left = 0;
  while (left < 40 && isFrame(...px(left, midY))) left++;
  let right = W - 1;
  while (right > W - 40 && isFrame(...px(right, midY))) right--;
  let bottom = H - 1;
  while (bottom > H - 40 && isFrame(...px(Math.floor(W / 2), bottom))) bottom--;
  return { left, top, right, bottom };
}

/**
 * RULE-VIEW-002 (CANDIDATE): the viewer fits the world extent uniformly into
 * the client area, centred. Used only as the starting point of registration.
 */
export function fitMapping(ext: BBox, client: RefMapping["client"]): { s: number; x0: number; y0: number } {
  const cw = client.right - client.left + 1;
  const ch = client.bottom - client.top + 1;
  const w = ext.maxX - ext.minX;
  const h = ext.maxY - ext.minY;
  const s = Math.min(cw / w, ch / h);
  return { s, x0: client.left + (cw - w * s) / 2, y0: client.top };
}

/**
 * Register the rendered image (rendered at `renderScale` px/unit with origin at
 * the extent corner) against the reference by maximising edge agreement.
 */
export interface PreparedReference {
  img: RasterImage;
  client: RefMapping["client"];
  dilatedEdges: Uint8Array;
}

export function prepareReference(ref: RasterImage): PreparedReference {
  return { img: ref, client: detectClient(ref), dilatedEdges: dilate(edges(ref), ref.width, ref.height, 1) };
}

export interface PreparedRender {
  img: RasterImage;
  edgePoints: [number, number][];
}

export function prepareRender(render: RasterImage): PreparedRender {
  const e = edges(render);
  const pts: [number, number][] = [];
  for (let y = 0; y < render.height; y++) for (let x = 0; x < render.width; x++) if (e[y * render.width + x]) pts.push([x, y]);
  return { img: render, edgePoints: pts };
}

/**
 * Registration quality as a page-matching score: hit rate of our edges on the
 * reference minus the reference's own edge density inside the mapped area.
 */
export function matchScore(render: PreparedRender, renderScale: number, ref: PreparedReference, ext: BBox): number {
  const m = registerPrepared(render, renderScale, ref, ext, { coarseOnly: true, maxPoints: 4000 });
  const k = m.s / renderScale;
  const x0 = Math.max(0, Math.round(m.x0)), y0 = Math.max(0, Math.round(m.y0));
  const x1 = Math.min(ref.img.width, Math.round(m.x0 + render.img.width * k));
  const y1 = Math.min(ref.img.height, Math.round(m.y0 + render.img.height * k));
  let dens = 0, n = 0;
  for (let y = y0; y < y1; y += 2)
    for (let x = x0; x < x1; x += 2) {
      dens += ref.dilatedEdges[y * ref.img.width + x];
      n++;
    }
  return m.score - (n ? dens / n : 1);
}

export function registerToReference(render: RasterImage, renderScale: number, ref: RasterImage, ext: BBox): RefMapping {
  return registerPrepared(prepareRender(render), renderScale, prepareReference(ref), ext, {});
}

function registerPrepared(
  pr: PreparedRender,
  renderScale: number,
  pref: PreparedReference,
  ext: BBox,
  opts: { coarseOnly?: boolean; maxPoints?: number }
): RefMapping {
  const ref = pref.img;
  const client = pref.client;
  const guess = fitMapping(ext, client);
  const refEdges = pref.dilatedEdges;
  const pts = pr.edgePoints;
  const step = Math.max(1, Math.floor(pts.length / (opts.maxPoints ?? 25000)));
  const sample = pts.filter((_, i) => i % step === 0);
  if (!sample.length) return { ...guess, method: "fit (no edges to register)", score: 0, client };

  const score = (s: number, x0: number, y0: number) => {
    const k = s / renderScale;
    let hit = 0;
    for (const [x, y] of sample) {
      const X = Math.round(x0 + x * k);
      const Y = Math.round(y0 + y * k);
      if (X >= 0 && Y >= 0 && X < ref.width && Y < ref.height && refEdges[Y * ref.width + X]) hit++;
    }
    return hit / sample.length;
  };

  let best = { s: guess.s, x0: guess.x0, y0: guess.y0, sc: score(guess.s, guess.x0, guess.y0) };
  // coarse: scale ±4 %, offsets ±24 px
  const sStep = opts.coarseOnly ? 0.01 : 0.005;
  const oStep = opts.coarseOnly ? 4 : 3;
  for (let ds = -0.04; ds <= 0.0401; ds += sStep) {
    const s = guess.s * (1 + ds);
    for (let dx = -24; dx <= 24; dx += oStep)
      for (let dy = -24; dy <= 24; dy += oStep) {
        const sc = score(s, guess.x0 + dx, guess.y0 + dy);
        if (sc > best.sc) best = { s, x0: guess.x0 + dx, y0: guess.y0 + dy, sc };
      }
  }
  if (opts.coarseOnly) return { s: best.s, x0: best.x0, y0: best.y0, method: "fit + coarse edge registration", score: best.sc, client };
  // fine
  const c = { ...best };
  for (let ds = -0.004; ds <= 0.00401; ds += 0.001) {
    const s = c.s * (1 + ds);
    for (let dx = -3; dx <= 3; dx += 0.5)
      for (let dy = -3; dy <= 3; dy += 0.5) {
        const sc = score(s, c.x0 + dx, c.y0 + dy);
        if (sc > best.sc) best = { s, x0: c.x0 + dx, y0: c.y0 + dy, sc };
      }
  }
  return { s: best.s, x0: best.x0, y0: best.y0, method: "fit + edge registration", score: best.sc, client };
}
