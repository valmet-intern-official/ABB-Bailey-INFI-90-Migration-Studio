/**
 * Analyse the reference CAD PDF — the visual and engineering oracle.
 *
 * Decompresses each page's content stream and recovers the drawn text and
 * vector operators, so the generated reconstruction can be compared against
 * what the vendor's own plot actually contains: which engineering strings are
 * present, how many line/path operators draw the schematic, and how the sheet
 * is organised.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const file = process.argv[2] ?? path.join("Output", "CAD.pdf");
const wantPages = Number(process.argv[3] ?? 3);
const buf = fs.readFileSync(file);
const latin = buf.toString("latin1");

console.log(`${file}  ${buf.length} bytes`);
console.log(`pages           ${(latin.match(/\/Type\s*\/Page[^s]/g) ?? []).length}`);
const meta = (key: string) =>
  latin.match(new RegExp(`/${key}\\s*\\(([^)]*)\\)`))?.[1] ?? "(none)";
console.log(`producer        ${meta("Producer")}`);
console.log(`creator         ${meta("Creator")}`);
console.log(`title           ${meta("Title")}`);
const fonts = [...new Set((latin.match(/\/BaseFont\s*\/([A-Za-z0-9+,\-]+)/g) ?? []).map((s) => s.split("/").pop()!))];
console.log(`fonts           ${fonts.join(", ") || "(none)"}`);
console.log(`image XObjects  ${(latin.match(/\/Subtype\s*\/Image/g) ?? []).length}`);
console.log(`flate streams   ${(latin.match(/\/FlateDecode/g) ?? []).length}`);

// ---- decompress content streams
const streams: Buffer[] = [];
const re = /stream\r?\n/g;
let m: RegExpExecArray | null;
while ((m = re.exec(latin)) !== null) {
  const start = m.index + m[0].length;
  const end = latin.indexOf("endstream", start);
  if (end === -1) continue;
  const raw = buf.subarray(start, end);
  try {
    streams.push(zlib.inflateSync(raw));
  } catch {
    // Not a flate stream (or an image); skip.
  }
}
console.log(`inflated streams ${streams.length}\n`);

const outDir = path.join("tools", "cad-forensics", "out", "reference");
fs.mkdirSync(outDir, { recursive: true });

// ---- per-page operator census + text extraction
function pageText(content: string): string[] {
  const out: string[] = [];
  // Tj / TJ text-showing operators.
  for (const g of content.matchAll(/\((?:\\.|[^\\)])*\)\s*Tj/g)) {
    out.push(g[0].replace(/\s*Tj$/, "").slice(1, -1).replace(/\\([()\\])/g, "$1"));
  }
  for (const g of content.matchAll(/\[((?:\((?:\\.|[^\\)])*\)|[^\]])*)\]\s*TJ/g)) {
    const parts = [...g[1].matchAll(/\((?:\\.|[^\\)])*\)/g)].map((p) =>
      p[0].slice(1, -1).replace(/\\([()\\])/g, "$1")
    );
    if (parts.length) out.push(parts.join(""));
  }
  return out;
}

let totalLines = 0;
let totalCurves = 0;
let totalText = 0;
const allText: string[] = [];

streams.forEach((s, i) => {
  const c = s.toString("latin1");
  const lines = (c.match(/\bl\b/g) ?? []).length;
  const moves = (c.match(/\bm\b/g) ?? []).length;
  const curves = (c.match(/\bc\b/g) ?? []).length;
  const rects = (c.match(/\bre\b/g) ?? []).length;
  const texts = pageText(c);
  totalLines += lines;
  totalCurves += curves;
  totalText += texts.length;
  allText.push(...texts);

  if (i < wantPages) {
    console.log("=".repeat(92));
    console.log(`STREAM ${i}  ${s.length} bytes   moveto=${moves} lineto=${lines} curve=${curves} rect=${rects} textOps=${texts.length}`);
    console.log("=".repeat(92));
    for (const t of texts.slice(0, 70)) {
      if (t.trim()) console.log(`   "${t}"`);
    }
    fs.writeFileSync(path.join(outDir, `stream-${i}.txt`), c, "latin1");
    console.log("");
  }
});

console.log("=".repeat(92));
console.log("REFERENCE PDF TOTALS");
console.log("=".repeat(92));
console.log(`vector 'lineto' operators  ${totalLines}`);
console.log(`vector 'curveto' operators ${totalCurves}`);
console.log(`text-showing operators     ${totalText}`);

// What engineering content does the oracle actually carry?
const uniq = [...new Set(allText.map((s) => s.trim()).filter(Boolean))];
console.log(`distinct text strings      ${uniq.length}`);
fs.writeFileSync(path.join(outDir, "text-all.txt"), uniq.join("\n"), "utf8");

const classify = (re: RegExp) => uniq.filter((s) => re.test(s));
const groups: Array<[string, RegExp]> = [
  ["function codes / gates", /^(AND|OR|NOT|XOR|SR|AND2|OR2|TD-DIG|PID|SUM|H\/L|ETIMER|SEQ)/i],
  ["I/O channels", /^(AI|AO|DI|DO)\d+-/i],
  ["device/loop tags", /^\d{3}[A-Z]{2,}-?[A-Z]?\d/],
  ["references XXXX-NN.NN", /^[A-Z0-9]{4}-\d{2}\.\d{2}$/],
  ["sheet numbers", /^\d{5}[A-Z0-9]{2,3}$/],
  ["block numbers", /^#?\d{3,4}$/],
  ["dates", /^\d{2}\/\d{2}\/\d{2}$/],
];
for (const [label, rx] of groups) {
  const hits = classify(rx);
  console.log(`  ${label.padEnd(26)} ${String(hits.length).padStart(6)}   e.g. ${hits.slice(0, 6).join(" | ")}`);
}
console.log(`\nfull text -> ${path.join(outDir, "text-all.txt")}`);
