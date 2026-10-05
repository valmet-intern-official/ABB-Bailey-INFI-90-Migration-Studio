/**
 * Deterministic parser for the ABB "Function Code Application Manual" text
 * layer. Input is the positioned text of every page (see ManualText); output
 * is one FunctionCodeSchema per function-code section.
 *
 * Layout facts the parser relies on, all read from the manual itself:
 *  - A section starts on a page carrying a `Function Code N` heading (>= 12pt)
 *    and continues while the page footer reads `N - k`.
 *  - Specification tables start at a header row `Spec Tune Default Type Range
 *    Description`; columns are taken from that row on every page, because odd
 *    and even pages are offset horizontally.
 *  - A table row starts with an `Sn` token in the Spec column; lines without
 *    one continue the previous row. Continuation pages repeat the header row.
 *  - Table notes are set in a smaller face (< 8.5pt) after a `NOTES` line.
 *  - Symbol drawings are small (< 8pt) text left of the body column.
 * Anything the parser cannot place is reported in `diagnostics`, never dropped
 * silently.
 */
import type {
  FixedBlock,
  FunctionCodeSchema,
  ManualEnumeration,
  ManualKnowledgeBase,
  ManualNote,
  ManualOutput,
  ManualSpecification,
  ManualSymbol,
  ManualText,
  TextItem,
  TextPage,
} from "./types";

interface Line {
  page: number;
  y: number;
  items: TextItem[];
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const squash = (s: string) => s.replace(/\s+/g, "");
const LINE_TOL = 1.2;
const FOOTER_Y = 110;
const SPEC_LABEL = /^S\s?(\d+)(?:\s*(?:-|–|through|thru|to)\s*S\s?(\d+))?$/i;
const ENUM_LINE = /^(-?[0-9X]+(?:\.[0-9]+)?)\s*=\s*(.+)$/;

function linesOf(page: TextPage): Line[] {
  const items = page.items
    .filter((i) => i.s.trim().length > 0)
    .slice()
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const it of items) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= LINE_TOL) last.items.push(it);
    else lines.push({ page: page.page, y: it.y, items: [it] });
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines;
}

function footerOf(page: TextPage): { major: number; minor: number } | null {
  for (const it of page.items) {
    if (it.y >= FOOTER_Y) continue;
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(clean(it.s));
    if (m) return { major: Number(m[1]), minor: Number(m[2]) };
  }
  return null;
}

function sectionHeading(page: TextPage): number | null {
  for (const it of page.items) {
    const m = /^Function Code (\d+)$/.exec(clean(it.s));
    if (m && it.y > 600 && it.h >= 12) return Number(m[1]);
  }
  return null;
}

/** Join printed lines: drop soft hyphens, keep enumeration lines distinct. */
export function normaliseLines(lines: string[]): string {
  let out = "";
  for (const raw of lines) {
    const line = clean(raw);
    if (!line) continue;
    if (!out) {
      out = line;
    } else if (/[a-z]-$/.test(out) && /^[a-z]/.test(line)) {
      out = out.slice(0, -1) + line;
    } else if (ENUM_LINE.test(line)) {
      out += `; ${line}`;
    } else {
      out += ` ${line}`;
    }
  }
  return out;
}

function enumerationsOf(lines: string[]): ManualEnumeration[] {
  const out: ManualEnumeration[] = [];
  for (const raw of lines) {
    const m = ENUM_LINE.exec(clean(raw));
    if (m) out.push({ value: m[1], meaning: m[2] });
  }
  return out;
}

function lineText(items: TextItem[]): string {
  return clean(items.map((i) => i.s).join(" "));
}

interface SpecHeader {
  spec: number;
  tune: number;
  def: number;
  type: number;
  range: number;
}

function specHeaderOf(line: Line): SpecHeader | null {
  const at = (t: string) => line.items.find((i) => clean(i.s) === t)?.x;
  const spec = at("Spec");
  const tune = at("Tune");
  const def = at("Default");
  const type = at("Type");
  const range = at("Range");
  const desc = at("Description");
  if ([spec, tune, def, type, range, desc].some((v) => v == null)) return null;
  return { spec: spec!, tune: tune!, def: def!, type: type!, range: range! };
}

interface OutHeader {
  blk: number;
  type: number;
}

function outHeaderOf(line: Line): OutHeader | null {
  const texts = line.items.map((i) => clean(i.s));
  if (texts.includes("Spec")) return null;
  const blk = line.items.find((i) => clean(i.s) === "Blk")?.x;
  const type = line.items.find((i) => clean(i.s) === "Type")?.x;
  if (blk == null || type == null || !texts.includes("Description")) return null;
  return { blk, type };
}

interface RowDraft {
  labels: string;
  from: number;
  to: number;
  tune: string[];
  def: string[];
  type: string[];
  range: string[];
  desc: string[];
  page: number;
  /** Superscript note markers printed beside the row. */
  refs: string[];
  elidedBetween?: string;
}

function splitSpecCells(items: TextItem[], H: SpecHeader) {
  const cells = { spec: [] as string[], tune: [] as string[], def: [] as string[], type: [] as string[], range: [] as string[], desc: [] as string[] };
  for (const it of items) {
    const t = clean(it.s);
    if (!t) continue;
    if (it.x < H.tune - 3) cells.spec.push(t);
    else if (it.x < H.def - 6) cells.tune.push(t);
    else if (it.x < H.type - 2) cells.def.push(t);
    // Type is a single letter set just right of its header; wide centred
    // ranges start left of the Range header and must not fall into Type.
    else if (it.x < H.type + 14) cells.type.push(t);
    else if (it.x < H.range + 20) cells.range.push(t);
    else cells.desc.push(t);
  }
  return cells;
}

/** Output table block cell class: N / N+k, a fixed address or range, or a spec reference. */
function outBlkClass(blk: string): "N" | "NUM" | "S" | null {
  if (/^N(\s*\+\s*\d+)?$/.test(blk)) return "N";
  if (/^(\d{1,2}(,\d{3})?|\d+\s*-\s*\d+)$/.test(blk)) return "NUM";
  if (/^<?S\d+>?$/.test(blk)) return "S";
  return null;
}

const CONT_MARK = /^\((?:cont\.?|continued)\)$/i;

function finishRow(r: RowDraft, diag: string[], fc: number): ManualSpecification[] {
  const description_lines = r.desc.slice();
  const description = normaliseLines(description_lines);
  const tune_raw = r.tune.join(" ");
  // A digit after the tune letter is a superscript reference to a table note.
  const tm = /^([YN])(?:\s*(\d+))?$/.exec(tune_raw);
  const note_refs = [...new Set([...r.refs, ...(tm?.[2] ? [tm[2]] : [])])];
  let type = r.type.join(" ");
  let range = r.range.join(" ");
  // Most rows print a single type letter; a few print a word such as INT, kept verbatim.
  if (type && !/^[A-Za-z]+$/.test(type)) {
    const split = /^([A-Za-z]+)\s+(.+)$/.exec(type);
    if (split) {
      type = split[1];
      range = clean(`${split[2]} ${range}`);
    } else {
      range = clean(`${type} ${range}`);
      type = "";
    }
  }
  const base = {
    tune: tm ? tm[1] === "Y" : null,
    tune_raw,
    ...(note_refs.length ? { note_refs } : {}),
    default: r.def.join(" "),
    type,
    range,
    description,
    description_lines,
    enumerations: enumerationsOf(description_lines),
    is_block_address: /\bblock address\b|\bblk adr\b/i.test(description),
    manual_page: r.page,
  };
  if (base.tune === null) diag.push(`FC${fc} ${r.labels}: tune flag '${tune_raw}' is not Y/N`);
  if (!base.type) diag.push(`FC${fc} ${r.labels}: no type letter printed (type/range text kept as range '${base.range}')`);
  const out: ManualSpecification[] = [];
  for (let n = r.from; n <= r.to; n++) {
    out.push({
      number: n,
      label: `S${n}`,
      ...base,
      ...(r.from !== r.to && !r.elidedBetween ? { range_row: r.labels } : {}),
      ...(r.elidedBetween ? { elided_between: r.elidedBetween } : {}),
    });
  }
  return out;
}

function parseSection(fc: number, pages: TextPage[]): FunctionCodeSchema {
  const diag: string[] = [];
  const first = pages[0];
  const headingItem = first.items.find((i) => clean(i.s) === `Function Code ${fc}`)!;

  const name = clean(
    first.items
      .filter((i) => i.h >= 18 && i.y > 600)
      .sort((a, b) => b.y - a.y || a.x - b.x)
      .map((i) => i.s)
      .join(" ")
  );
  if (!name) diag.push(`FC${fc}: section name not found`);

  const allLines: Line[] = [];
  for (const p of pages) {
    for (const l of linesOf(p)) {
      if (l.y < FOOTER_Y) continue;
      allLines.push(l);
    }
  }

  // ---- description + symbol (start page, above the first table heading)
  const body = (i: TextItem) => i.h >= 9.4 && i.h <= 10.6;
  const startBody = first.items.filter((i) => body(i) && i.y < headingItem.y);
  const descX = startBody.length ? Math.min(...startBody.map((i) => i.x)) : 200;

  const description_lines: string[] = [];
  const notes: ManualNote[] = [];
  const outputs: ManualOutput[] = [];
  const specRows: RowDraft[] = [];

  type Mode = "desc" | "gennotes" | "none" | "out" | "outnotes" | "spec" | "spec-pending" | "specnotes";
  let mode: Mode = "desc";
  let H: SpecHeader | null = null;
  let O: OutHeader | null = null;
  let row: RowDraft | null = null;
  let out: ManualOutput | null = null;
  let note: ManualNote | null = null;
  let page = first.page;
  let tableTopY: number | null = null;
  const pendingRefs: string[] = [];
  let elisionPage: number | null = null;

  const pushNote = (label: string, text: string, p: number, context: ManualNote["context"]) => {
    note = { label, text, manual_page: p, context };
    notes.push(note);
  };

  for (const line of allLines) {
    if (line.page !== page) {
      page = line.page;
      if (mode === "spec" || mode === "specnotes") mode = "spec-pending";
      else if (mode === "out") mode = "none";
      note = null;
    }
    if (line.page === first.page && line.y >= headingItem.y - 0.5) continue;

    const sh = specHeaderOf(line);
    if (sh) {
      H = sh;
      mode = "spec";
      if (tableTopY == null && line.page === first.page) tableTopY = line.y;
      continue;
    }
    const oh = outHeaderOf(line);
    if (oh && (mode === "desc" || mode === "gennotes" || mode === "none")) {
      O = oh;
      mode = "out";
      out = null;
      if (tableTopY == null && line.page === first.page) tableTopY = line.y;
      continue;
    }

    const text = lineText(line.items);
    if (mode === "desc" || mode === "gennotes") {
      if (/^(Outputs|Specifications)$/.test(text) || line.items.some((i) => /^(Outputs|Specifications)$/.test(clean(i.s)) && i.h >= 8.5 && i.h < 12)) {
        mode = "none";
        continue;
      }
      const its = line.items.filter(body);
      if (!its.length) continue;
      const t = lineText(its);
      if (/^NOTES?\s*:?$/.test(t)) {
        mode = "gennotes";
        continue;
      }
      if (mode === "gennotes") {
        const m = /^(\d+\.)\s*(.*)$/.exec(t);
        if (m) pushNote(m[1], m[2], line.page, "general");
        else if (note) (note as ManualNote).text = normaliseLines([(note as ManualNote).text, t]);
        else pushNote("NOTE:", t.replace(/^NOTE:\s*/, ""), line.page, "general");
      } else {
        description_lines.push(t);
      }
      continue;
    }

    if (mode === "out" && O) {
      const its = line.items.filter((i) => i.x >= O!.blk - 10);
      if (!its.length) continue;
      const f = its[0];
      if (f.h >= 11 || (f.x < O.blk - 10)) {
        mode = "none";
        continue;
      }
      if (/^NOTES?\b/i.test(clean(f.s))) {
        mode = "outnotes";
        note = null;
        const rest = clean(lineText(its).replace(/^NOTES?\s*:?\s*/i, ""));
        if (rest) {
          const nm = /^(\d+\.)\s*(.*)$/.exec(rest);
          pushNote(nm ? nm[1] : "NOTE:", nm ? nm[2] : rest, line.page, "outputs");
        }
        continue;
      }
      if (f.x < O.type - 2) {
        const blk = its.filter((i) => i.x < O!.type - 2).map((i) => clean(i.s));
        const type = its.filter((i) => i.x >= O!.type - 2 && i.x < O!.type + 15).map((i) => clean(i.s));
        const cls = outBlkClass(blk.join(" "));
        const firstCls = outputs.length ? outBlkClass(outputs[0].blk) : null;
        if (!outputs.length && !type.length) continue;
        if (!cls || !type.length || (firstCls && cls !== firstCls)) {
          if (!cls) diag.push(`FC${fc}: output table row with unrecognised block cell '${blk.join(" ")}' on p.${line.page}; table ended`);
          mode = "none";
          continue;
        }
        const desc = its.filter((i) => i.x >= O!.type + 15).map((i) => clean(i.s));
        out = { blk: blk.join(" "), type: type.join(" "), description: "", description_lines: desc.length ? [desc.join(" ")] : [], manual_page: line.page };
        outputs.push(out);
      } else if (out) {
        out.description_lines.push(lineText(its));
      } else {
        mode = "none";
      }
      continue;
    }

    if (mode === "spec-pending") {
      mode = "none";
      continue;
    }

    if (mode === "spec" && H) {
      const its = line.items.filter((i) => i.x >= H!.spec - 12);
      if (!its.length) continue;
      const f = its[0];
      const t0 = clean(f.s);
      // Superscript note markers sit on their own line just above a row.
      if (its.every((i) => i.h < 8 && /^\d+(,\d+)*$/.test(clean(i.s)))) {
        pendingRefs.push(...its.flatMap((i) => clean(i.s).split(",")));
        continue;
      }
      if (row && its.every((i) => /^[•·.]+$/.test(clean(i.s)) || !clean(i.s))) {
        elisionPage = line.page;
        continue;
      }
      if (f.x < H.tune - 3 && CONT_MARK.test(t0) && row) {
        const cells = splitSpecCells(its.slice(1), H);
        if (cells.desc.length) row.desc.push(cells.desc.join(" "));
        continue;
      }
      if (f.x < H.tune - 3) {
        const cells = splitSpecCells(its, H);
        let label = cells.spec.join(" ");
        const last = specRows[specRows.length - 1];
        if (/^\d+$/.test(label) && last && Number(label) === last.to + 1 && cells.type.length && cells.def.length) {
          // The text layer lost the 'S' glyph but printed the full row.
          diag.push(`FC${fc}: row label printed as '${label}' on p.${line.page} (no 'S' in text layer); taken as S${label} because it follows ${last.labels} and carries all columns`);
          label = `S${label}`;
        }
        const m = SPEC_LABEL.exec(label);
        if (m) {
          const from = Number(m[1]);
          const to = m[2] ? Number(m[2]) : from;
          if (to < from) diag.push(`FC${fc}: descending spec range '${label}' on p.${line.page}`);
          if (row && squash(row.labels) === squash(label)) {
            // Continuation pages re-print the open row's label and cells.
            const again = (a: string[], b: string[]) => b.length === 0 || a.join(" ") === b.join(" ");
            if (!again(row.def, cells.def) || !again(row.type, cells.type) || !again(row.tune, cells.tune)) {
              diag.push(`FC${fc} ${label}: re-printed row on p.${line.page} differs from p.${row.page}`);
            }
            if (cells.desc.length) row.desc.push(cells.desc.join(" "));
            continue;
          }
          const next: RowDraft = { labels: label, from, to: Math.max(from, to), tune: cells.tune, def: cells.def, type: cells.type, range: cells.range, desc: cells.desc, page: line.page, refs: pendingRefs.splice(0) };
          if (elisionPage != null && row && from > row.to + 1) {
            const key = (r: RowDraft) => JSON.stringify([r.tune, r.def, r.type, r.range, r.desc]);
            const between = `${row.labels} … ${label}`;
            if (key(row) === key(next)) {
              specRows.push({ ...row, labels: `S${row.to + 1}-S${from - 1}`, from: row.to + 1, to: from - 1, page: elisionPage, refs: row.refs.slice(), elidedBetween: between });
              diag.push(`FC${fc}: S${row.to + 1}-S${from - 1} elided in the manual on p.${elisionPage} between identical rows ${between}; filled with those rows' cells`);
            } else {
              diag.push(`FC${fc}: S${row.to + 1}-S${from - 1} elided on p.${elisionPage} between differing rows ${between}; not filled`);
            }
          }
          elisionPage = null;
          row = next;
          specRows.push(row);
          continue;
        }
        if (/^NOTES?\b/i.test(t0)) {
          mode = "specnotes";
          note = null;
          const rest = clean(text.replace(/^NOTES?\s*:?\s*/i, ""));
          if (rest) {
            const nm = /^(\d+\.)\s*(.*)$/.exec(rest);
            pushNote(nm ? nm[1] : "NOTE:", nm ? nm[2] : rest, line.page, "specifications");
          }
          continue;
        }
        mode = "none";
        continue;
      }
      if (!row) {
        diag.push(`FC${fc}: text before first spec row on p.${line.page}: '${text.slice(0, 60)}'`);
        continue;
      }
      const cells = splitSpecCells(its, H);
      if (cells.tune.length) row.tune.push(...cells.tune);
      if (cells.def.length) row.def.push(...cells.def);
      if (cells.type.length) row.type.push(...cells.type);
      if (cells.range.length) row.range.push(...cells.range);
      if (cells.desc.length) row.desc.push(cells.desc.join(" "));
      continue;
    }

    if (mode === "outnotes") {
      if (line.items.some((i) => i.h >= 8.5)) {
        mode = "none";
        continue;
      }
      const m = /^(\d+\.)\s*(.*)$/.exec(text);
      if (m) pushNote(m[1], m[2], line.page, "outputs");
      else if (note) (note as ManualNote).text = normaliseLines([(note as ManualNote).text, text]);
      else pushNote("NOTE:", text, line.page, "outputs");
      continue;
    }

    if (mode === "specnotes") {
      if (line.items.some((i) => i.h >= 8.5)) {
        mode = "none";
        continue;
      }
      const m = /^(\d+\.)\s*(.*)$/.exec(text);
      if (m) pushNote(m[1], m[2], line.page, "specifications");
      else if (note) (note as ManualNote).text = normaliseLines([(note as ManualNote).text, text]);
      else pushNote("NOTE:", text, line.page, "specifications");
      continue;
    }
  }

  for (const o of outputs) o.description = normaliseLines(o.description_lines);

  // ---- symbol: small text left of the body column, down to the first
  // left-margin heading. Tall symbols (e.g. FC 147, S1..S36) run past the top
  // of the outputs table, which sits in the body column, so the table top is
  // not a symbol boundary.
  const symTop = headingItem.y;
  const symText = (i: TextItem) => i.h < 8 && i.y < symTop && i.x < descX - 4 && clean(i.s);
  const aboveTable = first.items.filter((i) => symText(i) && i.y > (tableTopY ?? 0));
  let symBottom = tableTopY ?? 0;
  if (aboveTable.length && tableTopY != null) {
    const lowest = Math.min(...aboveTable.map((i) => i.y));
    const below = first.items.filter((i) => i.h >= 8 && i.y < lowest && i.x < descX - 4 && clean(i.s));
    symBottom = below.length ? Math.max(...below.map((i) => i.y)) : tableTopY;
  }
  const symItems = first.items.filter((i) => symText(i) && i.y > symBottom).sort((a, b) => b.y - a.y || a.x - b.x);
  const inputs = symItems.filter((i) => /^S\d+$/.test(squash(i.s))).map((i) => squash(i.s));
  const outputsPins = symItems.filter((i) => /^N(\+\d+)?$/.test(squash(i.s))).map((i) => squash(i.s));
  const titleItem = symItems.find(
    (i) => !/^S\d+$/.test(squash(i.s)) && !/^N(\+\d+)?$/.test(squash(i.s)) && !/^\(\d+\)$/.test(squash(i.s)) && squash(i.s) !== "N/A"
  );
  const symbol: ManualSymbol = {
    title_raw: titleItem ? clean(titleItem.s) : null,
    title: titleItem ? squash(titleItem.s) : null,
    inputs,
    outputs: outputsPins,
    items: symItems.map((i) => ({ x: i.x, y: i.y, s: clean(i.s) })),
  };
  const fcInSymbol = symItems.find((i) => /^\(\d+\)$/.test(squash(i.s)));
  if (fcInSymbol && squash(fcInSymbol.s) !== `(${fc})`) {
    diag.push(`FC${fc}: symbol shows ${squash(fcInSymbol.s)}`);
  }

  // ---- specifications
  const specifications: ManualSpecification[] = [];
  for (const r of specRows) specifications.push(...finishRow(r, diag, fc));
  const seen = new Map<number, ManualSpecification>();
  for (const s of specifications) {
    const prev = seen.get(s.number);
    if (prev) {
      const same = prev.type === s.type && prev.default === s.default && prev.description === s.description;
      diag.push(`FC${fc} S${s.number}: printed more than once (p.${prev.manual_page}, p.${s.manual_page})${same ? " identically" : " with different content"}`);
    } else {
      seen.set(s.number, s);
    }
  }
  const unique = [...seen.values()].sort((a, b) => a.number - b.number);
  const max = unique.length ? unique[unique.length - 1].number : 0;
  const missing: number[] = [];
  for (let n = 1; n <= max; n++) if (!seen.has(n)) missing.push(n);
  if (missing.length) diag.push(`FC${fc}: specification numbering is non-contiguous; not printed: ${missing.map((n) => `S${n}`).join(", ")}`);
  if (!unique.length) diag.push(`FC${fc}: no specification table found`);

  return {
    function_code: fc,
    name,
    description: normaliseLines(description_lines),
    description_lines,
    symbol,
    outputs,
    specifications: unique,
    spec_count: unique.length,
    max_spec_number: max,
    notes,
    manual_page: first.page,
    manual_pages: pages.map((p) => p.page),
    manual_section: `Function Code ${fc}${name ? ` - ${name}` : ""}`,
    diagnostics: diag,
  };
}

/** Fixed block address table (Table "Block Addresses in a ... Controller"). */
function parseFixedBlocks(text: ManualText): ManualKnowledgeBase["fixed_blocks"] {
  const startIdx = text.pages.findIndex((p) =>
    p.items.some((i) => /^Table \d+\. Block Addresses in a .+Controller$/.test(clean(i.s)))
  );
  if (startIdx < 0) return null;
  const titleItem = text.pages[startIdx].items.find((i) => /^Table \d+\. Block Addresses in a /.test(clean(i.s)))!;
  const title = clean(titleItem.s);
  const tableNo = /^Table (\d+)\./.exec(title)![1];
  const blocks: FixedBlock[] = [];
  let currentFc: number | null = null;
  let last: FixedBlock | null = null;

  for (let pi = startIdx; pi < text.pages.length; pi++) {
    const p = text.pages[pi];
    const isTable = p.items.some((i) => new RegExp(`^Table ${tableNo}\\. Block Addresses`).test(clean(i.s)));
    if (!isTable) break;
    const addrHeader = p.items.find((i) => clean(i.s) === "Address");
    if (!addrHeader) break;
    const addrX = addrHeader.x;
    const lines = linesOf(p).filter((l) => l.y < addrHeader.y - 1 && l.y > FOOTER_Y);
    for (const l of lines) {
      if (l.items.some((i) => i.h >= 11)) break;
      const addr = l.items.find((i) => Math.abs(i.x - addrX) < 20 && /^\d+(\s*-\s*\d+)?$/.test(clean(i.s)));
      const code = l.items.find((i) => i.x < addrX - 60 && /^\d+$/.test(clean(i.s)));
      if (code) currentFc = Number(clean(code.s));
      const desc = l.items.filter((i) => i.x > addrX + 20).map((i) => clean(i.s));
      if (addr) {
        last = {
          block_address: clean(addr.s),
          description: desc.join(" "),
          function_code: currentFc,
          function_code_source: code ? "PRINTED" : "ROW_GROUP",
          manual_page: p.page,
        };
        blocks.push(last);
      } else if (last && desc.length) {
        last.description = normaliseLines([last.description, desc.join(" ")]);
      }
    }
  }
  const scope = /Block Addresses in an? (.+)$/.exec(title)?.[1] ?? title;
  return { table: title, scope, manual_page: text.pages[startIdx].page, blocks };
}

export function parseManual(text: ManualText): ManualKnowledgeBase {
  const diagnostics: string[] = [];
  const starts: Array<{ fc: number; index: number }> = [];
  text.pages.forEach((p, index) => {
    const fc = sectionHeading(p);
    if (fc != null) starts.push({ fc, index });
  });

  const function_codes: FunctionCodeSchema[] = [];
  for (let s = 0; s < starts.length; s++) {
    const { fc, index } = starts[s];
    const end = s + 1 < starts.length ? starts[s + 1].index : text.pages.length;
    const pages: TextPage[] = [];
    for (let i = index; i < end; i++) {
      const f = footerOf(text.pages[i]);
      if (!f || f.major !== fc) {
        if (i === index) diagnostics.push(`FC${fc}: start page ${text.pages[i].page} has footer ${f ? `${f.major} - ${f.minor}` : "none"}`);
        if (i > index) break;
      }
      pages.push(text.pages[i]);
    }
    if (function_codes.some((f) => f.function_code === fc)) {
      diagnostics.push(`FC${fc}: section heading appears more than once (p.${text.pages[index].page}); later section ignored`);
      continue;
    }
    function_codes.push(parseSection(fc, pages));
  }
  function_codes.sort((a, b) => a.function_code - b.function_code);

  const cover = text.pages[0]?.items.map((i) => clean(i.s)).filter(Boolean) ?? [];
  const docItem = text.pages.slice(0, 3).flatMap((p) => p.items).find((i) => /^WBPEEUI\w+$/.test(clean(i.s)));
  return {
    schema_version: 1,
    source: {
      document: docItem ? clean(docItem.s) : "",
      title: cover.join(" "),
      file: text.source,
      sha256: text.sha256,
      pages: text.numPages,
    },
    fixed_blocks: parseFixedBlocks(text),
    function_codes,
    diagnostics,
  };
}
