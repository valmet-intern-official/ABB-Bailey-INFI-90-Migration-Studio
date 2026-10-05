import zlib from "node:zlib";
import { loadSharp } from "../render/png";

export interface RasterImage {
  width: number;
  height: number;
  /** Packed RGB, 3 bytes per pixel. */
  rgb: Buffer;
}

export interface ReferencePage extends RasterImage {
  page: number;
  text: string;
  imageCount: number;
}

interface PdfObj {
  dict: string;
  streamStart?: number;
}

function splitObjects(s: string): Map<number, PdfObj> {
  const objs = new Map<number, PdfObj>();
  const headRe = /(?:^|\n|\r)(\d+) 0 obj/g;
  let hm: RegExpExecArray | null;
  while ((hm = headRe.exec(s))) {
    const id = Number(hm[1]);
    const bodyStart = hm.index + hm[0].length;
    const streamIdx = s.indexOf("stream", bodyStart);
    const endIdx = s.indexOf("endobj", bodyStart);
    if (streamIdx !== -1 && streamIdx < endIdx) {
      let ds = streamIdx + 6;
      if (s[ds] === "\r") ds++;
      if (s[ds] === "\n") ds++;
      objs.set(id, { dict: s.slice(bodyStart, streamIdx), streamStart: ds });
      headRe.lastIndex = s.indexOf("endstream", ds);
    } else {
      objs.set(id, { dict: s.slice(bodyStart, endIdx === -1 ? undefined : endIdx) });
      if (endIdx !== -1) headRe.lastIndex = endIdx;
    }
  }
  return objs;
}

function unpredict(data: Buffer, w: number, colors: number): Buffer {
  const stride = w * colors;
  const rows = Math.floor(data.length / (stride + 1));
  const out = Buffer.alloc(rows * stride);
  for (let r = 0; r < rows; r++) {
    const ft = data[r * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const a = i >= colors ? out[r * stride + i - colors] : 0;
      const b = r > 0 ? out[(r - 1) * stride + i] : 0;
      const c = r > 0 && i >= colors ? out[(r - 1) * stride + i - colors] : 0;
      let v = data[r * (stride + 1) + 1 + i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[r * stride + i] = v & 0xff;
    }
  }
  return out;
}

/**
 * Extract the screenshot rasters from the reference PDF. Each page carries its
 * screenshot as vertically stacked image XObjects; they are stitched in draw
 * order into one raster per page.
 */
export async function extractReferencePages(pdf: Buffer): Promise<ReferencePage[]> {
  const sharp = (await loadSharp()) as unknown as (input: Buffer, o?: object) => { raw(): { toBuffer(o: { resolveWithObject: true }): Promise<{ data: Buffer; info: { width: number; height: number; channels: number } }> }; removeAlpha(): any };
  const s = pdf.toString("latin1");
  const objs = splitObjects(s);
  const get = (id: string | number) => objs.get(Number(id));
  const streamData = (o: PdfObj): Buffer => {
    const lenM = o.dict.match(/\/Length\s+(\d+)(\s+0\s+R)?/);
    if (!lenM || o.streamStart === undefined) throw new Error("stream without /Length");
    let len = Number(lenM[1]);
    if (lenM[2]) len = Number(get(lenM[1])!.dict.trim());
    const raw = pdf.subarray(o.streamStart, o.streamStart + len);
    return /FlateDecode/.test(o.dict) ? zlib.inflateSync(raw) : raw;
  };

  const pagesEntry = [...objs.values()].find((o) => /\/Type\s*\/Pages/.test(o.dict) && /\/Kids/.test(o.dict));
  if (!pagesEntry) throw new Error("reference PDF has no page tree");
  const kids = [...pagesEntry.dict.match(/\/Kids\s*\[([^\]]*)\]/)![1].matchAll(/(\d+) 0 R/g)].map((k) => Number(k[1]));

  const pages: ReferencePage[] = [];
  let pageNo = 0;
  for (const pid of kids) {
    pageNo++;
    const page = get(pid)!;
    const xoM = page.dict.match(/\/XObject\s+(\d+) 0 R/) ?? page.dict.match(/\/XObject\s*<<([^>]*)>>/);
    const xoDict = xoM ? (/^\d+$/.test(xoM[1]) ? get(xoM[1])!.dict : xoM[1]) : "";
    const names = [...xoDict.matchAll(/\/(\w+)\s+(\d+) 0 R/g)].map((x) => ({ name: x[1], id: Number(x[2]) }));
    const contentRef = page.dict.match(/\/Contents\s+(\d+) 0 R/);
    const content = contentRef ? streamData(get(contentRef[1])!).toString("latin1") : "";
    const text = [...content.matchAll(/\(([^)]*)\)\s*Tj/g)].map((t) => t[1]).join(" ");
    const drawOrder = [...content.matchAll(/\/(\w+)\s+Do/g)].map((d) => d[1]);
    const parts: RasterImage[] = [];
    for (const nm of drawOrder) {
      const ref = names.find((x) => x.name === nm);
      if (!ref) continue;
      const o = get(ref.id)!;
      const d = o.dict;
      if (!/\/Subtype\s*\/Image/.test(d)) continue;
      const w = Number(d.match(/\/Width\s+(\d+)/)![1]);
      const h = Number(d.match(/\/Height\s+(\d+)/)![1]);
      const bpc = Number(d.match(/\/BitsPerComponent\s+(\d+)/)![1]);
      let rgb: Buffer;
      if (/DCTDecode/.test(d)) {
        const len = Number(d.match(/\/Length\s+(\d+)/)![1]);
        const r = await sharp(pdf.subarray(o.streamStart!, o.streamStart! + len)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        rgb = r.data;
      } else if (/\/ColorSpace\s*\/DeviceRGB/.test(d)) {
        let data = streamData(o);
        if (/Predictor\s+1[0-5]/.test(d)) data = unpredict(data, w, 3);
        rgb = data.subarray(0, w * h * 3);
      } else {
        const csRef = d.match(/\/ColorSpace\s+(\d+) 0 R/);
        const cs = csRef ? get(csRef[1])!.dict : d;
        const hexM = cs.match(/<([0-9A-Fa-f\s]+)>/);
        if (!hexM) continue;
        const pal = Buffer.from(hexM[1].replace(/\s+/g, ""), "hex");
        const idx = streamData(o);
        const rowBytes = Math.ceil((w * bpc) / 8);
        rgb = Buffer.alloc(w * h * 3);
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const v = bpc === 8 ? idx[y * rowBytes + x] : x & 1 ? idx[y * rowBytes + (x >> 1)] & 15 : idx[y * rowBytes + (x >> 1)] >> 4;
            pal.copy(rgb, (y * w + x) * 3, v * 3, v * 3 + 3);
          }
      }
      parts.push({ width: w, height: h, rgb });
    }
    if (!parts.length) continue;
    const width = Math.max(...parts.map((p) => p.width));
    const height = parts.reduce((a, p) => a + p.height, 0);
    const rgb = Buffer.alloc(width * height * 3);
    let top = 0;
    for (const p of parts) {
      for (let y = 0; y < p.height; y++) p.rgb.copy(rgb, ((top + y) * width) * 3, y * p.width * 3, (y + 1) * p.width * 3);
      top += p.height;
    }
    pages.push({ page: pageNo, width, height, rgb, text, imageCount: parts.length });
  }
  return pages;
}
