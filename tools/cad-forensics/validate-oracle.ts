/**
 * Reference comparison against the vendor's own cross-reference report.
 *
 * `I90XREF.OUT` is produced by ABB's I90XREF tool from these same .CAD files,
 * so it is independent ground truth. Its format, per sheet:
 *
 *   <path>\3070500A.CAD Outputs
 *   ------------------------------
 *        Description                Source               Destination(s)
 *   CAPTURE0705                     BA00-14.26      BAZ2-08.07 30705Z2A  ...
 *
 * This harness parses the report and checks the decoder against it:
 *   - does every reported output description appear as a decoded tag?
 *   - does every reported source address appear as a decoded reference?
 *   - does our sheet-suffix rule resolve destinations to the same filenames
 *     the vendor printed?
 */
import fs from "node:fs";
import path from "node:path";
import {
  ModuleRegistry,
  decodeCadSheet,
  decodeRecordStream,
  parseReference,
  resolveReferenceTarget,
} from "@infi90/cad-engine";
import { cadCorpus, findFiles } from "./lib/walk";

interface OracleOutput {
  sheet: string;
  description: string;
  source?: string;
  destinations: Array<{ reference: string; sheet: string }>;
}

function parseOracle(text: string): OracleOutput[] {
  const out: OracleOutput[] = [];
  let sheet = "";
  let inOutputs = false;

  for (const line of text.split(/\r?\n/)) {
    const head = line.match(/([A-Z0-9_~.\\:]+\\)?([A-Z0-9]+\.CAD)\s+(Outputs|Inputs)\s*$/i);
    if (head) {
      sheet = head[2].toUpperCase();
      inOutputs = head[3].toLowerCase() === "outputs";
      continue;
    }
    if (!inOutputs || !sheet) continue;
    if (/^-+$/.test(line.trim())) continue;
    if (/^\s*Description\s+Source\s+Destination/i.test(line)) continue;
    if (line.trim() === "") continue;

    // Description occupies a fixed left column; the source address is the
    // first 'XXXX-NN.NN' token, and destinations are reference/sheet pairs.
    const refs = [...line.matchAll(/([A-Z0-9]{4}-\d{2}\.\d{2})(?:\s+([A-Z0-9]{8}))?/gi)];
    if (refs.length === 0) continue;
    const description = line.slice(0, 32).trim();
    const source = refs[0][1];
    const destinations = refs
      .slice(1)
      .filter((m) => m[2])
      .map((m) => ({ reference: m[1].toUpperCase(), sheet: m[2].toUpperCase() }));

    if (description) {
      out.push({ sheet, description, source, destinations });
    } else if (out.length > 0) {
      // Continuation line: more destinations for the previous output.
      out[out.length - 1].destinations.push(
        ...refs.filter((m) => m[2]).map((m) => ({ reference: m[1].toUpperCase(), sheet: m[2].toUpperCase() }))
      );
    }
  }
  return out;
}

// ---- load every oracle report in the input material
const reports = findFiles(".", /I90XREF\.OUT$/i);
const oracle: OracleOutput[] = [];
for (const r of reports) {
  oracle.push(...parseOracle(fs.readFileSync(r, "latin1")));
}
console.log(`oracle reports: ${reports.length}`);
console.log(`oracle output rows: ${oracle.length}`);

const bySheet = new Map<string, OracleOutput[]>();
for (const o of oracle) {
  if (!bySheet.has(o.sheet)) bySheet.set(o.sheet, []);
  bySheet.get(o.sheet)!.push(o);
}
console.log(`oracle covers ${bySheet.size} distinct sheets\n`);

// ---- index the corpus by filename so we can decode the matching sheet
const corpus = new Map<string, string>();
for (const f of cadCorpus()) corpus.set(path.basename(f).toUpperCase(), f);

// ---- learn modulePrefix -> (loopPrefix, revision) from the archive alone,
// using no information from the oracle report.
const registry = new ModuleRegistry();
for (const name of corpus.keys()) registry.addSheet(name);
for (const [name, file] of corpus) {
  for (const r of decodeRecordStream(fs.readFileSync(file)).records) {
    const refs = [r.reference, ...(r.entries ?? []).map((e) => e.reference)];
    for (const raw of refs) {
      const p = parseReference(raw);
      if (p) registry.addReference(p.modulePrefix, p.sheetSuffix);
    }
  }
  void name;
}
console.log(`module registry: ${JSON.stringify(registry.stats)}`);
for (const e of registry.entries().slice(0, 12)) {
  console.log(
    `  ${e.prefix} -> loop ${e.loopPrefix}  score=${(e.score * 100).toFixed(0)}% support=${e.support}`
  );
}
console.log("");

let sheetsChecked = 0;
let descTotal = 0;
let descFound = 0;
let srcTotal = 0;
let srcFound = 0;
let destTotal = 0;
let destResolvedSame = 0;
let destResolvedDiff = 0;
let destUnresolved = 0;
const missDesc: string[] = [];
const destMismatch: string[] = [];

for (const [sheet, rows] of bySheet) {
  const file = corpus.get(sheet);
  if (!file) continue;
  sheetsChecked++;

  const model = decodeCadSheet(fs.readFileSync(file), sheet);
  const decodedTags = new Set<string>();
  for (const b of model.blocks) for (const d of b.deviceTags) decodedTags.add(d.toUpperCase());
  for (const tg of model.tags) decodedTags.add(tg.normalized);
  const decodedRefs = new Set<string>();
  for (const x of model.crossReferences) {
    const r = x.trace.sourceText?.match(/[A-Z0-9]{4}-\d{2}\.\d{2}/i);
    if (r) decodedRefs.add(r[0].toUpperCase());
  }
  for (const b of model.blocks) {
    const r = b.parameters.REF;
    if (r) decodedRefs.add(r.toUpperCase());
  }

  for (const row of rows) {
    descTotal++;
    if (decodedTags.has(row.description.toUpperCase())) descFound++;
    else if (missDesc.length < 8) missDesc.push(`${sheet}: "${row.description}"`);

    if (row.source) {
      srcTotal++;
      if (decodedRefs.has(row.source.toUpperCase())) srcFound++;
    }

    // Check the sheet-suffix resolution rule against the vendor's own answer.
    for (const d of row.destinations) {
      destTotal++;
      const parsed = parseReference(d.reference);
      // Registry only: a prefix we could not learn points at a loop that is
      // not in the supplied archive, so "unresolved" is the correct answer
      // rather than a same-loop guess that would name the wrong drawing.
      const target = parsed
        ? registry.targetFor(parsed.modulePrefix, parsed.sheetSuffix)
        : undefined;
      void resolveReferenceTarget;
      if (!target) {
        destUnresolved++;
        continue;
      }
      if (target.replace(/\.CAD$/i, "") === d.sheet.replace(/\.CAD$/i, "")) destResolvedSame++;
      else {
        destResolvedDiff++;
        if (destMismatch.length < 8) {
          destMismatch.push(`${sheet}: ${d.reference} -> we say ${target}, report says ${d.sheet}`);
        }
      }
    }
  }
}

const rate = (a: number, b: number) => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(2)}%`);

console.log("=".repeat(92));
console.log("VALIDATION AGAINST I90XREF.OUT (vendor ground truth)");
console.log("=".repeat(92));
console.log(`sheets cross-checked                 ${sheetsChecked}`);
console.log("");
console.log(`output descriptions in report        ${descTotal}`);
console.log(`  found as a decoded tag             ${descFound}  (${rate(descFound, descTotal)})`);
console.log("");
console.log(`source addresses in report           ${srcTotal}`);
console.log(`  found as a decoded reference       ${srcFound}  (${rate(srcFound, srcTotal)})`);
console.log("");
console.log(`destination references in report     ${destTotal}`);
console.log(`  our rule resolves to SAME sheet    ${destResolvedSame}  (${rate(destResolvedSame, destTotal)})`);
console.log(`  resolves to a DIFFERENT sheet      ${destResolvedDiff}`);
console.log(`  not resolvable                     ${destUnresolved}`);

if (missDesc.length) {
  console.log("\ndescriptions not matched:");
  for (const m of missDesc) console.log(`  ${m}`);
}
if (destMismatch.length) {
  console.log("\ndestination mismatches:");
  for (const m of destMismatch) console.log(`  ${m}`);
}
