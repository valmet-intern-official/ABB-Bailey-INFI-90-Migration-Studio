import { readPdfText } from "./pdf-text.mts";

const max = Number(process.env.MAXP ?? 4);
const from = Number(process.env.FROMP ?? 1);
for (const f of process.argv.slice(2)) {
  const pages = await readPdfText(f, { maxPages: max });
  console.log(`\n### ${f}  pages(read)=${pages.length}`);
  for (const p of pages.filter((p) => p.page >= from)) {
    console.log(`p${p.page} ${p.width.toFixed(0)}x${p.height.toFixed(0)} rot=${p.rotate} items=${p.rawItems} runs=${p.runs.length} ops=${JSON.stringify(p.ops)}`);
    for (const r of p.runs) console.log(`   [${r.x.toFixed(1)},${r.y.toFixed(1)} h${r.h.toFixed(1)} a${r.angle}] ${JSON.stringify(r.text)}`);
  }
}
