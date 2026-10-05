// Extract the positioned text layer of a PDF into a JSON cache.
//   node tools/fc-manual/extract-text.mjs <in.pdf> <out.json>
// Output: { source, sha256, numPages, pages: [{ page, width, height, items: [{x,y,w,h,s,f}] }] }
import crypto from "node:crypto";
import fs from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error("usage: extract-text.mjs <in.pdf> <out.json>");
  process.exit(2);
}
const bytes = fs.readFileSync(input);
const doc = await getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
const pages = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items = [];
  for (const it of tc.items) {
    if (typeof it.str !== "string" || it.str.length === 0) continue;
    items.push({
      x: Math.round(it.transform[4] * 100) / 100,
      y: Math.round(it.transform[5] * 100) / 100,
      w: Math.round(it.width * 100) / 100,
      h: Math.round(Math.abs(it.transform[3]) * 100) / 100,
      s: it.str,
      f: it.fontName,
    });
  }
  pages.push({ page: p, width: vp.width, height: vp.height, items });
}
fs.writeFileSync(
  output,
  JSON.stringify({
    source: input.split(/[\\/]/).pop(),
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    numPages: doc.numPages,
    pages,
  })
);
console.log(`wrote ${output}: ${doc.numPages} pages`);
