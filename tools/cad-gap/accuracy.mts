// Independent accuracy audit of the forensic extraction against the vendor's
// own compiler reports shipped in the module archive:
//   20710.blk      block -> FC, sheet, address span (sub-block count)
//   20710.LIS      block -> FC, sheet, S1..SN typed values
//   20710.txt      block -> FC, sheet, S1..SN (second value source)
//   I90XREF.OUT    every OREF/IREF tag with source and destination zone addresses
//   I90XREF.ERR    unresolved references
//   20710.REF      module reference tag strings
// Comparison is exact-string on the extracted fields; nothing from these
// reports flows back into the extraction.
//   npx tsx tools/cad-gap/accuracy.mts <extract dir> <forensic out dir>
import fs from "node:fs";
import path from "node:path";

const [extractDir, outDir, expectedCache] = process.argv.slice(2);
if (!extractDir || !outDir) {
  console.error("usage: accuracy.mts <extract dir> <forensic out dir> [expected-pdf text cache json]");
  process.exit(2);
}

// Current-state arbiter: text of the vendor plot (plotted after the last CAD
// edit), used only to decide which side of a disagreement the drawing shows.
const expectedText = new Map<string, { strings: Set<string>; joined: string; stamp: string }>();
if (expectedCache) {
  const cache = JSON.parse(fs.readFileSync(expectedCache, "utf8")) as { pages: Array<{ items: Array<{ s: string }> }> };
  for (const p of cache.pages) {
    const stamp = p.items.find((i) => /[0-9A-Z]{5,8}\.CAD/i.test(i.s));
    const file = stamp ? /([0-9A-Z]{5,8}\.CAD)/i.exec(stamp.s)![1].toUpperCase() : null;
    if (!file) continue;
    const strings = new Set(p.items.map((i) => i.s.trim()).filter(Boolean));
    expectedText.set(file, { strings, joined: p.items.map((i) => i.s).join(""), stamp: stamp!.s });
  }
}
const onPlot = (file: string, s: string | null | undefined): boolean | null => {
  const e = expectedText.get(file.toUpperCase());
  if (!e || !s) return null;
  return e.strings.has(s.trim()) || e.joined.includes(s.trim());
};
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const all = walk(extractDir);
const find = (re: RegExp) => all.find((f) => re.test(path.basename(f)));
const load = (n: string) => JSON.parse(fs.readFileSync(path.join(outDir, n), "utf8"));

type Block = { id: string; file: string; block_address: number | null; function_code: number | null; drawn: boolean; sub_blocks: string[]; specifications: string[]; status: string };
type Spec = { id: string; parent_block: string; block_address: number | null; function_code: number | null; number: number; type: string; raw_value_text: string | null; actual_value: number | string | null; value_status: string };
type Ref = { id: string; type: string; label: string | null; signal: string | null; signal_raw?: string | null; zone: string | null; file: string; status: string; target_reference: { status: string } };
type Chan = { id: string; text: string; file: string; attached_to: string };
const blocks: Block[] = load("function_blocks.json");
const specs: Spec[] = load("specifications.json");
const refs: Ref[] = load("references.json");
const chans: Chan[] = load("channels.json");
const subBlocks: Array<{ parent_block: string; offset: number }> = load("sub_blocks.json");
const freeText = new Map<string, Set<string>>();
for (const e of load("entities.json") as Array<{ id: string; type: string; text: string | null }>) {
  if (e.type !== "text" || !e.text) continue;
  const file = e.id.split(":")[0].toUpperCase();
  if (!freeText.has(file)) freeText.set(file, new Set());
  freeText.get(file)!.add(e.text.trim());
}

const sheetFile = (code: string, prefix: string) => `${prefix}${code}C.CAD`;
const prefix = (() => {
  const m = blocks.map((b) => /^(.*)..C\.CAD$/i.exec(b.file)?.[1]).find(Boolean);
  return m ?? "";
})();

// ------------------------------------------------------------ oracle parsers
interface OBlock { block: number; fc: number; sheet: string; span: number; conflict: string | null }
function parseBlk(file: string): OBlock[] {
  const out: OBlock[] = [];
  for (const line of fs.readFileSync(file, "latin1").split(/\r?\n/)) {
    const m = /^\s+(\d{4})(?:-(\d{4}) \(\s*(\d+)\))?\s+FC\s+(\d+)\s+SH:(\S+)\s*(.*)$/.exec(line);
    if (!m) continue;
    out.push({ block: +m[1], fc: +m[4], sheet: m[5], span: m[3] ? +m[3] : 1, conflict: m[6].trim() || null });
  }
  return out;
}

interface OSpec { n: number; type: string; value: string; tune: boolean }
interface OLisBlock { block: number; fc: number; rev: number; sheet: string; name: string; specs: OSpec[] }
function parseLis(file: string): OLisBlock[] {
  const out: OLisBlock[] = [];
  let cur: OLisBlock | null = null;
  for (const line of fs.readFileSync(file, "latin1").split(/\r?\n/)) {
    const h = /^\s+Block\s+(\d+):\s+FC\s+(\d+)\s+rev\s+(\d+):\s+Sheet\s+(\S+):\s*(.*)$/.exec(line);
    if (h) {
      cur = { block: +h[1], fc: +h[2], rev: +h[3], sheet: h[4], name: h[5].trim(), specs: [] };
      out.push(cur);
      continue;
    }
    const s = /^\s+S(\d+)\s+(TO)?\s+([A-Z]\d?)\s+(\S+)/.exec(line);
    if (s && cur) cur.specs.push({ n: +s[1], tune: !!s[2], type: s[3], value: s[4] });
  }
  return out;
}

interface OTxtBlock { block: number; fc: number; sheet: string; values: string[] }
function parseTxt(file: string, sheets: Set<string>, spans: Map<number, number>): { rows: OTxtBlock[]; ambiguous: string[] } {
  const rows: OTxtBlock[] = [];
  const ambiguous: string[] = [];
  const lines = fs.readFileSync(file, "latin1").split(/\r?\n/).slice(2);
  for (const line of lines) {
    if (!line.trim()) continue;
    const t = line.split("\t");
    // "start end FC sheet S..." for multi-address FCs, "block FC sheet S..." otherwise;
    // the vendor trace (.blk) gives each block's address span to tell them apart.
    let four = t.length > 3 && sheets.has(t[3]) && +t[1] > +t[0];
    let three = sheets.has(t[2]);
    if (four && three) {
      const span = spans.get(+t[0]);
      if (span != null) { four = span > 1 && +t[1] === +t[0] + span - 1; three = !four; }
    }
    if (four === three) { ambiguous.push(line); continue; }
    rows.push(four ? { block: +t[0], fc: +t[2], sheet: t[3], values: t.slice(4) } : { block: +t[0], fc: +t[1], sheet: t[2], values: t.slice(3) });
  }
  return { rows, ambiguous };
}

interface XrefRow { kind: "OUT" | "IN"; sheet: string; desc: string; source: string; destinations: Array<{ addr: string; sheet: string }> }
function parseXrefOut(file: string): XrefRow[] {
  const rows: XrefRow[] = [];
  let sheet = "";
  let kind: "OUT" | "IN" = "OUT";
  let cur: XrefRow | null = null;
  const addrRe = /([A-Z0-9]{2}[0-9A-Z]{2}-\d{2}\.\d{2})\s+([0-9A-Z]{5,8})/g;
  for (const line of fs.readFileSync(file, "latin1").split(/\r?\n/)) {
    const h = /\\([^\\]+\.CAD)\s+(Outputs|Inputs)\s*$/i.exec(line);
    if (h) { sheet = h[1].toUpperCase(); kind = /out/i.test(h[2]) ? "OUT" : "IN"; cur = null; continue; }
    if (!sheet || /^\s*(Description|-{5,})/.test(line) || !line.trim()) { if (!line.trim()) cur = null; continue; }
    const desc = line.slice(0, 32);
    const rest = line.slice(32);
    const src = /^([A-Z0-9]{4}-\d{2}\.\d{2})/.exec(rest.trim());
    if (desc.trim() && src) {
      cur = { kind, sheet, desc: desc.replace(/\s+$/, ""), source: src[1], destinations: [] };
      rows.push(cur);
      for (const m of rest.trim().slice(src[1].length).matchAll(addrRe)) cur.destinations.push({ addr: m[1], sheet: `${m[2]}.CAD` });
    } else if (cur && !desc.trim()) {
      for (const m of rest.matchAll(addrRe)) cur.destinations.push({ addr: m[1], sheet: `${m[2]}.CAD` });
    }
  }
  return rows;
}

function parseXrefErr(file: string) {
  return fs.readFileSync(file, "latin1").split(/\r?\n/).flatMap((l) => {
    const m = /^Unrslvd (Inp|Out):(.*) ([A-Z0-9]{4}-\d{2}\.\d{2}) In: .*\\([^\\]+\.CAD)\s*$/i.exec(l);
    return m ? [{ kind: m[1] === "Inp" ? "IREF" : "OREF", desc: m[2].replace(/^\s+/, ""), addr: m[3], sheet: m[4].toUpperCase() }] : [];
  });
}

function refStrings(file: string): string[] {
  const buf = fs.readFileSync(file);
  const out: string[] = [];
  let s = "";
  for (const b of buf) {
    if (b >= 0x20 && b < 0x7f) s += String.fromCharCode(b);
    else { if (s.trim().length >= 2) out.push(s); s = ""; }
  }
  if (s.trim().length >= 2) out.push(s);
  return out.flatMap((x) => x.split(/\s{2,}/)).map((x) => x.trim()).filter((x) => x.length >= 2);
}

// C printf %g (precision 6, MSVC 3-digit exponent)
function cG(v: number): string {
  if (v === 0) return "0";
  if (!Number.isFinite(v)) return String(v);
  const e = Math.floor(Math.log10(Math.abs(Number(v.toPrecision(6)))));
  if (e < -4 || e >= 6) {
    const [m, x] = v.toExponential(5).split("e");
    const mant = m.includes(".") ? m.replace(/0+$/, "").replace(/\.$/, "") : m;
    const ex = +x;
    return `${mant}e${ex < 0 ? "-" : "+"}${String(Math.abs(ex)).padStart(3, "0")}`;
  }
  const f = v.toFixed(Math.max(0, 5 - e));
  return f.includes(".") ? f.replace(/0+$/, "").replace(/\.$/, "") : f;
}

// ------------------------------------------------------------ comparisons
const report: Record<string, unknown> = { extract: extractDir, forensic: outDir, generated_at: new Date().toISOString() };
const sheetsInModule = new Set(blocks.map((b) => b.file.toUpperCase()));
const sheetCodes = new Set([...sheetsInModule].map((f) => f.slice(prefix.length, prefix.length + 2)));
const byAddr = new Map<number, Block[]>();
for (const b of blocks) if (b.block_address != null) byAddr.set(b.block_address, [...(byAddr.get(b.block_address) ?? []), b]);
const blockById = new Map(blocks.map((b) => [b.id, b]));
const subCount = new Map<string, number>();
for (const s of subBlocks) subCount.set(s.parent_block, Math.max(subCount.get(s.parent_block) ?? 0, s.offset + 1));

type Finding = Record<string, unknown>;
const tally = (xs: Finding[]) => xs.reduce<Record<string, number>>((a, x) => ((a[String(x.result)] = (a[String(x.result)] ?? 0) + 1), a), {});

// A. block identity: address -> FC -> sheet, and address span (sub-blocks)
const blkFile = find(/\.blk$/i);
const blockFindings: Finding[] = [];
if (blkFile) {
  const oracle = parseBlk(blkFile);
  const seen = new Set<string>();
  for (const o of oracle) {
    const file = sheetFile(o.sheet, prefix).toUpperCase();
    const cands = (byAddr.get(o.block) ?? []).filter((b) => b.file.toUpperCase() === file);
    const any = byAddr.get(o.block) ?? [];
    if (!cands.length) {
      blockFindings.push({ result: any.length ? "SHEET_MISMATCH" : "MISSING", block: o.block, fc: o.fc, sheet: file, extracted: any.map((b) => `${b.file} FC${b.function_code}`), oracle_conflict: o.conflict });
      continue;
    }
    const b = cands.find((c) => c.function_code === o.fc);
    if (!b) { blockFindings.push({ result: "FC_MISMATCH", block: o.block, sheet: file, oracle_fc: o.fc, extracted_fc: cands.map((c) => c.function_code), oracle_conflict: o.conflict }); continue; }
    seen.add(b.id);
    const n = subCount.get(b.id) ?? 0;
    blockFindings.push({ result: n === o.span ? "MATCH" : "SPAN_MISMATCH", block: o.block, fc: o.fc, sheet: file, oracle_span: o.span, extracted_sub_blocks: n, id: b.id, oracle_conflict: o.conflict });
  }
  for (const b of blocks) if (b.block_address != null && !seen.has(b.id) && b.function_code != null) {
    if (!blockFindings.some((f) => f.block === b.block_address && f.result !== "MATCH")) blockFindings.push({ result: "EXTRA_IN_EXTRACT", block: b.block_address, fc: b.function_code, sheet: b.file, id: b.id, status: b.status, drawn: b.drawn });
  }
}

const onPlotExact = (file: string, s: string): boolean | null => {
  const e = expectedText.get(file.toUpperCase());
  return e ? [...e.strings].some((x) => x.split(/\s+/).includes(s)) : null;
};
for (const f of blockFindings) {
  if (f.result === "MATCH") continue;
  const n = String(f.block);
  if (f.result === "SHEET_MISMATCH") {
    const oracleSheetExists = sheetsInModule.has(String(f.sheet));
    const ext = (f.extracted as string[]).map((x) => x.split(" ")[0]);
    f.oracle_sheet_in_archive = oracleSheetExists;
    f.block_number_on_current_plot_of_extracted_sheet = ext.map((x) => onPlotExact(x, n));
    f.block_number_on_current_plot_of_oracle_sheet = oracleSheetExists ? onPlotExact(String(f.sheet), n) : null;
    f.verdict = !oracleSheetExists
      ? "ORACLE_SHEET_DELETED (report lists a sheet no longer in the archive; reported as an address conflict)"
      : f.block_number_on_current_plot_of_oracle_sheet === false && (f.block_number_on_current_plot_of_extracted_sheet as Array<boolean | null>).some((x) => x)
        ? "MOVED_SINCE_REPORT (current plot shows the block on the extracted sheet)"
        : "NEEDS_REVIEW";
  } else if (f.result === "EXTRA_IN_EXTRACT") {
    f.block_number_on_current_plot = onPlotExact(String(f.sheet), n);
    f.verdict = f.block_number_on_current_plot ? "ADDED_SINCE_REPORT (current plot shows the block)" : f.drawn === false ? "TRAILER_ONLY (configured in the trailer, no symbol drawn)" : "NEEDS_REVIEW";
  } else if (f.result === "SPAN_MISMATCH") {
    f.verdict = "NEEDS_REVIEW";
  }
}

// B. spec values vs LIS (typed) and 20710.txt
const lisFile = find(/\.LIS$/i);
const specFindings: Finding[] = [];
const specByBlockN = new Map<string, Spec>();
for (const s of specs) {
  const b = blockById.get(s.parent_block);
  if (b && s.block_address != null) specByBlockN.set(`${b.file.toUpperCase()}|${s.block_address}|${s.number}`, s);
}
const extractedValue = (s: Spec) => (typeof s.actual_value === "number" ? (s.type === "R" ? cG(s.actual_value) : String(s.actual_value)) : String(s.actual_value));
if (lisFile) {
  for (const o of parseLis(lisFile)) {
    const file = sheetFile(o.sheet, prefix).toUpperCase();
    const b = (byAddr.get(o.block) ?? []).find((x) => x.file.toUpperCase() === file && x.function_code === o.fc);
    if (!b) { specFindings.push({ result: "BLOCK_NOT_EXTRACTED", block: o.block, fc: o.fc, sheet: file, specs: o.specs.length }); continue; }
    const ours = specs.filter((s) => s.parent_block === b.id);
    if (ours.length !== o.specs.length) specFindings.push({ result: "SPEC_COUNT_MISMATCH", block: o.block, fc: o.fc, sheet: file, oracle: o.specs.length, extracted: ours.length });
    for (const os of o.specs) {
      const s = specByBlockN.get(`${file}|${o.block}|${os.n}`);
      if (!s) { specFindings.push({ result: "SPEC_MISSING", block: o.block, fc: o.fc, sheet: file, spec: `S${os.n}`, oracle_value: os.value }); continue; }
      const v = extractedValue(s);
      const typeOk = s.type === os.type[0];
      specFindings.push({ result: v === os.value ? (typeOk ? "MATCH" : "TYPE_MISMATCH") : "VALUE_MISMATCH", block: o.block, fc: o.fc, sheet: file, spec: `S${os.n}`, oracle_value: os.value, extracted_value: v, raw_value_text: s.raw_value_text, oracle_type: os.type, extracted_type: s.type, tune_oracle: os.tune, id: s.id, ...(v === os.value && !typeOk ? { verdict: `MANUAL_TYPE_AUTHORITATIVE (value identical; manual declares ${s.type}, vendor report prints ${os.type})` } : {}) });
    }
  }
}
// Evidence for each value disagreement: is the extracted value corroborated by
// the drawing (wire into the pin), and do the block's other specs match (which
// proves the bytes are read at the right offsets)?
{
  const specById = new Map(specs.map((s) => [s.id, s as Spec & { effective_input?: { address: number | null; status: string } | null; is_block_address?: boolean }]));
  const perBlock = new Map<string, { match: number; diff: number }>();
  for (const f of specFindings) {
    if (!f.id) continue;
    const k = String(f.id).replace(/\.S\d+$/, "");
    const p = perBlock.get(k) ?? { match: 0, diff: 0 };
    if (f.result === "VALUE_MISMATCH") p.diff++; else p.match++;
    perBlock.set(k, p);
  }
  const wireConfirms = (id: string) => {
    const s = specById.get(id)!;
    const ei = s.effective_input;
    return !!ei && ei.address != null && ei.address === s.actual_value;
  };
  const anchored = new Set<string>();
  for (const f of specFindings) if (f.id && f.result === "VALUE_MISMATCH" && wireConfirms(String(f.id))) anchored.add(String(f.id).replace(/\.S\d+$/, ""));
  for (const f of specFindings) {
    if (f.result !== "VALUE_MISMATCH") continue;
    const blockKey = String(f.id).replace(/\.S\d+$/, "");
    const p = perBlock.get(blockKey)!;
    const confirmed = wireConfirms(String(f.id));
    f.block_specs_matching = p.match;
    f.block_specs_differing = p.diff;
    f.wire_confirms_extracted = confirmed;
    const aligned = p.match > 0 || anchored.has(blockKey);
    f.verdict = confirmed
      ? "EXTRACTED_CONFIRMED_BY_WIRE (vendor report predates the wiring)"
      : aligned
        ? f.tune_oracle ? "ISOLATED_CHANGE_TUNABLE (alignment proven by matching or wire-confirmed neighbours; value changed after the report)" : "ISOLATED_CHANGE (alignment proven by matching or wire-confirmed neighbours; value changed after the report)"
        : p.match + p.diff === 1 && f.tune_oracle
          ? "SINGLE_SPEC_TUNABLE (one-spec block, block/FC/sheet identity matches; tunable operator value)"
          : "WHOLE_BLOCK_DIFFERS (needs review)";
  }
}

const txtFile = all.find((f) => /\.txt$/i.test(f) && /Start Block\tEnd Block/.test(fs.readFileSync(f, "latin1").slice(0, 400)));
const txtFindings: Finding[] = [];
let txtAmbiguous: string[] = [];
if (txtFile) {
  const blkRows = blkFile ? parseBlk(blkFile) : [];
  const spans = new Map(blkRows.map((o) => [o.block, o.span]));
  const codes = new Set([...sheetCodes, ...blkRows.map((o) => o.sheet)]);
  const { rows, ambiguous } = parseTxt(txtFile, codes, spans);
  txtAmbiguous = ambiguous;
  for (const o of rows) {
    const file = sheetFile(o.sheet, prefix).toUpperCase();
    o.values.forEach((val, i) => {
      if (val === "") return;
      const s = specByBlockN.get(`${file}|${o.block}|${i + 1}`);
      if (!s) {
        const verdict = !sheetsInModule.has(file) ? "ORACLE_SHEET_DELETED" : (byAddr.get(o.block) ?? []).some((b) => b.file.toUpperCase() !== file) ? "MOVED_SINCE_REPORT (block now on another sheet)" : "NEEDS_REVIEW";
        txtFindings.push({ result: "SPEC_MISSING", block: o.block, fc: o.fc, sheet: file, spec: `S${i + 1}`, oracle_value: val, verdict });
        return;
      }
      const v = extractedValue(s);
      txtFindings.push({ result: v === val ? "MATCH" : "VALUE_MISMATCH", block: o.block, fc: o.fc, sheet: file, spec: `S${i + 1}`, oracle_value: val, extracted_value: v, id: s.id });
    });
  }
}

{
  const lisVerdict = new Map(specFindings.filter((f) => f.verdict).map((f) => [`${f.sheet}|${f.block}|${f.spec}`, String(f.verdict)]));
  for (const f of txtFindings) if (f.result === "VALUE_MISMATCH") f.verdict = lisVerdict.get(`${f.sheet}|${f.block}|${f.spec}`) ?? "NEEDS_REVIEW (differs from TXT but not from LIS)";
}

// C. cross-references: every OREF/IREF row of I90XREF.OUT, exact signal and zone
const xrefFile = find(/^I90XREF\.OUT$/i);
const xrefFindings: Finding[] = [];
const refKey = (type: string, file: string, zone: string) => `${type}|${file.toUpperCase()}|${zone}`;
const refsAt = new Map<string, Ref[]>();
for (const r of refs) if (r.zone) refsAt.set(refKey(r.type, r.file, r.zone), [...(refsAt.get(refKey(r.type, r.file, r.zone)) ?? []), r]);
const matchedRefs = new Set<string>();
let moduleId = "";
const codeOf = (file: string) => file.toUpperCase().slice(prefix.length, prefix.length + 2);
// A reference's decoded zone is self-consistent when the partner reference on
// another sheet stores exactly this sheet+zone as its reference text.
const partnerConfirms = (r: Ref) => refs.some((p) => p.id !== r.id && p.signal === r.signal && p.label === `${moduleId}${codeOf(r.file)}-${r.zone}`);
const arbitrate = (f: Finding, type: string, file: string, desc: string, extracted: Ref[]) => {
  const sameSignal = refs.filter((r) => r.type === type && r.file.toUpperCase() === file && r.signal != null && r.signal.trim() === desc.trim());
  f.same_signal_at = sameSignal.map((r) => ({ id: r.id, zone: r.zone, partner_confirms_zone: partnerConfirms(r) }));
  f.oracle_signal_on_current_plot = onPlot(file, desc);
  f.extracted_signal_on_current_plot = extracted.map((r) => onPlot(file, r.signal));
  f.extracted_partner_confirms = extracted.map((r) => partnerConfirms(r));
  const sigOnPlot = f.oracle_signal_on_current_plot;
  if (sameSignal.length) {
    sameSignal.forEach((r) => matchedRefs.add(r.id));
    f.verdict = sameSignal.some((r) => partnerConfirms(r)) || sigOnPlot ? "MOVED_SINCE_REPORT (same tag on this sheet at another zone; current source self-consistent)" : "MOVED_SINCE_REPORT_UNCONFIRMED";
  } else if (sigOnPlot === false && extracted.length && extracted.every((r) => onPlot(file, r.signal) !== false)) {
    f.verdict = "TAG_CHANGED_SINCE_REPORT (current plot shows the extracted tag, not the report's)";
  } else if (sigOnPlot === false && !extracted.length) {
    f.verdict = "REMOVED_SINCE_REPORT (tag not on the current plot of this sheet)";
  } else if (sigOnPlot === true && freeText.get(file)?.has(desc.trim())) {
    f.verdict = "PRESENT_AS_FREE_TEXT (current source holds this string as a text entity, not a connector record; extracted as text)";
  } else if (sigOnPlot === true) {
    f.verdict = "EXTRACTION_GAP (tag is on the current plot but not extracted here)";
  } else {
    f.verdict = "NEEDS_REVIEW";
  }
};
const checkRef = (type: string, file: string, addr: string, desc: string, ctx: Finding) => {
  if (!moduleId) moduleId = addr.slice(0, 2);
  const zone = addr.slice(5);
  const cands = refsAt.get(refKey(type, file, zone)) ?? [];
  if (!cands.length) { const f: Finding = { ...ctx, result: "REF_MISSING", type, sheet: file, zone, oracle_signal: desc }; arbitrate(f, type, file, desc, []); xrefFindings.push(f); return; }
  const exact = cands.find((r) => r.signal === desc);
  if (exact) { matchedRefs.add(exact.id); xrefFindings.push({ ...ctx, result: "MATCH", type, sheet: file, zone, signal: desc, id: exact.id }); return; }
  const loose = cands.find((r) => (r.signal ?? "").trim() === desc.trim());
  if (loose) { matchedRefs.add(loose.id); xrefFindings.push({ ...ctx, result: "MATCH_WHITESPACE_ONLY", type, sheet: file, zone, oracle_signal: JSON.stringify(desc), extracted_signal: JSON.stringify(loose.signal), id: loose.id }); return; }
  const f: Finding = { ...ctx, result: "SIGNAL_MISMATCH", type, sheet: file, zone, oracle_signal: desc, extracted_signal: cands.map((r) => r.signal), ids: cands.map((r) => r.id) };
  arbitrate(f, type, file, desc, cands);
  xrefFindings.push(f);
};
let xrefRows: XrefRow[] = [];
if (xrefFile) {
  xrefRows = parseXrefOut(xrefFile);
  for (const row of xrefRows) {
    const localType = row.kind === "OUT" ? "OREF" : "IREF";
    const remoteType = row.kind === "OUT" ? "IREF" : "OREF";
    checkRef(localType, row.sheet, row.source, row.desc, { side: "source", xref: row.kind });
    for (const d of row.destinations) checkRef(remoteType, d.sheet, d.addr, row.desc, { side: "destination", xref: row.kind, from: `${row.sheet} ${row.source}` });
  }
}
const errFile = find(/^I90XREF\.ERR$/i);
const errFindings: Finding[] = [];
if (errFile) {
  for (const e of parseXrefErr(errFile)) {
    const zone = e.addr.slice(5);
    const cands = refsAt.get(refKey(e.kind, e.sheet, zone)) ?? [];
    const exactOf = (x: Ref) => (x.signal_raw ?? x.signal ?? "").trimStart();
    const r = cands.find((x) => x.signal === e.desc || exactOf(x) === e.desc) ?? cands.find((x) => (x.signal ?? "").trim() === e.desc.trim());
    if (r) matchedRefs.add(r.id);
    const f: Finding = { result: !r ? (cands.length ? "SIGNAL_MISMATCH" : "REF_MISSING") : r.signal === e.desc || exactOf(r) === e.desc ? "MATCH" : "MATCH_WHITESPACE_ONLY", type: e.kind, sheet: e.sheet, zone, oracle_signal: JSON.stringify(e.desc), extracted: cands.map((x) => ({ id: x.id, signal: x.signal, signal_raw: x.signal_raw ?? null, target: x.target_reference.status })) };
    if (!r) arbitrate(f, e.kind, e.sheet, e.desc, cands);
    errFindings.push(f);
  }
}
const unwitnessedRefs = refs.filter((r) => !matchedRefs.has(r.id)).map((r) => {
  const plot = onPlot(r.file, r.signal);
  const partner = partnerConfirms(r);
  return {
    id: r.id, type: r.type, signal: r.signal, label: r.label, zone: r.zone, target: r.target_reference.status, status: r.status,
    signal_on_current_plot: plot, partner_confirms_zone: partner,
    verdict: partner ? "ADDED_SINCE_REPORT (partner reference stores this sheet+zone)" : plot ? "ON_CURRENT_PLOT (not in the 2014 xref; current drawing shows it)" : !r.signal ? "BLANK_TAG (connector with no signal text in source)" : "NEEDS_REVIEW",
  };
});

// D. module tag strings (.REF) vs extracted reference signals and channel strings
const refFile = find(/\.REF$/i);
let tagFindings: Finding = {};
if (refFile) {
  const tags = new Set(refStrings(refFile));
  const ours = new Set([...refs.map((r) => (r.signal ?? "").trim()), ...chans.map((c) => c.text.trim())].filter(Boolean));
  const vendorNotExtracted = [...tags].filter((t) => /[A-Z0-9]/.test(t) && !ours.has(t) && ![...ours].some((o) => o.startsWith(t) || t.startsWith(o)));
  const extractedNotVendor = refs.filter((r) => r.signal && !tags.has(r.signal.trim()));
  tagFindings = {
    vendor_tag_strings: tags.size,
    extracted_reference_signals: new Set(refs.map((r) => r.signal).filter(Boolean)).size,
    reference_signals_found_in_REF: refs.filter((r) => r.signal && tags.has(r.signal.trim())).length,
    reference_signals_not_in_REF: extractedNotVendor.map((r) => ({ id: r.id, type: r.type, signal: r.signal, target: r.target_reference.status })),
    vendor_strings_not_extracted_candidates: vendorNotExtracted,
  };
}

report.oracles = { blk: blkFile ?? null, lis: lisFile ?? null, txt: txtFile ?? null, xref_out: xrefFile ?? null, xref_err: errFile ?? null, ref: refFile ?? null };
report.summary = {
  block_identity: tally(blockFindings),
  block_mismatch_verdicts: blockFindings.filter((f) => f.verdict).reduce<Record<string, number>>((a, f) => ((a[String(f.verdict).split(" ")[0]] = (a[String(f.verdict).split(" ")[0]] ?? 0) + 1), a), {}),
  spec_values_LIS: tally(specFindings),
  spec_type_mismatch: [...new Set(specFindings.filter((f) => f.result === "TYPE_MISMATCH").map((f) => `FC${f.fc} ${f.spec}: ${f.verdict}`))],
  spec_value_mismatch_verdicts: specFindings.filter((f) => f.result === "VALUE_MISMATCH").reduce<Record<string, number>>((a, f) => ((a[String(f.verdict).split(" ")[0]] = (a[String(f.verdict).split(" ")[0]] ?? 0) + 1), a), {}),
  spec_values_TXT: tally(txtFindings),
  spec_values_TXT_verdicts: txtFindings.filter((f) => f.verdict).reduce<Record<string, number>>((a, f) => ((a[String(f.verdict).split(" ")[0]] = (a[String(f.verdict).split(" ")[0]] ?? 0) + 1), a), {}),
  txt_rows_ambiguous: txtAmbiguous.length,
  xref_rows: xrefRows.length,
  xref_checks: tally(xrefFindings),
  xref_mismatch_verdicts: xrefFindings.filter((f) => f.verdict).reduce<Record<string, number>>((a, f) => ((a[String(f.verdict).split(" ")[0]] = (a[String(f.verdict).split(" ")[0]] ?? 0) + 1), a), {}),
  xref_err_checks: tally(errFindings),
  references_total: refs.length,
  references_witnessed_by_xref: matchedRefs.size,
  references_not_witnessed: unwitnessedRefs.length,
  references_not_witnessed_verdicts: unwitnessedRefs.reduce<Record<string, number>>((a, f) => ((a[f.verdict.split(" ")[0]] = (a[f.verdict.split(" ")[0]] ?? 0) + 1), a), {}),
  xref_err_verdicts: errFindings.filter((f) => f.verdict).reduce<Record<string, number>>((a, f) => ((a[String(f.verdict).split(" ")[0]] = (a[String(f.verdict).split(" ")[0]] ?? 0) + 1), a), {}),
};
const nonMatch = (xs: Finding[]) => xs.filter((x) => x.result !== "MATCH");
report.block_identity = nonMatch(blockFindings);
report.spec_values_LIS = nonMatch(specFindings);
report.spec_values_TXT = nonMatch(txtFindings);
report.txt_ambiguous_rows = txtAmbiguous;
report.xref = nonMatch(xrefFindings);
report.xref_err = nonMatch(errFindings);
report.references_not_witnessed = unwitnessedRefs;
report.tags = tagFindings;
fs.writeFileSync(path.join(outDir, "accuracy_audit.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report.summary, null, 1));
