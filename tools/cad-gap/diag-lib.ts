import fs from "node:fs";
import path from "node:path";
import { reconstructModule } from "../../packages/cad-engine/src/reconstruct/pipeline.ts";
import { readLibraryName } from "../../packages/cad-engine/src/binary/reader.ts";

const extractDir = process.argv[2];
const files: string[] = [];
const walk = (d: string) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (/\.CAD$/i.test(e.name)) files.push(f);
  }
};
walk(extractDir);
files.sort();
const cads = files.map((f) => ({ name: path.basename(f), data: fs.readFileSync(f) }));
const libs = new Map<string, number>();
for (const c of cads) {
  const n = readLibraryName(c.data) ?? "(none)";
  libs.set(n, (libs.get(n) ?? 0) + 1);
}
console.log("CAD files", cads.length, "library names in headers", Object.fromEntries(libs));
const r = reconstructModule({ cads, extractDir });
console.log("libraries loaded", r.librariesLoaded);
let lib = 0, fb = 0;
const missing = new Map<string, number>();
const fbSymbols = new Map<string, number>();
for (const s of r.sheets) {
  lib += s.renderStats.libraryGlyphs;
  fb += s.renderStats.fallbackGlyphs;
  for (const m of s.renderStats.missingLibrarySymbols) missing.set(m, (missing.get(m) ?? 0) + 1);
  for (const b of s.drawing.functionBlocks) if (b.glyph.status === "FALLBACK") fbSymbols.set(b.symbolName, (fbSymbols.get(b.symbolName) ?? 0) + 1);
}
console.log("library glyphs", lib, "fallback glyphs", fb);
console.log("missing (expanded) symbols", Object.fromEntries(missing));
console.log("fallback symbol names", Object.fromEntries([...fbSymbols].sort((a, b) => b[1] - a[1])));
const s0 = r.sheets[0];
console.log("sheet0", s0.filename, "frame", s0.drawing.frame.present, s0.drawing.frame.symbolName, "lib", s0.drawing.library);
console.log("sheet0 blocks", s0.drawing.functionBlocks.map((b) => `${b.symbolName}/${b.blockNumber}/${b.glyph.status}/${b.glyph.note ?? ""}`));
