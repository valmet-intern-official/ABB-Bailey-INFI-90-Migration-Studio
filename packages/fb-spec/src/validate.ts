/**
 * Validation of an extraction result. Every check is machine-readable.
 * Checks against vendor material (spec report, expected plot) are optional
 * oracles: they measure agreement, they never feed values back.
 */
import { decodePayload, getFunctionCode } from "@infi90/function-codes";
import type { LayoutReport } from "./engineering";
import type { ExtractionResult } from "./types";

export interface Check {
  id: string;
  name: string;
  pass: boolean;
  detail: string;
  failures?: string[];
}

export interface VendorSpecReport {
  /** block → { fc, specs: spec number → printed value } */
  blocks: Map<number, { fc: number; specs: Map<number, string> }>;
  source: string;
}

export interface VendorPlotText {
  source: string;
  pages: Array<{ page: number; width: number; height: number; items: Array<{ x: number; y: number; s: string }> }>;
}

export interface ValidationOptions {
  layout?: LayoutReport[];
  /** SHA-256 of the serialized result from two independent runs. */
  determinism?: { first: string; second: string };
  specReport?: VendorSpecReport;
  plot?: VendorPlotText;
  verifyReport?: VendorVerifyReport;
}

export interface ValidationReport {
  module: string;
  passed: boolean;
  checks: Check[];
  oracle: Record<string, unknown>;
}

const cap = (xs: string[], n = 25) => (xs.length > n ? [...xs.slice(0, n), `... ${xs.length - n} more`] : xs);

export function validateResult(r: ExtractionResult, opts: ValidationOptions = {}): ValidationReport {
  const checks: Check[] = [];
  const add = (id: string, name: string, failures: string[], detail: string) => checks.push({ id, name, pass: failures.length === 0, detail, ...(failures.length ? { failures: cap(failures) } : {}) });
  const specById = new Map(r.specifications.map((s) => [s.id, s]));
  const blockById = new Map(r.blocks.map((b) => [b.id, b]));

  // 1. every trailer entry became a block record
  const trailerTotal = r.sheets.reduce((a, s) => a + s.trailer_entries, 0);
  const fromTrailer = r.blocks.filter((b) => b.function_code != null).length;
  add("trailer_coverage", "Every CAD trailer entry has a function-block record", fromTrailer === trailerTotal ? [] : [`${trailerTotal} trailer entries, ${fromTrailer} block records`], `${fromTrailer}/${trailerTotal}`);

  // 2. ids unique
  const dupIds = [...r.blocks.map((b) => b.id), ...r.specifications.map((s) => s.id), ...r.connections.map((c) => c.id)].filter((id, i, a) => a.indexOf(id) !== i);
  add("unique_ids", "Block, spec and connection ids are unique", dupIds, `${dupIds.length} duplicates`);

  // 3. no invented values: every value re-decodes from the block payload bytes
  const invented: string[] = [];
  for (const b of r.blocks) {
    if (b.function_code == null) continue;
    const schema = getFunctionCode(b.function_code);
    const specs = b.spec_ids.map((id) => specById.get(id)!);
    if (!schema) {
      if (specs.length) invented.push(`${b.id}: specs without manual schema`);
      continue;
    }
    const d = decodePayload(schema, Buffer.from(b.payload_hex, "hex"));
    for (const s of specs) {
      const ref = d.specs.find((x) => x.number === s.spec_number);
      if (s.raw_value_text == null) {
        if (s.actual_value != null || s.normalized_value != null || s.raw_hex != null) invented.push(`${s.id}: value without raw text`);
        if (s.status === "EXTRACTED") invented.push(`${s.id}: EXTRACTED without value`);
        continue;
      }
      if (!ref) invented.push(`${s.id}: value ${s.raw_value_text} not present in payload decode`);
      else if (ref.raw_hex !== s.raw_hex || ref.raw_value_text !== s.raw_value_text || !Object.is(ref.actual_value, s.actual_value)) invented.push(`${s.id}: ${s.raw_value_text} != payload ${ref.raw_value_text}`);
    }
  }
  add("no_invented_values", "Every spec value re-decodes from its CAD payload bytes; unresolved specs carry no value", invented, `${r.specifications.length} specs re-decoded`);

  // 4. manual semantics copied exactly
  const manual: string[] = [];
  for (const s of r.specifications) {
    const m = getFunctionCode(s.function_code)?.specifications.find((x) => x.number === s.spec_number);
    if (!m) {
      manual.push(`${s.id}: spec not in manual schema`);
      continue;
    }
    for (const k of ["type", "default", "range", "tune_raw", "label"] as const) if (m[k] !== s[k]) manual.push(`${s.id}.${k}: '${s[k]}' vs manual '${m[k]}'`);
    if (m.description !== s.manual_description) manual.push(`${s.id}.description differs from manual`);
  }
  add("manual_match", "Spec label, type, default, tune, range and description equal the manual knowledge base", manual, `${r.specifications.length} specs compared`);

  // 5. spec counts follow the manual schema
  const counts: string[] = [];
  for (const b of r.blocks) {
    if (b.function_code == null) continue;
    const schema = getFunctionCode(b.function_code);
    if (schema && b.spec_ids.length !== schema.spec_count) counts.push(`${b.id}: ${b.spec_ids.length} specs, manual ${schema.spec_count}`);
  }
  add("spec_count", "Each block has exactly the manual's specifications", counts, `${r.blocks.length} blocks`);

  // 6. layout closure
  const layout = r.blocks.filter((b) => b.function_code != null && getFunctionCode(b.function_code) && b.layout_status !== "DECODED").map((b) => `${b.id}: ${b.layout_status} (${b.actual_bytes} vs ${b.expected_bytes ?? "?"} bytes)`);
  add("layout_closure", "Every payload closes exactly against its manual spec layout", layout, `${layout.length} blocks not closing`);

  // 7. address resolutions point at existing blocks
  const byAddr = new Map<number, string[]>();
  for (const b of r.blocks) byAddr.set(b.block_address, [...(byAddr.get(b.block_address) ?? []), b.id]);
  const badRes: string[] = [];
  for (const s of r.specifications) {
    const a = s.address_resolution;
    if (!a || (a.status !== "RESOLVED_BLOCK" && a.status !== "WIRED_INPUT") || a.target_block == null) continue;
    const t = byAddr.get(a.target_block);
    if (!t || t.length !== 1) badRes.push(`${s.id} -> ${a.target_block}`);
    else if (a.target_function_code != null && blockById.get(t[0])!.function_code !== a.target_function_code) badRes.push(`${s.id}: FC mismatch`);
  }
  add("address_targets", "Resolved block addresses name exactly one block with the stated function code", badRes, `${r.specifications.filter((s) => s.address_resolution).length} block-address specs`);

  // 8. connections are traceable
  const badConn = r.connections.filter((c) => !c.source_entity_ids.length || (c.status !== "UNRESOLVED" && (c.source_block == null || c.target_block == null))).map((c) => c.id);
  add("connections_traceable", "Every connection names its source entities; non-UNRESOLVED connections name both blocks", badConn, `${r.connections.length} connections`);

  // 9. every block and spec has a source location
  const noSrc = [...r.blocks.filter((b) => !b.source.entity_ids.length && b.drawn).map((b) => b.id), ...r.specifications.filter((s) => s.status === "EXTRACTED" && s.source.byte_offset == null).map((s) => s.id)];
  add("traceability", "Every block names its source entities and every extracted spec its byte offset", noSrc, "");

  // 10. unknown codes are reported
  const unknownBlocks = r.blocks.filter((b) => b.function_code != null && !getFunctionCode(b.function_code));
  const reported = new Set(r.unknown_function_codes.map((u) => u.function_code));
  add("unknown_codes_reported", "Function codes with no manual schema are reported", unknownBlocks.filter((b) => !reported.has(b.function_code!)).map((b) => b.id), `${reported.size} unknown code(s)`);

  // 11. layout (no overlap / no clipping)
  for (const l of opts.layout ?? []) {
    add(`no_overlap_${l.mode}`, `No overlapping annotation text (${l.mode} PDF)`, l.overlaps.map((o) => `p.${o.page}: '${o.a}' / '${o.b}'`), `${l.pages} pages`);
    add(`no_clipping_${l.mode}`, `No clipped annotation text (${l.mode} PDF)`, l.clipped.map((c) => `p.${c.page}: '${c.text.slice(0, 50)}'`), `${l.pages} pages`);
    if (l.mode === "marked") add("callouts_clear_of_lines", "No callout text crosses source line work (marked PDF)", l.callouts_over_lines.map((c) => `p.${c.page}: '${c.text}'`), `${l.callouts_placed} callouts, ${l.callouts_frame_only.length} frame-only`);
  }

  // 12. determinism
  if (opts.determinism) {
    const { first, second } = opts.determinism;
    add("determinism", "Two runs produce byte-identical decoded output", first === second ? [] : [`${first} != ${second}`], first);
  }

  const oracle: Record<string, unknown> = {};
  if (opts.specReport) oracle.vendor_spec_report = compareSpecReport(r, opts.specReport);
  if (opts.plot) oracle.vendor_plot = comparePlot(r, opts.plot);
  if (opts.verifyReport) oracle.vendor_verify_report = compareVerifyReport(r, opts.verifyReport);

  return { module: r.module.module, passed: checks.every((c) => c.pass), checks, oracle };
}

/** Agreement with a vendor FC spec report (`*.LIS`). */
function compareSpecReport(r: ExtractionResult, rep: VendorSpecReport) {
  let blocks = 0, fcAgree = 0, specs = 0, equal = 0;
  const differ: string[] = [];
  const specById = new Map(r.specifications.map((s) => [s.id, s]));
  for (const b of r.blocks) {
    const v = rep.blocks.get(b.block_address);
    if (!v || b.function_code == null) continue;
    blocks++;
    if (v.fc !== b.function_code) {
      differ.push(`${b.id}: FC ${b.function_code} vs report ${v.fc}`);
      continue;
    }
    fcAgree++;
    for (const id of b.spec_ids) {
      const s = specById.get(id)!;
      const pv = v.specs.get(s.spec_number);
      if (pv == null || s.raw_value_text == null) continue;
      specs++;
      if (pv === s.raw_value_text || Number(pv) === s.normalized_value) equal++;
      else differ.push(`${s.id}: CAD ${s.raw_value_text} vs report ${pv}`);
    }
  }
  const reportOnly = [...rep.blocks.keys()].filter((a) => !r.blocks.some((b) => b.block_address === a));
  return {
    source: rep.source,
    blocks_compared: blocks,
    function_code_agreement: fcAgree,
    specs_compared: specs,
    specs_equal: equal,
    specs_differ: specs - equal,
    agreement: specs ? Number((equal / specs).toFixed(4)) : null,
    report_only_blocks: reportOnly,
    differences: cap(differ, 200),
  };
}

/**
 * Maps plot text coordinates to paper coordinates (px right, py down).
 * Text lying outside the page height means the content is in rotated
 * (portrait) user space; the title-block stamp (drawing path or stem) marks
 * the bottom-right corner, which fixes the sign of each paper axis.
 */
function paperFrame(page: VendorPlotText["pages"][number], anchor: string) {
  const xs = page.items.map((i) => i.x), ys = page.items.map((i) => i.y);
  const midX = (Math.min(...xs) + Math.max(...xs)) / 2, midY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const st = page.items.find((i) => i.s === anchor);
  const rotated = Math.max(...ys) > page.height + 1;
  if (rotated) {
    const sx = !st || st.x > midX ? 1 : -1, sy = !st || st.y > midY ? 1 : -1;
    return { name: `rotated(down=${sx > 0 ? "+" : "-"}x,right=${sy > 0 ? "+" : "-"}y)`, map: (x: number, y: number) => ({ px: sy * y, py: sx * x }) };
  }
  const sx = !st || st.x > midX ? 1 : -1, sy = !st || st.y < midY ? 1 : -1;
  return { name: `upright(right=${sx > 0 ? "+" : "-"}x,down=${sy > 0 ? "-" : "+"}y)`, map: (x: number, y: number) => ({ px: sx * x, py: -sy * y }) };
}

/**
 * Agreement with the vendor plot text: per sheet (matched by the drawing path
 * or the 7-digit stem the plotter stamps), whether each block's "(FC)" and
 * block address are printed, and whether the S labels printed around the
 * block equal the established pin labels, in the same top-to-bottom order.
 */
function comparePlot(r: ExtractionResult, plot: VendorPlotText) {
  const pageOfKey = new Map<string, { page: number; anchor: string }>();
  for (const p of plot.pages) {
    for (const it of p.items) {
      const s = it.s.trim();
      const file = /([^\\/]+\.CAD)$/i.exec(s);
      if (file && !pageOfKey.has(file[1].toUpperCase())) pageOfKey.set(file[1].toUpperCase(), { page: p.page, anchor: it.s });
      if (/^\d{7}$/.test(s) && !pageOfKey.has(s)) pageOfKey.set(s, { page: p.page, anchor: it.s });
    }
  }
  let sheetsMatched = 0, blocksChecked = 0, fcFound = 0, addrFound = 0, labelBlocks = 0, labelSetEqual = 0, labelOrderEqual = 0;
  const missing: string[] = [];
  const labelDiff: string[] = [];
  const labelOrderConflicts: string[] = [];
  const frames: Record<string, number> = {};
  for (const sheet of r.sheets) {
    const hit = pageOfKey.get(sheet.file.toUpperCase()) ?? pageOfKey.get(sheet.file.replace(/\.CAD$/i, "").slice(0, 7));
    if (!hit) continue;
    const pn = hit.page;
    sheetsMatched++;
    const page = plot.pages.find((p) => p.page === pn)!;
    const frame = paperFrame(page, hit.anchor);
    frames[frame.name] = (frames[frame.name] ?? 0) + 1;
    const items = page.items.map((i) => ({ s: i.s.trim(), ...frame.map(i.x, i.y) })).filter((i) => i.s);
    const fcTokens = items.filter((i) => /^\(\d+\)$/.test(i.s));
    // Vendor block = "(fc)" token with the block address on a following line,
    // left-aligned with it; multi-output symbols print an output address in between.
    const vblocks = fcTokens.map((f) => {
      const addrs = items.filter((i) => /^\d+$/.test(i.s) && Math.abs(i.px - f.px) < 1.5 && i.py > f.py && i.py - f.py < 16).map((i) => Number(i.s));
      return { fc: Number(f.s.slice(1, -1)), addrs, px: f.px, py: f.py, labels: [] as Array<{ s: string; py: number }> };
    });
    for (const l of items.filter((i) => /^S\d+$/.test(i.s))) {
      let best: (typeof vblocks)[number] | null = null, bd = Infinity;
      for (const vb of vblocks) {
        const d = Math.hypot(vb.px - l.px, vb.py - l.py);
        if (d < bd) { bd = d; best = vb; }
      }
      if (best && bd < 80) best.labels.push({ s: l.s, py: l.py });
    }
    for (const id of sheet.block_ids) {
      const b = r.blocks.find((x) => x.id === id)!;
      if (b.function_code == null || !b.drawn) continue;
      blocksChecked++;
      const vb = vblocks.find((v) => v.addrs.includes(b.block_address) && v.fc === b.function_code);
      const fcHit = fcTokens.some((f) => Number(f.s.slice(1, -1)) === b.function_code);
      if (fcHit) fcFound++;
      if (vb) addrFound++;
      else missing.push(`${b.id} FC ${b.function_code}: no '(${b.function_code})' + '${b.block_address}' pair on plot page ${pn}`);
      const ours = b.pins.filter((p) => p.side === "left" && p.label).map((p) => p.label!);
      if (vb && ours.length) {
        labelBlocks++;
        const theirs = vb.labels.slice().sort((a, c) => a.py - c.py).map((l) => l.s);
        const setEq = ours.length === theirs.length && ours.every((x) => theirs.includes(x));
        if (setEq) labelSetEqual++;
        if (setEq && ours.join(",") === theirs.join(",")) labelOrderEqual++;
        else labelDiff.push(`${b.id}: pins ${ours.join(",")} vs plot ${theirs.join(",") || "(none)"}`);
        const once = theirs.filter((x) => theirs.indexOf(x) === theirs.lastIndexOf(x));
        const shared = ours.filter((x) => once.includes(x));
        if (shared.length > 1 && shared.join(",") !== once.filter((x) => shared.includes(x)).join(",")) labelOrderConflicts.push(`${b.id}: pins ${ours.join(",")} vs plot ${theirs.join(",")}`);
      }
    }
  }
  return {
    source: plot.source,
    sheets_matched: sheetsMatched,
    sheets_total: r.sheets.length,
    page_frames: frames,
    blocks_checked: blocksChecked,
    function_code_token_found: fcFound,
    fc_and_address_pair_found: addrFound,
    pin_label_blocks: labelBlocks,
    pin_label_set_equal: labelSetEqual,
    pin_label_order_equal: labelOrderEqual,
    pin_label_order_conflicts: labelOrderConflicts.length,
    pin_label_order_conflict_items: cap(labelOrderConflicts, 100),
    missing: cap(missing, 100),
    pin_label_differences: cap(labelDiff, 100),
  };
}

export interface VendorVerifyReport {
  source: string;
  entries: Array<{
    block: number;
    fc: number | null;
    messages: string[];
    src_fc: number | null;
    ref_fc: number | null;
    specs: Array<{ spec: number; description: string; src: string | null; ref: string | null }>;
  }>;
}

/** Parse a vendor Verify/Update report (`*.VFY`): CAD source (SRC) vs configuration reference (REF). */
export function parseVerifyReport(text: string, source: string): VendorVerifyReport {
  const entries: VendorVerifyReport["entries"] = [];
  let cur: VendorVerifyReport["entries"][number] | null = null;
  let spec: VendorVerifyReport["entries"][number]["specs"][number] | null = null;
  for (const line of text.split(/\r?\n/)) {
    const b = /^Block Number\s+(\d+)(?:\s+FC:\s*(\d+))?/.exec(line);
    if (b) {
      cur = { block: +b[1], fc: b[2] ? +b[2] : null, messages: [], src_fc: null, ref_fc: null, specs: [] };
      entries.push(cur);
      spec = null;
      continue;
    }
    if (!cur || /^(Drawing File|=+|\S)/.test(line)) {
      if (/^\S/.test(line)) cur = null;
      continue;
    }
    const fcLine = /^\s+(SRC|REF):\s+Blk\s+\d+\s+FC:\s*(\d+)/.exec(line);
    if (fcLine) {
      if (fcLine[1] === "SRC") cur.src_fc = +fcLine[2];
      else cur.ref_fc = +fcLine[2];
      continue;
    }
    const s = /^\s+S(\d+)\s+(.*\S)?\s*$/.exec(line);
    if (s) {
      spec = { spec: +s[1], description: s[2] ?? "", src: null, ref: null };
      cur.specs.push(spec);
      continue;
    }
    const v = /^\s+(SRC|REF):\s*(.*?)\s*$/.exec(line);
    if (v && spec) {
      if (v[1] === "SRC") spec.src = v[2];
      else spec.ref = v[2];
      continue;
    }
    if (line.trim()) cur.messages.push(line.trim());
  }
  return { source, entries };
}

/** Agreement with the SRC (CAD) side of a Verify/Update report. */
function compareVerifyReport(r: ExtractionResult, rep: VendorVerifyReport) {
  const byAddr = new Map<number, ExtractionResult["blocks"]>();
  for (const b of r.blocks) byAddr.set(b.block_address, [...(byAddr.get(b.block_address) ?? []), b]);
  const specById = new Map(r.specifications.map((s) => [s.id, s]));
  let fcCompared = 0, fcEqual = 0, specsCompared = 0, specsEqual = 0, presence = 0, presenceOk = 0;
  const differ: string[] = [];
  for (const e of rep.entries) {
    const ours = byAddr.get(e.block) ?? [];
    const notInSource = e.messages.some((m) => /exists in reference but not in source/i.test(m));
    const onlyInSource = e.messages.some((m) => /exists in source but not in reference/i.test(m));
    if (notInSource || onlyInSource) {
      presence++;
      if (notInSource ? ours.length === 0 : ours.length > 0) presenceOk++;
      else differ.push(`blk ${e.block}: report says ${notInSource ? "not in" : "in"} source; extraction has ${ours.length} block(s)`);
    }
    const srcFc = e.src_fc ?? (notInSource ? null : e.fc);
    if (srcFc != null && ours.length) {
      fcCompared++;
      if (ours.some((b) => b.function_code === srcFc)) fcEqual++;
      else differ.push(`blk ${e.block}: FC ${ours.map((b) => b.function_code).join("/")} vs report SRC ${srcFc}`);
    }
    for (const s of e.specs) {
      if (s.src == null || !ours.length) continue;
      const mine = ours.map((b) => specById.get(`${b.id}.S${s.spec}`)).find(Boolean);
      if (!mine) continue;
      specsCompared++;
      const n = Number(s.src);
      if (s.src === mine.raw_value_text || (Number.isFinite(n) && mine.normalized_value != null && Math.abs(n - mine.normalized_value) <= 1e-5 * Math.max(1, Math.abs(n)))) specsEqual++;
      else differ.push(`${mine.id}: CAD ${mine.raw_value_text} vs report SRC ${s.src}`);
    }
  }
  return {
    source: rep.source,
    entries: rep.entries.length,
    presence_compared: presence,
    presence_agree: presenceOk,
    function_codes_compared: fcCompared,
    function_codes_equal: fcEqual,
    specs_compared: specsCompared,
    specs_equal: specsEqual,
    differences: cap(differ, 200),
  };
}

/** Parse a vendor FC spec report (`*.LIS`). */
export function parseSpecReport(text: string, source: string): VendorSpecReport {
  const blocks: VendorSpecReport["blocks"] = new Map();
  let cur: { fc: number; specs: Map<number, string> } | null = null;
  for (const line of text.split(/\r?\n/)) {
    const b = /^\s*Block\s+(\d+):\s+FC\s+(\d+)\s+rev\s+\d+:/.exec(line);
    if (b) {
      cur = { fc: +b[2], specs: new Map() };
      blocks.set(+b[1], cur);
      continue;
    }
    const s = /^\s+S(\d+)\s+(?:TO\s+)?[A-Z]\d?\s+(\S+)/.exec(line);
    if (s && cur) cur.specs.set(+s[1], s[2]);
  }
  return { blocks, source };
}
