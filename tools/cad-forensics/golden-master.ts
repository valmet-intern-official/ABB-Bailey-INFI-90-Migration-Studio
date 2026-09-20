/**
 * Golden-master comparison against the reference CAD plot.
 *
 * `Output/CAD.pdf` is the vendor's own plot of these drawings, one page per
 * sheet, and each page names its source file in the first text operator. That
 * makes it a per-sheet oracle for *engineering content*: every string the
 * vendor chose to draw is something an engineer is expected to read off the
 * sheet.
 *
 * For each page this tool decodes the matching .CAD file and reports which of
 * the plotted strings the decoder recovers and which it does not, so
 * completeness is measured against real engineering expectations rather than
 * against our own schema.
 *
 * Output: tools/cad-forensics/out/reference/golden-master.md
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { decodeRecordStream, decodeCadSheet } from "@infi90/cad-engine";
import { cadCorpus } from "./lib/walk";

const pdfPath = process.argv[2] ?? path.join("Output", "CAD.pdf");
const buf = fs.readFileSync(pdfPath);
const latin = buf.toString("latin1");

// ---- inflate every content stream, keeping document order
const streams: string[] = [];
const re = /stream\r?\n/g;
let m: RegExpExecArray | null;
while ((m = re.exec(latin)) !== null) {
  const start = m.index + m[0].length;
  const end = latin.indexOf("endstream", start);
  if (end === -1) continue;
  try {
    streams.push(zlib.inflateSync(buf.subarray(start, end)).toString("latin1"));
  } catch {
    /* not flate */
  }
}

function showText(content: string): string[] {
  const out: string[] = [];
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

/** Pages are identified by the source path the plot stamps on each sheet. */
interface Page {
  sheet: string;
  strings: string[];
  lineOps: number;
}
const pages: Page[] = [];
for (const s of streams) {
  const texts = showText(s);
  const stamp = texts.find((t) => /\.CAD/i.test(t));
  if (!stamp) continue;
  const name = stamp.match(/([A-Z0-9]+\.CAD)/i)?.[1];
  if (!name) continue;
  pages.push({
    sheet: name.toUpperCase(),
    strings: texts,
    lineOps: (s.match(/\bl\b/g) ?? []).length,
  });
}

const corpus = new Map<string, string>();
for (const f of cadCorpus()) corpus.set(path.basename(f).toUpperCase(), f);

console.log(`reference pages with a sheet stamp: ${pages.length}`);
console.log(`of those present in the corpus:     ${pages.filter((p) => corpus.has(p.sheet)).length}\n`);

/** Strings the plot draws that are frame furniture, not sheet content. */
const BOILERPLATE =
  /^(NOTES:|ORIGINAL ISSUE|.*INJURIOUS TO BAILEY.*|.*PROPRIETARY.*|.*BAILEY CONTROLS.*|REV|BY|DATE|APP|CHK|DWN|SH|OF|TITLE|SCALE|DWG|NO\.?|I\/O|LOGIC|N\/A|EXEXEC|[-_=|/\\ ]*)$/i;

/** Normalise for comparison: plots pad fields, records trim them. */
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toUpperCase();

interface Row {
  sheet: string;
  plotted: number;
  matched: number;
  missing: string[];
  records: number;
  blocks: number;
  fcNumbers: number;
  specs: number;
}

const rows: Row[] = [];
const missTally = new Map<string, number>();
/** Classify what kind of engineering string we fail to recover. */
const missKind = new Map<string, number>();

function classifyMiss(s: string): string {
  if (/^\(\d{1,3}\)$/.test(s)) return "function-code number (NN)";
  if (/^S\d{1,2}$/i.test(s)) return "specification label Sn";
  if (/^\d{1,4}$/.test(s)) return "bare number (block/spec value)";
  if (/^[A-Z0-9]{4}-\d{2}\.\d{2}$/i.test(s)) return "reference address";
  if (/^(AI|AO|DI|DO)\d+-/i.test(s)) return "I/O channel";
  if (/^\d{3}[A-Z]{2,}/.test(s)) return "device/loop tag";
  if (/[A-Z]{3,}\s+[A-Z]{2,}/i.test(s)) return "description text";
  if (/^[A-Z][A-Z0-9/+=\-]{1,7}$/i.test(s)) return "symbol / short token";
  return "other";
}

for (const p of pages) {
  const file = corpus.get(p.sheet);
  if (!file) continue;
  const bytes = fs.readFileSync(file);
  const { records } = decodeRecordStream(bytes);
  const model = decodeCadSheet(bytes, p.sheet);

  // Everything the decoder can currently surface as engineering content.
  const recovered = new Set<string>();
  const add = (v: string | number | undefined | null) => {
    if (v == null) return;
    const s = norm(String(v));
    if (s) recovered.add(s);
  };
  for (const r of records) {
    add(r.symbolName);
    add(r.text);
    add(r.tag);
    add(r.reference);
    add(r.blockNumber);
    for (const e of r.entries ?? []) {
      add(e.reference);
      add(e.tag);
    }
  }
  for (const b of model.blocks) {
    add(b.functionCode);
    add(b.blockNumber);
    add(b.label);
    if (b.functionCodeNumber != null) add(`(${b.functionCodeNumber})`);
    for (const [k, v] of Object.entries(b.parameters)) {
      add(k);
      add(v);
    }
  }
  for (const a of model.annotations) add(a.text);
  for (const t of model.tags) add(t.raw);
  for (const x of model.crossReferences) {
    add(x.address);
    add(x.targetIdentifier);
  }

  const plotted = p.strings.map(norm).filter((s) => s && !BOILERPLATE.test(s));
  const uniquePlotted = [...new Set(plotted)];
  const missing: string[] = [];
  let matched = 0;
  for (const s of uniquePlotted) {
    // A plotted string counts as recovered if we hold it, or hold a value it
    // contains (plots concatenate adjacent fields into one text operator).
    const hit =
      recovered.has(s) ||
      [...recovered].some((r) => r.length >= 3 && (s.includes(r) || r.includes(s)));
    if (hit) matched++;
    else missing.push(s);
  }

  for (const s of missing) {
    missTally.set(s, (missTally.get(s) ?? 0) + 1);
    const k = classifyMiss(s);
    missKind.set(k, (missKind.get(k) ?? 0) + 1);
  }

  rows.push({
    sheet: p.sheet,
    plotted: uniquePlotted.length,
    matched,
    missing,
    records: records.length,
    blocks: model.stats.blockCount,
    fcNumbers: model.blocks.filter((b) => b.functionCodeNumber != null).length,
    specs: model.blocks.reduce(
      (n, b) => n + Object.keys(b.parameters).filter((k) => /^S\d/i.test(k)).length,
      0
    ),
  });
}

const totPlotted = rows.reduce((n, r) => n + r.plotted, 0);
const totMatched = rows.reduce((n, r) => n + r.matched, 0);

console.log("=".repeat(92));
console.log("GOLDEN MASTER — engineering content recovered vs vendor plot");
console.log("=".repeat(92));
console.log(`sheets compared           ${rows.length}`);
console.log(`plotted strings (unique)  ${totPlotted}`);
console.log(`recovered by decoder      ${totMatched}  (${((totMatched / totPlotted) * 100).toFixed(2)}%)`);
console.log(`not recovered             ${totPlotted - totMatched}`);
console.log(`blocks with an FC number  ${rows.reduce((n, r) => n + r.fcNumbers, 0)}`);
console.log(`decoded S-specifications  ${rows.reduce((n, r) => n + r.specs, 0)}`);
console.log("");
console.log("unrecovered strings by kind:");
for (const [k, n] of [...missKind].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(34)} ${String(n).padStart(7)}`);
}
console.log("\nmost frequently unrecovered strings:");
for (const [s, n] of [...missTally].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
  console.log(`  x${String(n).padStart(4)}  "${s}"`);
}

const worst = [...rows].sort((a, b) => a.matched / a.plotted - b.matched / b.plotted).slice(0, 10);
console.log("\nlowest-coverage sheets:");
for (const r of worst) {
  console.log(
    `  ${r.sheet.padEnd(14)} ${String(r.matched).padStart(4)}/${String(r.plotted).padEnd(4)} ` +
      `(${((r.matched / r.plotted) * 100).toFixed(0)}%)  records=${r.records} blocks=${r.blocks}`
  );
}

// ---- report
const outDir = path.join("tools", "cad-forensics", "out", "reference");
fs.mkdirSync(outDir, { recursive: true });
const md: string[] = [
  "# Golden master — decoded content vs reference CAD plot",
  "",
  `Reference: \`${pdfPath}\` (${pages.length} pages carrying a sheet stamp).`,
  "",
  `| Measure | Value |`,
  `| --- | --- |`,
  `| Sheets compared | ${rows.length} |`,
  `| Plotted strings (unique, excluding frame boilerplate) | ${totPlotted} |`,
  `| Recovered by decoder | ${totMatched} (${((totMatched / totPlotted) * 100).toFixed(2)}%) |`,
  `| Not recovered | ${totPlotted - totMatched} |`,
  "",
  "## Unrecovered strings by kind",
  "",
  "| Kind | Count |",
  "| --- | --- |",
  ...[...missKind].sort((a, b) => b[1] - a[1]).map(([k, n]) => `| ${k} | ${n} |`),
  "",
  "## Per-sheet coverage",
  "",
  "| Sheet | Plotted | Recovered | Coverage | Records | Blocks |",
  "| --- | --- | --- | --- | --- | --- |",
  ...rows.map(
    (r) =>
      `| ${r.sheet} | ${r.plotted} | ${r.matched} | ${((r.matched / r.plotted) * 100).toFixed(1)}% | ${r.records} | ${r.blocks} |`
  ),
];
fs.writeFileSync(path.join(outDir, "golden-master.md"), md.join("\n"), "utf8");
console.log(`\nreport -> ${path.join(outDir, "golden-master.md")}`);
