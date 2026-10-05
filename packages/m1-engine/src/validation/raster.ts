import { loadSharp } from "../render/png";
import type { RasterImage } from "./reference-pdf";

type SharpAny = (input: Buffer, o?: object) => any;

export async function rasterizeSvg(svg: string): Promise<RasterImage> {
  const sharp = (await loadSharp()) as unknown as SharpAny;
  const { data, info } = await sharp(Buffer.from(svg, "utf8"), { density: 72 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, rgb: data };
}

export async function decodePng(png: Buffer): Promise<RasterImage> {
  const sharp = (await loadSharp()) as unknown as SharpAny;
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, rgb: data };
}

export async function encodePng(img: RasterImage): Promise<Buffer> {
  const sharp = (await loadSharp()) as unknown as SharpAny;
  return sharp(img.rgb, { raw: { width: img.width, height: img.height, channels: 3 } }).png().toBuffer();
}

export async function resize(img: RasterImage, width: number, height: number): Promise<RasterImage> {
  const sharp = (await loadSharp()) as unknown as SharpAny;
  const { data, info } = await sharp(img.rgb, { raw: { width: img.width, height: img.height, channels: 3 } })
    .resize(width, height, { fit: "fill", kernel: "nearest" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, rgb: data };
}

export function crop(img: RasterImage, x: number, y: number, w: number, h: number): RasterImage {
  const out = Buffer.alloc(w * h * 3);
  for (let j = 0; j < h; j++) {
    const sy = y + j;
    if (sy < 0 || sy >= img.height) continue;
    for (let i = 0; i < w; i++) {
      const sx = x + i;
      if (sx < 0 || sx >= img.width) continue;
      img.rgb.copy(out, (j * w + i) * 3, (sy * img.width + sx) * 3, (sy * img.width + sx) * 3 + 3);
    }
  }
  return { width: w, height: h, rgb: out };
}

export function gray(img: RasterImage): Float32Array {
  const g = new Float32Array(img.width * img.height);
  for (let i = 0; i < g.length; i++) g[i] = 0.299 * img.rgb[i * 3] + 0.587 * img.rgb[i * 3 + 1] + 0.114 * img.rgb[i * 3 + 2];
  return g;
}

export function edges(img: RasterImage, threshold = 40): Uint8Array {
  const g = gray(img);
  const { width: W, height: H } = img;
  const e = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = g[i + 1] - g[i - 1];
      const gy = g[i + W] - g[i - W];
      if (Math.abs(gx) + Math.abs(gy) > threshold) e[i] = 1;
    }
  return e;
}

export function dilate(mask: Uint8Array, W: number, H: number, r: number): Uint8Array {
  let cur = mask;
  for (let k = 0; k < r; k++) {
    const nxt = new Uint8Array(cur);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (!cur[y * W + x]) continue;
        if (x > 0) nxt[y * W + x - 1] = 1;
        if (x < W - 1) nxt[y * W + x + 1] = 1;
        if (y > 0) nxt[(y - 1) * W + x] = 1;
        if (y < H - 1) nxt[(y + 1) * W + x] = 1;
      }
    cur = nxt;
  }
  return cur;
}
