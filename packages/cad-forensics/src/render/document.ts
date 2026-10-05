/**
 * Engineering CAD document, rendered only from the scene graph:
 *   A  drawing pages - each sheet's source display list (all geometry and
 *      text, untouched) plus resolved annotations; vector, selectable text
 *   B  one detail section per function block: specifications, terminals,
 *      sub-blocks, captions, connections, IREF/OREF, source traceability
 *   C  micro-detail annex: coverage matrix, then every item per sheet
 * Every block, reference and connection is a link along the chain
 * drawing -> block -> spec -> target block / wire -> annex record.
 */
import type { PdfLink, PdfPage, ReconstructModuleResult, RenderItem as Item } from "@infi90/cad-engine";
import type { Entity, FunctionBlockNode, LogicConnectionNode, ReferenceNode, SceneGraph, SpecificationTerminal, SubBlock, Terminal, WireNode } from "../types";
import { ANNOTATION_LAYERS, annotateSheet, indexSheets, type AnnotationRecord } from "./annotate";
import { A4P_H, A4P_W, Flow, type FlowPage, type KeyLink } from "./layout";

export interface CoverageRow {
  category: string;
  parsed: number;
  linked: number;
  rendered_drawing: number;
  rendered_detail: number;
  listed_annex: number;
  not_rendered_anywhere: number;
  notes: string;
}

export interface EngineeringDocument {
  pages: PdfPage[];
  outline: Array<{ title: string; page: number }>;
  layers: Array<{ id: string; name: string }>;
  /** Drawing page display lists incl. annotations, by file (for SVG). */
  drawingItems: Map<string, Item[]>;
  annotations: AnnotationRecord[];
  annotationSkipped: Array<{ id: string; reason: string }>;
  coverage: CoverageRow[];
  notRendered: Array<{ category: string; id: string; reason: string }>;
  pageMap: { drawing: Array<{ file: string; page: number }>; detailStart: number; annexStart: number; total: number };
}

const fmt = (v: unknown): string => (v == null || v === "" ? "-" : String(v));
const xy = (p: [number, number] | null | undefined) => (p ? `(${p[0]},${p[1]})` : "-");
const LIBRARY_LIKE = new Set(["library_primitive", "grid"]);

export function buildDocument(scene: SceneGraph, reconstructed: ReconstructModuleResult): EngineeringDocument {
  const sheetIdx = indexSheets(scene);
  const byFileSheet = new Map(reconstructed.sheets.map((s) => [s.filename, s]));
  const blockById = new Map(scene.function_blocks.map((b) => [b.id, b]));
  const specById = new Map(scene.specifications.map((s) => [s.id, s]));
  const termById = new Map(scene.terminals.map((t) => [t.id, t]));
  const subById = new Map(scene.sub_blocks.map((s) => [s.id, s]));
  const wireById = new Map(scene.wires.map((w) => [w.id, w]));
  const termsOfBlock = groupBy(scene.terminals, (t) => t.block_id);
  const blockByAddr = new Map<string, FunctionBlockNode>();
  for (const b of scene.function_blocks) if (b.block_address != null && !blockByAddr.has(`${b.file}#${b.block_address}`)) blockByAddr.set(`${b.file}#${b.block_address}`, b);
  const connsOf = new Map<string, LogicConnectionNode[]>();
  const addConn = (key: string, c: LogicConnectionNode) => {
    const l = connsOf.get(key) ?? [];
    if (!l.includes(c)) l.push(c);
    connsOf.set(key, l);
  };
  for (const c of scene.connections) {
    if (c.source_block != null) addConn(`${c.file}#${c.source_block}`, c);
    if (c.target_block != null) {
      addConn(`${c.file}#${c.target_block}`, c);
      if (c.target_file) addConn(`${c.target_file}#${c.target_block}`, c);
    }
  }
  const refsOf = new Map<string, ReferenceNode[]>();
  for (const r of scene.references) for (const cb of r.connected_blocks) if (cb.block != null) {
    const k = `${r.file}#${cb.block}`;
    refsOf.set(k, [...(refsOf.get(k) ?? []).filter((x) => x !== r), r]);
  }
  const refBySheetLabel = new Map<string, ReferenceNode>();
  for (const r of scene.references) refBySheetLabel.set(r.id, r);

  const sheetsSorted = scene.sheets.slice().sort((a, b) => a.page - b.page);
  const rendered = { drawing: new Set<string>(), detail: new Set<string>(), annex: new Set<string>() };

  // ---------------------------------------------------------------- A: drawing pages
  const drawingPages: Array<{ items: Item[]; links: KeyLink[]; label: string; file: string }> = [];
  const annotations: AnnotationRecord[] = [];
  const annotationSkipped: Array<{ id: string; reason: string }> = [];
  const drawingItems = new Map<string, Item[]>();
  for (const sh of sheetsSorted) {
    const rs = byFileSheet.get(sh.file);
    const base = rs?.items ?? [];
    const ann = annotateSheet(sh, sheetIdx.get(sh.file));
    annotations.push(...ann.records);
    annotationSkipped.push(...ann.skipped);
    const items = [...base, ...ann.items];
    drawingItems.set(sh.file, items);
    for (const it of items) {
      rendered.drawing.add(`${sh.file}|${it.src}`);
      if (it.cls.startsWith("frame")) rendered.drawing.add(`${sh.file}|frame`);
    }
    const links: KeyLink[] = [];
    for (const b of sheetIdx.get(sh.file)?.blocks ?? []) {
      if (!b.page_bbox) continue;
      const [x1, y1, x2, y2] = b.page_bbox;
      links.push({ key: `blk:${b.id}`, rect: [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)] });
    }
    for (const r of scene.references.filter((x) => x.file === sh.file)) {
      const [x, y] = r.page_xy;
      const target = r.target_reference.sheet ? `sheet:${r.target_reference.sheet}` : `ref:${r.id}`;
      links.push({ key: target, rect: [x - 2, y - 5, x + 50, y + 5] });
    }
    drawingPages.push({ items, links, label: sh.file, file: sh.file });
  }

  // ---------------------------------------------------------------- B: block detail sections
  const detail = new Flow("FUNCTION BLOCK DETAIL");
  const blocksSorted = scene.function_blocks.slice().sort((a, b) => a.page - b.page || (a.block_address ?? 1e9) - (b.block_address ?? 1e9) || (a.id < b.id ? -1 : 1));
  let lastFile = "";
  for (const b of blocksSorted) {
    if (b.file !== lastFile) {
      detail.setSection(`${b.file} (page ${b.page})`);
      lastFile = b.file;
    }
    blockSection(detail, b);
  }

  function blockSection(f: Flow, b: FunctionBlockNode) {
    f.ensure(14);
    f.anchor(`blk:${b.id}`);
    rendered.detail.add(b.id);
    const title = b.block_address != null ? `BLOCK ${b.block_address}  FC ${fmt(b.function_code)}  ${fmt(b.function_name)}` : `SYMBOL ${fmt(b.symbol_name)} (no function-block address)`;
    f.heading(`${title}   [${b.status}]`, 7, b.id);
    f.line(`Sheet ${b.file}  drawing page ${b.page}  -> open sheet`, { link: `sheet:${b.file}` });
    f.line(`Block id ${b.id}  drawn=${b.drawn}  glyph=${b.glyph}  symbol=${fmt(b.symbol_name)}  insertion=${b.insertion ? `(${b.insertion[0]},${b.insertion[1]})` : "-"}  rotation=${b.rotation}  source bbox=${b.source_bbox ? b.source_bbox.join(",") : "-"}`);
    f.line(`Module ${b.module}  type ${fmt(b.module_type)}  segment block ${fmt(b.segment_block)}  executive block ${fmt(b.executive_block)}`);
    f.line(`Manual: ${fmt(b.manual_title)}  page ${fmt(b.manual_page)}`);
    f.line(`Source entities: ${b.source_entities.join(", ") || "-"}`);
    for (const d of b.diagnostics) f.line(`Diagnostic: ${d}`);

    // specifications
    const specs = b.specifications.map((id) => specById.get(id)).filter((s): s is SpecificationTerminal => !!s).sort((x, y) => x.number - y.number);
    if (specs.length) {
      f.gap(0.4);
      f.line(`SPECIFICATIONS (${specs.length})`, { cls: "report-sub" });
      const cols = [5, 16, 7, 9, 5, 18, 11, 0];
      cols[7] = f.maxChars - cols.slice(0, 7).reduce((a, c) => a + c, 0);
      const hdr = ["SPEC", "ACTUAL VALUE", "TYPE", "DEFAULT", "TUNE", "RANGE", "STATUS", "DESCRIPTION"];
      f.row(hdr.map((t, i) => ({ text: t, width: cols[i] })));
      for (const s of specs) {
        rendered.detail.add(s.id);
        f.anchor(`spec:${s.id}`);
        const value = s.actual_value != null ? String(s.raw_value_text ?? s.actual_value) : s.value_status;
        const tune = s.tune == null ? s.tune_raw || "-" : s.tune ? "Y" : "N";
        f.row([s.label, value, s.type, s.default, tune, s.range, s.status, s.manual_description + (s.enumeration_meaning ? ` [= ${s.enumeration_meaning}]` : "")].map((t, i) => ({ text: fmt(t), width: cols[i] })), { src: s.id });
        const term = s.terminal_id ? termById.get(s.terminal_id) : undefined;
        const extra: string[] = [];
        extra.push(`raw ${fmt(s.raw_hex)} @${fmt(s.byte_offset)}+${fmt(s.byte_length)}`);
        extra.push(s.drawn_on_symbol ? `drawn on symbol${term ? ` at pin ${fmt(term.pin)} ${xy(term.page_xy)} via ${term.association_method} (${term.association})` : " - pin position UNRESOLVED"}` : "not drawn on symbol");
        extra.push(`manual p.${s.manual_page} ${s.manual_section}`);
        f.line(extra.join("; "), { indent: 5 });
        if (s.is_block_address) {
          const cr = s.connected_reference;
          const tb = cr?.target_block != null ? blockByAddr.get(`${cr.target_file ?? b.file}#${cr.target_block}`) : undefined;
          const desc = cr ? `block-address -> ${fmt(cr.target_block)}${cr.target_output ? ` output ${cr.target_output}` : ""} FC ${fmt(cr.target_function_code)} ${fmt(cr.target_name)} sheet ${fmt(cr.target_file)} p.${fmt(cr.target_page)} [${cr.status}]` : "block-address target UNRESOLVED";
          f.line(desc, { indent: 5, link: tb ? `blk:${tb.id}` : undefined });
        }
        for (const w of s.wired_from) f.line(`wired from block ${fmt(w.source_block)} address ${fmt(w.source_address)} via ${w.wire_or_connection} [${w.status}]`, { indent: 5, link: wireById.has(w.wire_or_connection) ? `wire:${w.wire_or_connection}` : undefined });
        if (s.effective_input) f.line(`effective input address ${fmt(s.effective_input.address)} = block ${fmt(s.effective_input.source_block)} output ${fmt(s.effective_input.source_output)} [${s.effective_input.status}] ${s.effective_input.basis}`, { indent: 5 });
      }
    }

    // terminals
    const ins = b.input_terminals.map((id) => termById.get(id)).filter((t): t is Terminal => !!t);
    const outs = b.output_terminals.map((id) => termById.get(id)).filter((t): t is Terminal => !!t);
    const unl = (termsOfBlock.get(b.id) ?? []).filter((t) => !b.input_terminals.includes(t.id) && !b.output_terminals.includes(t.id));
    const termRows = (label: string, ts: Terminal[]) => {
      if (!ts.length) return;
      f.gap(0.4);
      f.line(`${label} (${ts.length})`, { cls: "report-sub" });
      const cols = [8, 7, 18, 11, 11, 18, 7, 0];
      cols[7] = f.maxChars - cols.slice(0, 7).reduce((a, c) => a + c, 0);
      f.row(["PIN", "LABEL", "METHOD", "ASSOC", "POSITION", "PAGE XY", "WIRED", "BASIS"].map((t, i) => ({ text: t, width: cols[i] })));
      for (const t of ts) {
        rendered.detail.add(t.id);
        f.row([fmt(t.pin), fmt(t.label), t.association_method, t.association, t.position_status, xy(t.page_xy), t.wired ? t.wire_ids.length ? t.wire_ids.map((w) => w.split(":").pop()).join(",") : "Y" : "N", t.basis].map((x, i) => ({ text: x, width: cols[i] })), { src: t.id, link: t.wire_ids[0] && wireById.has(t.wire_ids[0]) ? `wire:${t.wire_ids[0]}` : undefined });
      }
    };
    termRows("INPUT TERMINALS", ins);
    termRows("OUTPUT TERMINALS", outs);
    termRows("UNLABELLED DRAWN PINS", unl);

    // sub-blocks
    const subs = b.sub_blocks.map((id) => subById.get(id)).filter((s): s is SubBlock => !!s);
    if (subs.length) {
      f.gap(0.4);
      f.line(`OUTPUTS / SUB-BLOCKS N+k (${subs.length})`, { cls: "report-sub" });
      const cols = [7, 9, 6, 6, 9, 11, 18, 0];
      cols[7] = f.maxChars - cols.slice(0, 7).reduce((a, c) => a + c, 0);
      f.row(["N+k", "ADDRESS", "TYPE", "CAPT", "PIN", "STATUS", "PAGE XY", "DESCRIPTION"].map((t, i) => ({ text: t, width: cols[i] })));
      for (const s of subs) {
        rendered.detail.add(s.id);
        const t = s.terminal_id ? termById.get(s.terminal_id) : undefined;
        f.row([s.output_label, String(s.address), fmt(s.output_type), fmt(s.caption), fmt(t?.pin), s.status, xy(s.page_xy), fmt(s.output_description)].map((x, i) => ({ text: x, width: cols[i] })), { src: s.id });
      }
    }

    if (b.captions.length) {
      f.gap(0.4);
      f.line(`SYMBOL CAPTIONS (${b.captions.length})`, { cls: "report-sub" });
      for (const c of b.captions) {
        rendered.detail.add(`${b.id}:caption:${c.row_label}:${c.text}`);
        f.line(`'${c.text}' side=${c.side} row=${fmt(c.row_label)} at ${xy(c.page_xy)} [${c.status}] ${c.basis}`, { indent: 1 });
      }
    }

    // connections
    const conns = b.block_address != null ? connsOf.get(`${b.file}#${b.block_address}`) ?? [] : [];
    if (conns.length) {
      f.gap(0.4);
      f.line(`LOGIC CONNECTIONS (${conns.length})`, { cls: "report-sub" });
      for (const c of conns) {
        rendered.detail.add(c.id);
        const other = c.source_block === b.block_address && (c.file === b.file) ? blockByAddr.get(`${c.target_file ?? c.file}#${c.target_block}`) : blockByAddr.get(`${c.file}#${c.source_block}`);
        f.line(`${c.id} ${c.kind}: ${fmt(c.source_block)}${c.source_terminal ? `.${c.source_terminal}` : ""} (addr ${fmt(c.source_address)}) -> ${fmt(c.target_block)}${c.target_terminal ? `.${c.target_terminal}` : ""}  ${c.cross_page ? `cross-page ${fmt(c.target_file)} p.${fmt(c.target_page)}` : `same sheet p.${c.page}`}  signal ${fmt(c.signal)}  [${c.status}]${c.spec_check ? ` spec ${c.spec_check.spec}=${fmt(c.spec_check.value)} agrees=${c.spec_check.agrees}` : ""}${c.note ? ` ${c.note}` : ""}`, { indent: 1, link: other ? `blk:${other.id}` : undefined });
        if (c.wire_ids.length) f.line(`wires ${c.wire_ids.join(", ")}${c.junction_ids.length ? `; junctions ${c.junction_ids.join(", ")}` : ""}`, { indent: 3, link: wireById.has(c.wire_ids[0]) ? `wire:${c.wire_ids[0]}` : undefined });
      }
    }
    if (b.wires.length) f.line(`Wires on pins: ${b.wires.join(", ")}`, { link: wireById.has(b.wires[0]) ? `wire:${b.wires[0]}` : undefined });
    const refs = b.block_address != null ? refsOf.get(`${b.file}#${b.block_address}`) ?? [] : [];
    const refList = [...new Set([...b.irefs, ...b.orefs, ...refs.map((r) => r.id)])].map((id) => refBySheetLabel.get(id)).filter((r): r is ReferenceNode => !!r);
    if (refList.length) {
      f.gap(0.4);
      f.line(`IREF / OREF (${refList.length})`, { cls: "report-sub" });
      for (const r of refList) f.line(`${r.type} ${fmt(r.label)} signal ${fmt(r.signal)} zone ${fmt(r.zone)} -> ${fmt(r.target_reference.sheet)} p.${fmt(r.target_reference.page)} [${r.target_reference.status}]`, { indent: 1, link: `ref:${r.id}` });
    }
    f.gap(0.8);
  }

  // ---------------------------------------------------------------- C: annex
  const annex = new Flow("MICRO-DETAIL ANNEX");
  annex.setSection("coverage matrix");

  const entsByFile = groupBy(scene.entities, (e) => e.file);
  const wiresByFile = groupBy(scene.wires, (w) => w.file);
  const refsByFile = groupBy(scene.references, (r) => r.file);
  const chByFile = groupBy(scene.channels, (c) => c.file);
  const connByFile = groupBy(scene.connections, (c) => c.file);
  const unresByFile = groupBy(scene.unresolved, (u) => u.file ?? "");
  const annexBody = new Flow("MICRO-DETAIL ANNEX");
  for (const sh of sheetsSorted) {
    const f = annexBody;
    f.setSection(`${sh.file} (page ${sh.page})`);
    f.ensure(10);
    f.anchor(`annex:${sh.file}`);
    f.heading(`SHEET ${sh.file}  page ${sh.page}  sha256 ${sh.sha256.slice(0, 16)}`, 7);
    f.line(`-> open drawing page`, { link: `sheet:${sh.file}` });
    f.line(`Plot stamp: "${sh.plot_stamp.text}" [${sh.plot_stamp.status}] archive ${fmt(sh.plot_stamp.archive_entry)} ${fmt(sh.plot_stamp.mtime)}; ${sh.plot_stamp.basis}`);
    rendered.annex.add(`${sh.file}:plot_stamp`);
    f.line(`Frame: present=${sh.frame.present} symbol=${fmt(sh.frame.symbol)} library=${fmt(sh.frame.library)}`);
    f.line(`Counts: ${Object.entries(sh.counts).map(([k, v]) => `${k}=${v}`).join(" ")}`);
    f.line(`TITLE BLOCK (${sh.title_block.length})`, { cls: "report-sub" });
    for (const t of sh.title_block) f.line(`${t.label}: "${t.value}" [${t.status}] ${t.entity}`, { indent: 1 });
    for (const u of sh.title_block_unassigned) f.line(`unassigned title text: "${u}" [UNRESOLVED]`, { indent: 1 });

    const ents = entsByFile.get(sh.file) ?? [];
    const prim = ents.filter((e) => LIBRARY_LIKE.has(e.type));
    const listed = ents.filter((e) => !LIBRARY_LIKE.has(e.type));
    f.line(`ENTITIES (${ents.length}: ${listed.length} listed individually; ${prim.length} library primitives / grid marks summarised, full records in entities.json)`, { cls: "report-sub" });
    const primBy = groupBy(prim, (e) => `${e.type} ${e.raw_source.library ?? e.raw_source.file}`);
    for (const [k, v] of primBy) {
      f.line(`${k}: ${v.length} records, ids ${v[0].id} .. ${v[v.length - 1].id}`, { indent: 1 });
      for (const e of v) rendered.annex.add(e.id);
    }
    for (const e of listed) {
      rendered.annex.add(e.id);
      f.line(`${e.id} ${e.type} src(${e.x},${e.y}) page${xy(e.page_xy)} rot ${e.rotation} layer ${fmt(e.layer)}${e.text != null ? ` "${e.text}"` : ""}${e.parent ? ` parent ${e.parent}` : ""} @${e.raw_source.offset} [${e.status}]`, { indent: 1, src: e.id });
    }
    const ws = wiresByFile.get(sh.file) ?? [];
    f.line(`WIRES (${ws.length})`, { cls: "report-sub" });
    for (const w of ws) {
      rendered.annex.add(w.id);
      f.anchor(`wire:${w.id}`);
      f.line(wireLine(w), { indent: 1, src: w.id });
    }
    const rs = refsByFile.get(sh.file) ?? [];
    f.line(`IREF / OREF (${rs.length})`, { cls: "report-sub" });
    for (const r of rs) {
      rendered.annex.add(r.id);
      f.anchor(`ref:${r.id}`);
      f.line(`${r.id} ${r.type} label ${fmt(r.label)} signal ${fmt(r.signal)} symbol ${r.symbol_name} zone ${fmt(r.zone)} at ${xy(r.page_xy)} blocks [${r.connected_blocks.map((c) => `${fmt(c.block)}${c.terminal ? "." + c.terminal : ""}`).join(", ")}] target ${fmt(r.target_reference.sheet)} p.${fmt(r.target_reference.page)} ${fmt(r.target_reference.connector)} [${r.target_reference.status}${r.target_reference.candidates.length ? `; candidates ${r.target_reference.candidates.join(",")}` : ""}] [${r.status}]`, { indent: 1, src: r.id, link: r.target_reference.sheet ? `sheet:${r.target_reference.sheet}` : undefined });
    }
    const lc = connByFile.get(sh.file) ?? [];
    f.line(`LOGIC CONNECTIONS (${lc.length})`, { cls: "report-sub" });
    for (const c of lc) {
      rendered.annex.add(c.id);
      f.line(`${c.id} ${c.kind}: ${fmt(c.source_block)}${c.source_terminal ? `.${c.source_terminal}` : ""} (addr ${fmt(c.source_address)}) -> ${fmt(c.target_block)}${c.target_terminal ? `.${c.target_terminal}` : ""} target sheet ${fmt(c.target_file)} p.${fmt(c.target_page)} signal ${fmt(c.signal)} wires ${c.wire_ids.length} [${c.status}]${c.note ? ` ${c.note}` : ""}`, { indent: 1, src: c.id, link: c.wire_ids[0] && wireById.has(c.wire_ids[0]) ? `wire:${c.wire_ids[0]}` : undefined });
    }
    const cs = chByFile.get(sh.file) ?? [];
    f.line(`CHANNELS (${cs.length})`, { cls: "report-sub" });
    for (const c of cs) {
      rendered.annex.add(c.id);
      f.line(`"${c.text}" io ${c.io_type} channel ${fmt(c.channel)} suffix ${fmt(c.suffix)} physical ${fmt(c.physical_ref)} attached ${fmt(c.attached_to)} at ${xy(c.page_xy)} [${c.status}]`, { indent: 1, src: c.id });
    }
    const us = unresByFile.get(sh.file) ?? [];
    f.line(`UNRESOLVED / RAW-ONLY (${us.length})`, { cls: "report-sub" });
    for (const u of us) {
      rendered.annex.add(`unresolved:${u.kind}:${u.id}`);
      f.line(`${u.kind} ${u.id} [${u.status}] ${u.reason}${u.raw ? ` raw ${u.raw}` : ""}`, { indent: 1 });
    }
    f.gap(1);
  }
  const moduleUnres = unresByFile.get("") ?? [];
  if (moduleUnres.length) {
    annexBody.setSection("module-level unresolved");
    annexBody.heading(`MODULE-LEVEL UNRESOLVED (${moduleUnres.length})`);
    for (const u of moduleUnres) {
      rendered.annex.add(`unresolved:${u.kind}:${u.id}`);
      annexBody.line(`${u.kind} ${u.id} [${u.status}] ${u.reason}${u.raw ? ` raw ${u.raw}` : ""}`, { indent: 1 });
    }
  }
  // annotations not drawn are part of the annex
  annexBody.setSection("annotations not drawn");
  annexBody.heading(`ANNOTATIONS NOT DRAWN ON THE DRAWING PAGE (${annotationSkipped.length})`);
  for (const s of annotationSkipped) annexBody.line(`${s.id}: ${s.reason}`, { indent: 1 });

  // ---------------------------------------------------------------- coverage
  const { coverage, notRendered } = computeCoverage(scene, rendered, annotations);
  annex.heading("COVERAGE MATRIX  (parsed -> linked -> rendered -> listed)");
  annex.line("rendered_drawing: drawn on the sheet page (source display list or scene annotation). rendered_detail: printed on a block detail page.");
  annex.line("listed_annex: printed in this annex. not_rendered_anywhere must be 0; any non-zero row is a defect.");
  annex.gap();
  const cw = [22, 9, 9, 10, 9, 9, 10, 0];
  cw[7] = annex.maxChars - cw.slice(0, 7).reduce((a, c) => a + c, 0);
  annex.row(["CATEGORY", "PARSED", "LINKED", "DRAWING", "DETAIL", "ANNEX", "MISSING", "NOTES"].map((t, i) => ({ text: t, width: cw[i] })));
  for (const r of coverage) annex.row([r.category, String(r.parsed), String(r.linked), String(r.rendered_drawing), String(r.rendered_detail), String(r.listed_annex), String(r.not_rendered_anywhere), r.notes].map((t, i) => ({ text: t, width: cw[i] })));
  annex.gap();
  annex.line("STATUS LEGEND: EXPLICIT source record / exact incidence; DERIVED deterministic from source + manual; INFERRED convention applied (basis recorded, drawn in blue on its own layer); UNRESOLVED / NOT_PRESENT / CONFLICT / RAW_ONLY never drawn as fact.");
  annex.line(`Terminal validation: PITCH_SLOT placements agreeing with wire+spec proof ${scene.terminal_validation.pitch_slot_agree}/${scene.terminal_validation.pitch_slot_checked}; methods ${Object.entries(scene.terminal_validation.by_method).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  if (notRendered.length) {
    annex.heading(`PARSED BUT NOT RENDERED (${notRendered.length})`);
    for (const n of notRendered) annex.line(`${n.category} ${n.id}: ${n.reason}`, { indent: 1 });
  }

  // ---------------------------------------------------------------- assemble + resolve links
  const detailStart = drawingPages.length;
  const annexStart = detailStart + detail.pages.length;
  const annexBodyStart = annexStart + annex.pages.length;
  const keyTarget = new Map<string, { page: number; y?: number }>();
  drawingPages.forEach((p, i) => keyTarget.set(`sheet:${p.file}`, { page: i }));
  for (const [k, a] of detail.anchors) keyTarget.set(k, { page: detailStart + a.page, y: a.y });
  for (const [k, a] of annexBody.anchors) keyTarget.set(k, { page: annexBodyStart + a.page, y: a.y });
  const resolve = (links: KeyLink[]): PdfLink[] => links.flatMap((l) => {
    const t = keyTarget.get(l.key);
    return t ? [{ rect: l.rect, page: t.page, y: t.y }] : [];
  });
  const pages: PdfPage[] = [
    ...drawingPages.map((p) => ({ items: p.items, label: p.label, links: resolve(p.links) })),
    ...[...detail.pages, ...annex.pages, ...annexBody.pages].map((p: FlowPage) => ({ items: p.items, label: p.label, links: resolve(p.links), width: A4P_W, height: A4P_H })),
  ];
  const outline: Array<{ title: string; page: number }> = [];
  drawingPages.forEach((p, i) => outline.push({ title: `Drawing ${i + 1}: ${p.file}`, page: i }));
  outline.push({ title: "Function block detail", page: detailStart });
  for (const sh of sheetsSorted) {
    const first = blocksSorted.find((b) => b.file === sh.file);
    const a = first && detail.anchors.get(`blk:${first.id}`);
    if (a) outline.push({ title: `Detail: ${sh.file}`, page: detailStart + a.page });
  }
  outline.push({ title: "Annex: coverage matrix", page: annexStart });
  for (const sh of sheetsSorted) {
    const a = annexBody.anchors.get(`annex:${sh.file}`);
    if (a) outline.push({ title: `Annex: ${sh.file}`, page: annexBodyStart + a.page });
  }
  return {
    pages,
    outline,
    layers: ANNOTATION_LAYERS,
    drawingItems,
    annotations,
    annotationSkipped,
    coverage,
    notRendered,
    pageMap: { drawing: drawingPages.map((p, i) => ({ file: p.file, page: i + 1 })), detailStart: detailStart + 1, annexStart: annexStart + 1, total: pages.length },
  };

  function wireLine(w: WireNode) {
    const end = (e: WireNode["start"]) => `${e.kind}${e.block != null ? ` blk ${e.block}` : ""}${e.terminal ? `.${e.terminal}` : ""}${e.ref ? ` ${e.ref}` : ""} [${e.status}]`;
    return `${w.id} ${w.connection_type} ${w.line_type} ${xy(w.start_point)} -> ${xy(w.end_point)} pts ${w.path_points.length}: ${end(w.start)} -> ${end(w.end)} net ${fmt(w.net)} signal ${fmt(w.signal_label)} xref ${fmt(w.cross_page_reference)} junctions ${w.junctions.length} [${w.status}]`;
  }
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const l = m.get(k);
    if (l) l.push(x);
    else m.set(k, [x]);
  }
  return m;
}

function computeCoverage(scene: SceneGraph, r: { drawing: Set<string>; detail: Set<string>; annex: Set<string> }, ann: AnnotationRecord[]): { coverage: CoverageRow[]; notRendered: Array<{ category: string; id: string; reason: string }> } {
  const annIds = new Set(ann.map((a) => a.id));
  const notRendered: Array<{ category: string; id: string; reason: string }> = [];
  const rows: CoverageRow[] = [];
  const add = <T>(category: string, xs: T[], id: (x: T) => string, linked: (x: T) => boolean, drawn: (x: T) => boolean, inDetail: (x: T) => boolean, inAnnex: (x: T) => boolean, notes: string) => {
    let l = 0, d = 0, de = 0, a = 0, miss = 0;
    for (const x of xs) {
      const dd = drawn(x), ee = inDetail(x), aa = inAnnex(x);
      if (linked(x)) l++;
      if (dd) d++;
      if (ee) de++;
      if (aa) a++;
      if (!dd && !ee && !aa) {
        miss++;
        notRendered.push({ category, id: id(x), reason: "not drawn, not on a detail page, not in the annex" });
      }
    }
    rows.push({ category, parsed: xs.length, linked: l, rendered_drawing: d, rendered_detail: de, listed_annex: a, not_rendered_anywhere: miss, notes });
  };
  const srcOf = (e: Entity) => (e.raw_source.library ? `${e.raw_source.library}@${e.raw_source.offset}` : `${e.raw_source.file}@${e.raw_source.offset}`);
  const byType = groupBy(scene.entities, (e) => e.type);
  const FRAME_TYPES = new Set(["frame", "frame_component", "grid"]);
  for (const [t, es] of [...byType].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    add(
      `entity:${t}`,
      es,
      (e) => e.id,
      (e) => !!e.parent || e.references.length > 0 || !!e.group,
      (e) => r.drawing.has(`${e.file}|${srcOf(e)}`) || (FRAME_TYPES.has(e.type) && r.drawing.has(`${e.file}|frame`)),
      () => false,
      (e) => r.annex.has(e.id),
      FRAME_TYPES.has(t) ? "drawn = part of the sheet's expanded frame glyph" : "drawn = its source record appears in the page display list"
    );
  }
  add("function_block", scene.function_blocks, (b) => b.id, (b) => b.block_address != null, (b) => b.drawn, (b) => r.detail.has(b.id), () => false, "linked = trailer function-block record present");
  add("specification", scene.specifications, (s) => s.id, (s) => s.value_status === "EXTRACTED", (s) => s.terminal_id != null && annIds.has(s.terminal_id), (s) => r.detail.has(s.id), () => false, "drawn = S label annotated on its pin; linked = value decoded");
  add("terminal", scene.terminals, (t) => t.id, (t) => t.label != null, (t) => annIds.has(t.id), (t) => r.detail.has(t.id), () => false, "drawn = label annotated (inputs); linked = manual label bound");
  add("sub_block", scene.sub_blocks, (s) => s.id, (s) => s.terminal_id != null, (s) => annIds.has(s.id) || s.offset === 0, (s) => r.detail.has(s.id), () => false, "k=0 address is the block number on the glyph");
  add("wire", scene.wires, (w) => w.id, (w) => w.start.status !== "UNRESOLVED" && w.end.status !== "UNRESOLVED", (w) => w.source_entity_ids.some((s) => r.drawing.has(`${w.file}|${s}`)), (w) => r.detail.has(w.id), (w) => r.annex.has(w.id), "linked = both endpoints resolved");
  add("logic_connection", scene.connections, (c) => c.id, (c) => c.status !== "UNRESOLVED", () => false, (c) => r.detail.has(c.id), (c) => r.annex.has(c.id), "listed on the blocks' detail pages and per sheet in the annex");
  add("reference", scene.references, (x) => x.id, (x) => x.target_reference.status !== "UNRESOLVED", (x) => x.source_entities.some((s) => r.drawing.has(`${x.file}|${s}`)), () => false, (x) => r.annex.has(x.id), "linked = target sheet resolved");
  add("channel", scene.channels, (c) => c.id, (c) => c.attached_to != null, (c) => c.source_entities.some((s) => r.drawing.has(`${c.file}|${s}`)), () => false, (c) => r.annex.has(c.id), "exact string as drawn");
  add("unresolved", scene.unresolved, (u) => `${u.kind}:${u.id}`, () => false, () => false, () => false, (u) => r.annex.has(`unresolved:${u.kind}:${u.id}`), "every unresolved item listed with its reason");
  add("plot_stamp", scene.sheets, (s) => `${s.file}:plot_stamp`, (s) => s.plot_stamp.status !== "NOT_PRESENT", (s) => annIds.has(`${s.file}:plot_stamp`), () => false, (s) => r.annex.has(`${s.file}:plot_stamp`), "archive timestamp; drive prefix not in source");
  return { coverage: rows, notRendered };
}
