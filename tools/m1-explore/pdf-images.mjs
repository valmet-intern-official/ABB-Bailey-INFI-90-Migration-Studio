import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("apps/web/package.json"));
const sharp = require("sharp");

const [pdfPath, outDir] = process.argv.slice(2);
const buf = fs.readFileSync(pdfPath);
const s = buf.toString("latin1");
fs.mkdirSync(outDir, { recursive: true });

/** Split into objects: id -> { dict, streamStart, text } */
const objs = new Map();
const headRe = /(?:^|\n)(\d+) 0 obj/g;
let hm;
while ((hm = headRe.exec(s))) {
  const id = Number(hm[1]);
  const bodyStart = hm.index + hm[0].length;
  const streamIdx = s.indexOf("stream", bodyStart);
  const endIdx = s.indexOf("endobj", bodyStart);
  if (streamIdx !== -1 && streamIdx < endIdx) {
    const dict = s.slice(bodyStart, streamIdx);
    let ds = streamIdx + 6;
    if (s[ds] === "\r") ds++;
    if (s[ds] === "\n") ds++;
    objs.set(id, { dict, streamStart: ds });
    headRe.lastIndex = s.indexOf("endstream", ds);
  } else {
    objs.set(id, { dict: s.slice(bodyStart, endIdx) });
    headRe.lastIndex = endIdx;
  }
}

function resolve(id) {
  return objs.get(Number(id));
}
function streamData(o) {
  let lenM = o.dict.match(/\/Length\s+(\d+)(\s+0\s+R)?/);
  let len = Number(lenM[1]);
  if (lenM[2]) len = Number(resolve(lenM[1]).dict.trim());
  const raw = buf.subarray(o.streamStart, o.streamStart + len);
  return /FlateDecode/.test(o.dict) ? zlib.inflateSync(raw) : raw;
}

function unpredict(data, w, colors) {
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

// Pages in order -> image XObjects in the order they are drawn
const pagesObj = [...objs.entries()].find(([, o]) => /\/Type\s*\/Pages/.test(o.dict))[1];
const kids = [...pagesObj.dict.match(/\/Kids\s*\[([^\]]*)\]/)[1].matchAll(/(\d+) 0 R/g)].map((k) => Number(k[1]));

let pageNo = 0;
for (const pid of kids) {
  pageNo++;
  const page = resolve(pid);
  const xoRef = page.dict.match(/\/XObject\s+(\d+) 0 R/)[1];
  const xo = resolve(xoRef).dict;
  const names = [...xo.matchAll(/\/(\w+)\s+(\d+) 0 R/g)].map((x) => ({ name: x[1], id: Number(x[2]) }));
  const contentRef = page.dict.match(/\/Contents\s+(\d+) 0 R/)[1];
  const content = streamData(resolve(contentRef)).toString("latin1");
  const texts = [...content.matchAll(/\(([^)]*)\)\s*Tj/g)].map((t) => t[1]);
  const drawOrder = [...content.matchAll(/\/(\w+)\s+Do/g)].map((d) => d[1]);
  let k = 0;
  for (const nm of drawOrder) {
    const ref = names.find((x) => x.name === nm);
    const o = resolve(ref.id);
    const d = o.dict;
    const w = Number(d.match(/\/Width\s+(\d+)/)[1]);
    const h = Number(d.match(/\/Height\s+(\d+)/)[1]);
    const bpc = Number(d.match(/\/BitsPerComponent\s+(\d+)/)[1]);
    k++;
    const file = path.join(outDir, `p${String(pageNo).padStart(2, "0")}-${k}.png`);
    if (/DCTDecode/.test(d)) {
      const len = Number(d.match(/\/Length\s+(\d+)/)[1]);
      await sharp(buf.subarray(o.streamStart, o.streamStart + len)).png().toFile(file);
    } else if (/\/ColorSpace\s*\/DeviceRGB/.test(d)) {
      let data = streamData(o);
      if (/Predictor\s+1[0-5]/.test(d)) data = unpredict(data, w, 3);
      await sharp(data, { raw: { width: w, height: h, channels: 3 } }).png().toFile(file);
    } else {
      const csRef = d.match(/\/ColorSpace\s+(\d+) 0 R/)[1];
      const cs = resolve(csRef).dict;
      const pal = Buffer.from(cs.match(/<([0-9A-Fa-f\s]+)>/)[1].replace(/\s+/g, ""), "hex");
      const idx = streamData(o);
      const rowBytes = Math.ceil((w * bpc) / 8);
      const rgb = Buffer.alloc(w * h * 3);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const v = bpc === 8 ? idx[y * rowBytes + x] : x & 1 ? idx[y * rowBytes + (x >> 1)] & 15 : idx[y * rowBytes + (x >> 1)] >> 4;
          rgb.set(pal.subarray(v * 3, v * 3 + 3), (y * w + x) * 3);
        }
      await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).png().toFile(file);
    }
  }
  console.log(`page ${pageNo}: images=${drawOrder.length} text=${JSON.stringify(texts.join(" ").slice(0, 160))}`);
}
