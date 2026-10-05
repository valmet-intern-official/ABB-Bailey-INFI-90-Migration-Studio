// Dump the text layer of a PDF page range with coordinates, for layout study.
import fs from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const [, , file, from = "1", to = from, mode = "lines"] = process.argv;
const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 }).promise;
console.log(`pages=${doc.numPages}`);
for (let p = Number(from); p <= Math.min(Number(to), doc.numPages); p++) {
  const page = await doc.getPage(p);
  const tc = await page.getTextContent();
  console.log(`=== page ${p} items=${tc.items.length}`);
  if (mode === "raw") {
    for (const it of tc.items) {
      if (!it.str.trim()) continue;
      console.log(`${it.transform[4].toFixed(1)}\t${it.transform[5].toFixed(1)}\t${JSON.stringify(it.str)}`);
    }
    continue;
  }
  const rows = new Map();
  for (const it of tc.items) {
    if (!it.str.trim()) continue;
    const y = Math.round(it.transform[5]);
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push(it);
  }
  for (const y of [...rows.keys()].sort((a, b) => b - a)) {
    const line = rows.get(y).sort((a, b) => a.transform[4] - b.transform[4]);
    console.log(`${String(y).padStart(4)} | ${line.map((i) => `[${i.transform[4].toFixed(0)}]${i.str}`).join(" ")}`);
  }
}
