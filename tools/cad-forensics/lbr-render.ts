/**
 * Render every decoded .LBR symbol to one SVG contact sheet.
 *
 * This is the visual check on the library decoder: if the extracted segments
 * are real geometry, recognisable engineering symbols appear. If the layout
 * were wrong, the cells would be noise.
 */
import fs from "node:fs";
import path from "node:path";
import { parseLbrLibrary, SymbolRegistry, type LbrSymbol } from "@infi90/cad-engine";
import { lbrCorpus } from "./lib/walk";

const registry = new SymbolRegistry();
const all: LbrSymbol[] = [];

for (const f of lbrCorpus()) {
  const lib = parseLbrLibrary(fs.readFileSync(f), path.basename(f));
  registry.add(lib);
  console.log(
    `${path.basename(f).padEnd(16)} symbols=${String(lib.symbols.size).padStart(4)}  ` +
      `chainBreaks=${lib.chainBreaks}  ` +
      `withGeometry=${[...lib.symbols.values()].filter((s) => s.segments.length > 0).length}`
  );
}

for (const name of ["dummy"]) void name;
// Collect the registry contents for the contact sheet.
const seen = new Set<string>();
for (const f of lbrCorpus()) {
  const lib = parseLbrLibrary(fs.readFileSync(f), path.basename(f));
  for (const s of lib.symbols.values()) {
    const key = s.name.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(s);
  }
}

console.log(`\nregistry: ${registry.size} symbols, ${registry.drawable} with geometry`);
const totalSeg = all.reduce((n, s) => n + s.segments.length, 0);
const undec = all.reduce((n, s) => n + s.undecodedBytes, 0);
const bodyBytes = all.reduce((n, s) => n + s.length, 0);
console.log(`segments extracted: ${totalSeg}`);
console.log(
  `body bytes: ${bodyBytes}, claimed by line primitives: ${bodyBytes - undec} (${(((bodyBytes - undec) / bodyBytes) * 100).toFixed(1)}%)`
);

// ---- contact sheet
const drawable = all.filter((s) => s.segments.length > 0 && s.extent);
const COLS = 8;
const CELL = 190;
const PAD = 14;
const rows = Math.ceil(drawable.length / COLS);
const W = COLS * CELL;
const H = rows * CELL;

const parts: string[] = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Consolas,monospace">`,
  `<rect width="100%" height="100%" fill="#ffffff"/>`,
];

drawable.forEach((s, i) => {
  const cx = (i % COLS) * CELL;
  const cy = Math.floor(i / COLS) * CELL;
  const ex = s.extent!;
  const w = Math.max(1, ex.maxX - ex.minX);
  const h = Math.max(1, ex.maxY - ex.minY);
  const scale = Math.min((CELL - PAD * 2) / w, (CELL - PAD * 2 - 18) / h);
  const ox = cx + PAD + ((CELL - PAD * 2) - w * scale) / 2;
  const oy = cy + PAD + 18;

  parts.push(
    `<rect x="${cx + 2}" y="${cy + 2}" width="${CELL - 4}" height="${CELL - 4}" fill="none" stroke="#e2e8e5"/>`,
    `<text x="${cx + 8}" y="${cy + 14}" font-size="11" fill="#1f2a24" font-weight="700">${s.name}</text>`,
    `<text x="${CELL + cx - 8}" y="${cy + 14}" font-size="9" fill="#8a9a92" text-anchor="end">${s.segments.length} seg</text>`
  );
  for (const g of s.segments) {
    // Library Y increases upward; flip for SVG.
    const X = (v: number) => ox + (v - ex.minX) * scale;
    const Y = (v: number) => oy + (ex.maxY - v) * scale;
    parts.push(
      `<line x1="${X(g.x1).toFixed(1)}" y1="${Y(g.y1).toFixed(1)}" x2="${X(g.x2).toFixed(1)}" y2="${Y(g.y2).toFixed(1)}" stroke="#12281d" stroke-width="1.1"/>`
    );
  }
});
parts.push("</svg>");

const outDir = path.join("tools", "cad-forensics", "out", "lbr");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "symbols.svg");
fs.writeFileSync(outFile, parts.join("\n"), "utf8");
console.log(`\ncontact sheet: ${outFile}  (${drawable.length} symbols, ${rows} rows)`);
