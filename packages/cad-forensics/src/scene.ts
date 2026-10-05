/**
 * Build the engineering scene graph for one module from its CAD sheets.
 *
 * Layers, in order: CAD record decode + reconstruction (cad-engine) →
 * trailer specification decode joined to the manual schema (fb-spec) →
 * terminal resolution (terminals.ts) → this assembly, which emits every
 * item as its own record and lists everything it could not resolve.
 */
import {
  decodeRecordStream,
  learnPinTemplates,
  pageTransform,
  type ReconstructModel,
  type ReconstructModuleResult,
  type CadBuffer,
} from "@infi90/cad-engine";
import { runModule, type ExtractionResult } from "@infi90/fb-spec";
import { getFunctionCode, knowledgeBase, type FunctionCodeSchema } from "@infi90/function-codes";
import { outputRows, resolveTerminals } from "./terminals";
import type {
  ChannelNode,
  Entity,
  FunctionBlockNode,
  LogicConnectionNode,
  PlotStamp,
  ReferenceNode,
  SceneGraph,
  SheetNode,
  SpecificationTerminal,
  Status,
  SubBlock,
  Terminal,
  UnresolvedItem,
  WireNode,
  XY,
} from "./types";

export interface ArchiveTime {
  /** Archive entry path, e.g. `M10/2071002C.CAD`. */
  entry: string;
  /** Entry timestamp as stored (DOS local time, read with local getters). */
  mtime: Date;
}

export interface BuildSceneOptions {
  module: string;
  cads: CadBuffer[];
  extractDir?: string;
  librarySearchRoots?: string[];
  /** Keyed by upper-case CAD file name. */
  archiveTimes?: Map<string, ArchiveTime>;
  /** Reuse a reconstruction / extraction of the same CAD set. */
  reconstructed?: ReconstructModuleResult;
  extraction?: ExtractionResult;
}

export interface SceneBuild {
  scene: SceneGraph;
  reconstructed: ReconstructModuleResult;
  extraction: ExtractionResult;
}

type DrawingSheet = ReconstructModel.DrawingSheet;

const r2 = (v: number) => Math.round(v * 100) / 100;
const CHANNEL_RE = /^(AIR|AOR|DIR|DOR|AI|AO|DI|DO)(\d+)([A-Z]?)(?:-([^/\s]*))?\/?(.*)$/i;

export function formatPlotTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const h = d.getHours() % 12 || 12;
  return `${p(h)}:${p(d.getMinutes())}:${p(d.getSeconds())} ${d.getHours() < 12 ? "AM" : "PM"} ${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()}`;
}

/** Join a manual-symbol run whose letters were spaced by the PDF extractor ("P T" → "PT"). */
function glyphText(s: string): string {
  const t = s.trim();
  const parts = t.split(/\s+/);
  if (parts.length > 1 && parts.filter((p) => p.length === 1).length >= parts.length - 1) return parts.join("");
  return /^(\S )+\S$/.test(t) ? t.replace(/\s+/g, "") : t;
}

/** Captions the manual symbol prints beside pins (STA, N/A, H, SST, CS, …), bound to the nearest pin row. */
export function symbolCaptions(schema: FunctionCodeSchema): Array<{ text: string; row_label: string | null; side: "input" | "output" | "body" }> {
  const sq = (s: string) => s.replace(/\s+/g, "");
  const absolute = new Set(schema.outputs.filter((o) => /^\d+$/.test(o.blk.trim())).map((o) => o.blk.trim()));
  const isRow = (q: string) => /^S\d+$/.test(q) || /^N(\+\d+)?$/.test(q) || absolute.has(q);
  const items = schema.symbol.items.map((i) => ({ ...i, q: sq(i.s) }));
  const pinRows = items.filter((i) => isRow(i.q));
  const inX = items.filter((i) => /^S\d+$/.test(i.q)).map((i) => i.x);
  const outX = items.filter((i) => /^N(\+\d+)?$/.test(i.q) || absolute.has(i.q)).map((i) => i.x);
  const ys = pinRows.map((i) => i.y).sort((a, b) => b - a);
  const pitch = ys.length > 1 ? Math.min(...ys.slice(1).map((y, i) => ys[i] - y).filter((d) => d > 1)) : 9;
  const mid = inX.length && outX.length ? (Math.max(...inX) + Math.min(...outX)) / 2 : null;
  const out: Array<{ text: string; row_label: string | null; side: "input" | "output" | "body" }> = [];
  for (const it of items) {
    if (isRow(it.q) || /^\(\d+\)$/.test(it.q)) continue;
    if (schema.symbol.title && it.q === sq(schema.symbol.title)) continue;
    const near = pinRows
      .map((r) => ({ r, d: Math.abs(r.y - it.y) }))
      .filter((x) => x.d <= Math.max(2.5, pitch * 0.5))
      .sort((a, b) => a.d - b.d || (mid != null ? (it.x < mid ? a.r.x - b.r.x : b.r.x - a.r.x) : 0));
    const sideOf = (q: string): "input" | "output" | "body" => (absolute.has(q) || /^N/.test(q) ? "output" : /^S/.test(q) ? "input" : "body");
    const side: "input" | "output" | "body" = mid == null ? (near[0] ? sideOf(near[0].r.q) : "body") : it.x < mid ? "input" : "output";
    const row = near.find((x) => (side === "input" ? /^S/.test(x.r.q) : side === "output" ? /^N/.test(x.r.q) || absolute.has(x.r.q) : true)) ?? near[0];
    const rowDesc = row ? schema.outputs.find((o) => o.blk.replace(/\s+/g, "") === row.r.q) : undefined;
    // The manual text layer reads the overrun caption as "D R". The output
    // table on the same page names that row a checkpoint overrun: the caption is OR.
    let text = glyphText(it.s);
    if (text === "DR" && rowDesc && /overrun/i.test(rowDesc.description)) text = "OR";
    out.push({ text, row_label: row ? row.r.q : null, side: row ? side : "body" });
  }
  return out;
}

export function buildScene(opts: BuildSceneOptions): SceneBuild {
  const cads = opts.cads.filter((c) => /\.CAD$/i.test(c.name)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const { result: fb, reconstructed } = opts.extraction && opts.reconstructed
    ? { result: opts.extraction, reconstructed: opts.reconstructed }
    : runModule({ module: opts.module, cads, extractDir: opts.extractDir, librarySearchRoots: opts.librarySearchRoots, reconstructed: opts.reconstructed });
  const sheets = reconstructed.sheets.slice().sort((a, b) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0));
  const pageOf = new Map(sheets.map((s, i) => [s.filename, i + 1]));
  const templates = learnPinTemplates(cads.map((c) => decodeRecordStream(c.data).records));
  const { byBlock, validation } = resolveTerminals(sheets, fb, templates, pageOf);

  const entities: Entity[] = [];
  const blocks: FunctionBlockNode[] = [];
  const subBlocks: SubBlock[] = [];
  const terminals: Terminal[] = [];
  const specs: SpecificationTerminal[] = [];
  const wires: WireNode[] = [];
  const connections: LogicConnectionNode[] = [];
  const references: ReferenceNode[] = [];
  const channels: ChannelNode[] = [];
  const sheetNodes: SheetNode[] = [];
  const unresolved: UnresolvedItem[] = [];

  const recByKey = new Map(fb.blocks.map((b) => [`${b.file}#${b.block_address}`, b]));
  const specsByBlock = new Map<string, typeof fb.specifications>();
  for (const s of fb.specifications) specsByBlock.set(s.block_id, [...(specsByBlock.get(s.block_id) ?? []), s]);
  const execs = fb.blocks.filter((b) => b.function_code === 81).map((b) => b.block_address);
  const segs = fb.blocks.filter((b) => b.function_code === 82).map((b) => b.block_address);

  /** cad block id by file#address, for rewriting connection terminals. */
  const cadBlockOf = new Map<string, string>();
  /** file -> wire offset -> wire id */
  const wireByOffset = new Map<string, string>();

  for (const s of sheets) {
    const d: DrawingSheet = s.drawing;
    const page = pageOf.get(s.filename)!;
    const tf = pageTransform(d);
    const PX = (x: number, y: number): XY => [r2(tf.x(x)), r2(tf.y(y))];
    const ent = (e: Omit<Entity, "file" | "page" | "page_xy" | "scale"> & { page_xy?: XY }) =>
      entities.push({ file: d.file, page, scale: 1, page_xy: e.page_xy ?? PX(e.x, e.y), ...e });
    const raw = (src: ReconstructModel.SourceRef, hex?: string) => ({ file: src.file, offset: src.offset, record_type: src.recordType, length_bytes: src.lengthBytes, ...(src.library ? { library: src.library } : {}), ...(hex ? { raw_hex: hex } : {}) });
    const sid = (src: ReconstructModel.SourceRef) => `${src.file}@${src.offset}`;

    // ---- frame, grid, title block
    if (d.frame.present && d.frame.source && d.frame.insertion) {
      ent({ id: `${d.file}:frame`, type: "frame", x: d.frame.insertion.x, y: d.frame.insertion.y, bbox: d.frame.bbox ? [d.frame.bbox.x1, d.frame.bbox.y1, d.frame.bbox.x2, d.frame.bbox.y2] : null, rotation: 0, layer: null, style: null, text: d.frame.symbolName, parent: null, group: "frame", references: d.frame.library ? [d.frame.library] : [], raw_source: raw(d.frame.source), status: "EXPLICIT" });
    }
    d.frame.components.forEach((c, i) => ent({ id: `${d.file}:frame.c${i}`, type: "frame_component", x: c.insertion.x, y: c.insertion.y, bbox: [c.bbox.x1, c.bbox.y1, c.bbox.x2, c.bbox.y2], rotation: c.rotation, layer: null, style: null, text: c.symbolName, parent: `${d.file}:frame`, group: "frame", references: [], raw_source: raw(c.source), status: c.libraryResolved ? "EXPLICIT" : "UNRESOLVED" }));
    d.gridMarks.forEach((g, i) => ent({ id: `${d.file}:grid.${g.axis}.${g.label}.${i}`, type: "grid", x: g.at.x, y: g.at.y, bbox: null, rotation: 0, layer: null, style: null, text: g.label, parent: `${d.file}:frame`, group: "grid", references: [], raw_source: raw(g.source), status: "EXPLICIT" }));
    // library primitives drawn for frame and LIBRARY glyphs (each keeps its library offset)
    let lp = 0;
    for (const it of s.items) {
      if (!/\.LBR@/i.test(it.src)) continue;
      const [lib, off] = it.src.split("@");
      const at: XY = it.t === "path" ? it.pts[0] : it.t === "arc" ? [it.cx, it.cy] : [it.x, it.y];
      entities.push({
        id: `${d.file}:lib${lp++}`,
        file: d.file,
        page,
        type: "library_primitive",
        x: r2((at[0] - tf.ox) / tf.k),
        y: r2((at[1] - tf.oy) / tf.k),
        bbox: null,
        page_xy: [r2(at[0]), r2(at[1])],
        rotation: it.t === "text" ? it.angle : 0,
        scale: 1,
        layer: null,
        style: null,
        text: it.t === "text" ? it.text : it.t,
        parent: ("blockId" in it && it.blockId) || (it.cls.startsWith("frame") ? `${d.file}:frame` : null),
        group: it.cls,
        references: [],
        raw_source: { file: d.file, offset: Number(off), record_type: null, length_bytes: null, library: lib },
        status: "EXPLICIT",
      });
    }
    const titleFields = d.titleBlock.fields.map((f) => ({ label: f.label, value: f.value, status: f.status as Status, entity: f.textId }));
    titleFields.forEach((f, i) => {
      const t = d.texts.find((x) => x.id === f.entity);
      ent({ id: `${d.file}:title.${i}`, type: "title_block_field", x: t?.bbox.x1 ?? 0, y: t?.bbox.y1 ?? 0, bbox: t ? [t.bbox.x1, t.bbox.y1, t.bbox.x2, t.bbox.y2] : null, rotation: t?.rotation ?? 0, layer: t?.layer ?? null, style: null, text: `${f.label}=${f.value}`, parent: `${d.file}:frame`, group: "title_block", references: [f.entity], raw_source: t ? raw(t.source) : { file: d.file, offset: -1, record_type: null, length_bytes: null }, status: f.status });
    });

    // ---- texts
    for (const t of d.texts) {
      ent({ id: `${d.file}:${t.id}`, type: "text", x: t.bbox.x1, y: t.bbox.y1, bbox: [t.bbox.x1, t.bbox.y1, t.bbox.x2, t.bbox.y2], rotation: t.rotation, layer: t.layer, style: null, text: t.text, parent: t.attachedTo ? `${d.file}:${t.attachedTo}` : null, group: t.role, references: [], raw_source: raw(t.source), status: "EXPLICIT" });
      const m = CHANNEL_RE.exec(t.text.trim());
      if (m) channels.push({ id: `${d.file}:ch:${t.id}`, text: t.text.trim(), io_type: m[1].toUpperCase(), channel: m[2] + (m[3] ?? ""), suffix: m[5] || null, physical_ref: null, attached_to: t.attachedTo ? `${d.file}:${t.attachedTo}` : null, page, file: d.file, page_xy: PX(t.bbox.x1, t.bbox.y1), source_entities: [sid(t.source)], status: "EXPLICIT" });
    }
    for (const a of d.arcs) ent({ id: `${d.file}:${a.id}`, type: "arc", x: a.center.x, y: a.center.y, bbox: null, rotation: 0, layer: a.layer, style: null, text: null, parent: null, group: "drawing", references: [], raw_source: raw(a.source), status: "EXPLICIT" });
    for (const u of d.unknownRecords) {
      const id = `${d.file}:unknown@${u.source.offset}`;
      ent({ id, type: "unknown", x: 0, y: 0, bbox: null, rotation: 0, layer: null, style: null, text: u.kind, parent: null, group: "unknown", references: [], raw_source: raw(u.source, u.residualHex), status: "RAW_ONLY" });
      unresolved.push({ kind: "unknown_record", id, file: d.file, page, status: "RAW_ONLY", reason: `${u.kind}: ${u.fields.join(" ")}`.trim(), raw: u.residualHex ?? null });
    }

    // ---- junctions
    for (const j of d.junctions) {
      ent({ id: `${d.file}:${j.id}`, type: "junction", x: j.at.x, y: j.at.y, bbox: null, rotation: 0, layer: null, style: null, text: j.kind, parent: null, group: "junction", references: j.connectionIds.map((c) => `${d.file}:${c}`), raw_source: j.source ? raw(j.source) : { file: d.file, offset: -1, record_type: null, length_bytes: null }, status: j.status as Status });
    }

    // ---- function blocks + terminals + specs + sub-blocks
    const pinsOf = new Map<string, ReconstructModel.FunctionPin[]>();
    for (const p of d.pins) pinsOf.set(p.blockId, [...(pinsOf.get(p.blockId) ?? []), p]);
    const termByPin = new Map<string, Terminal>();
    const drawnAddresses = new Set<number>();
    for (const b of d.functionBlocks) {
      const id = `${d.file}:${b.id}`;
      const rec = b.blockNumber != null ? recByKey.get(`${d.file}#${b.blockNumber}`) : undefined;
      if (b.blockNumber != null) {
        drawnAddresses.add(b.blockNumber);
        cadBlockOf.set(`${d.file}#${b.blockNumber}`, b.id);
      }
      const fc = rec?.function_code ?? b.functionCode;
      const schema = fc != null ? getFunctionCode(fc) : undefined;
      ent({ id, type: rec ? "function_block" : "symbol", x: b.insertion.x, y: b.insertion.y, bbox: [b.sourceBBox.x1, b.sourceBBox.y1, b.sourceBBox.x2, b.sourceBBox.y2], rotation: b.rotation, layer: b.layer, style: b.flags, text: b.symbolName, parent: null, group: b.family, references: [], raw_source: raw(b.source, b.rawHex), status: "EXPLICIT" });
      for (const p of pinsOf.get(b.id) ?? []) {
        ent({ id: `${d.file}:${p.id}`, type: "terminal", x: p.sourceX, y: p.sourceY, bbox: null, rotation: 0, layer: null, style: null, text: p.pinName, parent: id, group: p.side, references: p.connectionIds.map((c) => `${d.file}:${c}`), raw_source: raw(b.source), status: p.status as Status });
      }
      const bt = byBlock.get(b.id);
      const blockTerms = bt ? [...bt.inputs, ...bt.outputs, ...bt.unlabeled] : [];
      for (const t of blockTerms) {
        const tt = { ...t, id: `${d.file}:${t.id}`, block_id: id };
        terminals.push(tt);
        if (t.pin) termByPin.set(`${b.id}.${t.pin}`, tt);
        if (t.association === "UNRESOLVED" || t.association === "CONFLICT") {
          unresolved.push({ kind: t.label ? "terminal_label_position" : "terminal_label", id: tt.id, file: d.file, page, status: t.association, reason: t.basis, raw: t.pin });
        }
      }
      const node = blockNode(d, page, b, rec, schema, id, tf);
      node.input_terminals = (bt?.inputs ?? []).map((t) => `${d.file}:${t.id}`);
      node.output_terminals = (bt?.outputs ?? []).map((t) => `${d.file}:${t.id}`);
      node.wires = [...new Set((pinsOf.get(b.id) ?? []).flatMap((p) => p.connectionIds.map((c) => `${d.file}:${c}`)))];

      // captions bound to terminal rows
      if (schema) {
        const termByLabel = new Map(blockTerms.filter((t) => t.label).map((t) => [t.label!, t]));
        for (const c of symbolCaptions(schema)) {
          let row = c.row_label ? termByLabel.get(c.row_label) : undefined;
          if (!row && c.row_label && /^\d+$/.test(c.row_label) && rec) {
            const k = Number(c.row_label) - rec.block_address;
            if (k >= 0) row = termByLabel.get(k ? `N+${k}` : "N");
          }
          node.captions.push({
            text: c.text,
            row_label: c.row_label,
            side: c.side,
            page_xy: row?.page_xy ?? null,
            status: !row ? "UNRESOLVED" : row.association === "EXPLICIT" || row.association === "DERIVED" ? "DERIVED" : "INFERRED",
            basis: row ? `manual symbol prints '${c.text}' on the ${c.row_label} row (p.${schema.manual_page}); position from terminal ${row.label} (${row.association_method})` : `manual symbol caption '${c.text}' has no resolvable pin row`,
          });
        }
      }

      if (rec && fc != null) {
        // specifications
        for (const sp of specsByBlock.get(rec.id) ?? []) {
          const term = (bt?.inputs ?? []).find((t) => t.label === sp.label);
          const st: SpecificationTerminal = {
            id: `${d.file}:${b.id}.${sp.label}`,
            parent_block: id,
            block_address: rec.block_address,
            function_code: fc,
            number: sp.spec_number,
            label: sp.label,
            drawn_on_symbol: schema?.symbol.inputs.includes(sp.label) ?? false,
            raw_value_text: sp.raw_value_text,
            raw_hex: sp.raw_hex,
            actual_value: sp.actual_value,
            normalized_value: sp.normalized_value,
            type: sp.type,
            default: sp.default,
            tune: sp.tune,
            tune_raw: sp.tune_raw,
            range: sp.range,
            manual_description: sp.manual_description,
            enumeration_meaning: sp.enumeration_meaning,
            is_block_address: sp.is_block_address,
            connected_reference: sp.address_resolution
              ? { status: sp.address_resolution.status, target_block: sp.address_resolution.target_block, target_output: sp.address_resolution.target_output, target_function_code: sp.address_resolution.target_function_code, target_name: sp.address_resolution.target_name, target_file: sp.address_resolution.target_file, target_page: sp.address_resolution.target_page }
              : null,
            terminal_id: term ? `${d.file}:${term.id}` : null,
            page_xy: term?.page_xy ?? null,
            wired_from: sp.wired_from.map((w) => ({ wire_or_connection: w.connection_id, source_block: w.source_block, source_address: w.source_address, status: w.status })),
            effective_input: null,
            source_entities: sp.source.entity_ids,
            byte_offset: sp.source.byte_offset,
            byte_length: sp.source.byte_length,
            manual_page: sp.manual_page,
            manual_section: sp.manual_section,
            value_status: sp.status,
            status: sp.status === "EXTRACTED" ? "EXPLICIT" : (sp.status as Status),
          };
          specs.push(st);
          node.specifications.push(st.id);
          if (sp.status !== "EXTRACTED") unresolved.push({ kind: "specification_value", id: st.id, file: d.file, page, status: st.status, reason: sp.diagnostics.join("; ") || sp.status, raw: sp.raw_hex });
          if (sp.address_resolution && sp.address_resolution.status === "UNRESOLVED") unresolved.push({ kind: "block_address_target", id: st.id, file: d.file, page, status: "UNRESOLVED", reason: sp.address_resolution.note ?? `value ${sp.actual_value} names no block in the module`, raw: sp.raw_value_text });
        }
        // sub-blocks (outputs N+k)
        const captions = schema ? symbolCaptions(schema) : [];
        for (const { label: lab, offset: k, row, basis } of outputRows(schema, fc, rec.block_address)) {
          const term = (bt?.outputs ?? []).find((t) => t.label === lab);
          const sb: SubBlock = {
            id: `${d.file}:${b.id}.${lab}`,
            parent_block: id,
            parent_address: rec.block_address,
            address: rec.block_address + k,
            offset: k,
            output_label: lab,
            output_type: row?.type ?? null,
            output_description: row?.description ?? null,
            caption: captions.find((c) => c.row_label === lab && c.side === "output")?.text ?? null,
            function_code: fc,
            function_name: schema?.name ?? null,
            terminal_id: term ? `${d.file}:${term.id}` : null,
            page,
            file: d.file,
            page_xy: term?.page_xy ?? null,
            manual_page: row?.manual_page ?? schema?.manual_page ?? null,
            source_entities: [`${d.file}@${b.source.offset}`, `manual:FC${fc}:outputs:${basis === "absolute" ? row?.blk : lab}`],
            status: "DERIVED",
          };
          subBlocks.push(sb);
          node.sub_blocks.push(sb.id);
        }
      }
      blocks.push(node);
    }
    // trailer entries without a drawn symbol
    for (const rec of fb.blocks.filter((x) => x.file === d.file && !drawnAddresses.has(x.block_address))) {
      const schema = rec.function_code != null ? getFunctionCode(rec.function_code) : undefined;
      const id = `${d.file}:trailer#${rec.block_address}`;
      const node = blockNode(d, page, null, rec, schema, id, tf);
      for (const sp of specsByBlock.get(rec.id) ?? []) {
        const st: SpecificationTerminal = {
          id: `${id}.${sp.label}`, parent_block: id, block_address: rec.block_address, function_code: rec.function_code ?? -1, number: sp.spec_number, label: sp.label,
          drawn_on_symbol: false, raw_value_text: sp.raw_value_text, raw_hex: sp.raw_hex, actual_value: sp.actual_value, normalized_value: sp.normalized_value,
          type: sp.type, default: sp.default, tune: sp.tune, tune_raw: sp.tune_raw, range: sp.range, manual_description: sp.manual_description, enumeration_meaning: sp.enumeration_meaning,
          is_block_address: sp.is_block_address, connected_reference: null, terminal_id: null, page_xy: null, wired_from: [], effective_input: null,
          source_entities: sp.source.entity_ids, byte_offset: sp.source.byte_offset, byte_length: sp.source.byte_length, manual_page: sp.manual_page, manual_section: sp.manual_section,
          value_status: sp.status, status: sp.status === "EXTRACTED" ? "EXPLICIT" : (sp.status as Status),
        };
        specs.push(st);
        node.specifications.push(st.id);
      }
      for (const { label: lab, offset: k, row, basis } of outputRows(schema, rec.function_code, rec.block_address)) {
        const sb: SubBlock = {
          id: `${id}.${lab}`, parent_block: id, parent_address: rec.block_address, address: rec.block_address + k, offset: k, output_label: lab,
          output_type: row?.type ?? null, output_description: row?.description ?? null, caption: null, function_code: rec.function_code ?? -1, function_name: schema?.name ?? null,
          terminal_id: null, page, file: d.file, page_xy: null, manual_page: row?.manual_page ?? schema?.manual_page ?? null,
          source_entities: [...rec.source.entity_ids, `manual:FC${rec.function_code}:outputs:${basis === "absolute" ? row?.blk : lab}`],
          status: "DERIVED",
        };
        subBlocks.push(sb);
        node.sub_blocks.push(sb.id);
      }
      unresolved.push({ kind: "trailer_block_without_symbol", id, file: d.file, page, status: "NOT_PRESENT", reason: `block ${rec.block_address} FC${rec.function_code} is configured in the trailer but no symbol is drawn`, raw: rec.payload_hex });
      blocks.push(node);
    }

    // ---- connectors (IREF/OREF)
    const pinById = new Map(d.pins.map((p) => [p.id, p]));
    const blockById = new Map(d.functionBlocks.map((b) => [b.id, b]));
    for (const c of d.connectors) {
      const id = `${d.file}:${c.id}`;
      const at = c.connectionPoint ?? c.insertion;
      ent({ id, type: c.kind, x: c.insertion.x, y: c.insertion.y, bbox: [c.sourceBBox.x1, c.sourceBBox.y1, c.sourceBBox.x2, c.sourceBBox.y2], rotation: 0, layer: null, style: null, text: [c.reference, c.tag].filter(Boolean).join(" ") || c.symbolName, parent: null, group: c.kind, references: c.connectionIds.map((x) => `${d.file}:${x}`), raw_source: raw(c.source, c.rawHex), status: "EXPLICIT" });
      const net = d.nets.find((n) => n.connectorIds.includes(c.id));
      const connected = (net ? [...net.drivers, ...net.sinks] : [])
        .map((pid) => pinById.get(pid))
        .filter((p): p is ReconstructModel.FunctionPin => !!p)
        .map((p) => ({ block: blockById.get(p.blockId)?.blockNumber ?? null, terminal: termByPin.get(`${p.blockId}.${p.pinName}`)?.label ?? p.pinName }));
      const r = c.resolution;
      const status: Status = r.status === "UNRESOLVED" || r.status === "AMBIGUOUS" ? "UNRESOLVED" : (r.relation as Status);
      const node: ReferenceNode = {
        id,
        type: c.kind,
        label: c.reference,
        signal: c.tag,
        signal_raw: c.tagRaw,
        signal_padding: c.tagRaw && c.tag && c.tagRaw !== c.tag ? { leading: c.tagRaw.length - c.tagRaw.trimStart().length, trailing: c.tagRaw.length - c.tagRaw.trimEnd().length } : null,
        symbol_name: c.symbolName,
        zone: c.zone,
        connected_blocks: connected,
        target_reference: { status: r.status, sheet: r.targetSheet, page: r.targetSheet ? pageOf.get(r.targetSheet) ?? null : null, connector: r.targetConnectorId ? `${r.targetSheet}:${r.targetConnectorId}` : null, zone: r.targetZone, candidates: r.candidates },
        page,
        file: d.file,
        page_xy: PX(at.x, at.y),
        source_entities: [sid(c.source)],
        evidence: r.evidence,
        status,
      };
      references.push(node);
      if (status === "UNRESOLVED") unresolved.push({ kind: `${c.kind}_target`, id, file: d.file, page, status, reason: `${r.status}: ${r.evidence.join("; ") || "no partner"}`, raw: [c.reference, c.tag].filter(Boolean).join(" ") });
      for (const v of [c.tag, c.reference]) {
        const m = v ? CHANNEL_RE.exec(v.trim()) : null;
        if (m && v) channels.push({ id: `${id}:ch:${v}`, text: v.trim(), io_type: m[1].toUpperCase(), channel: m[2] + (m[3] ?? ""), suffix: m[5] || null, physical_ref: c.reference && c.reference !== v ? c.reference : null, attached_to: id, page, file: d.file, page_xy: PX(at.x, at.y), source_entities: [sid(c.source)], status: "EXPLICIT" });
      }
      for (const blk of blocks.filter((x) => x.file === d.file)) {
        if (connected.some((k) => k.block != null && k.block === blk.block_address)) (c.kind === "IREF" ? blk.irefs : blk.orefs).push(id);
      }
    }

    // ---- wires
    for (const w of d.connections) {
      const id = `${d.file}:${w.id}`;
      wireByOffset.set(`${d.file}@${w.source.offset}`, id);
      const end = (e: ReconstructModel.Endpoint) => {
        let block: number | null = null;
        let terminal: string | null = null;
        if (e.kind === "pin" && e.refId) {
          const p = pinById.get(e.refId);
          if (p) {
            block = blockById.get(p.blockId)?.blockNumber ?? null;
            terminal = termByPin.get(`${p.blockId}.${p.pinName}`)?.label ?? p.pinName;
          }
        } else if (e.kind === "connector" && e.refId) {
          terminal = d.connectors.find((c) => c.id === e.refId)?.kind ?? null;
        }
        return { kind: e.kind, ref: e.refId ? `${d.file}:${e.refId}` : null, block, terminal, status: e.status as Status, distance: r2(e.distance) };
      };
      const conn = [w.from, w.to].filter((e) => e.kind === "connector" && e.refId).map((e) => d.connectors.find((c) => c.id === e.refId)!).filter(Boolean);
      const node: WireNode = {
        id,
        file: d.file,
        page,
        start_point: [w.points[0].x, w.points[0].y],
        end_point: [w.points[w.points.length - 1].x, w.points[w.points.length - 1].y],
        path_points: w.points.map((p) => [p.x, p.y] as XY),
        page_points: w.points.map((p) => PX(p.x, p.y)),
        line_type: w.lineType,
        connection_type: w.connectionType,
        junctions: d.junctions.filter((j) => j.connectionIds.includes(w.id)).map((j) => `${d.file}:${j.id}`),
        source_entity_ids: [sid(w.source)],
        start: end(w.from),
        end: end(w.to),
        net: w.netId ? `${d.file}:${w.netId}` : null,
        signal_label: conn.map((c) => c.tag).filter(Boolean).join(" | ") || null,
        cross_page_reference: conn.map((c) => c.resolution.targetSheet).filter(Boolean).join(" | ") || null,
        status: w.relationStatus as Status,
      };
      wires.push(node);
      ent({ id, type: w.connectionType === "signal" ? "wire" : "polyline", x: w.points[0].x, y: w.points[0].y, bbox: bboxOf(w.points), rotation: 0, layer: w.layer, style: w.style, text: null, parent: null, group: w.connectionType, references: node.junctions, raw_source: raw(w.source), status: w.relationStatus as Status });
      if (w.connectionType === "signal" && (w.from.kind === "dangling" || w.to.kind === "dangling")) unresolved.push({ kind: "wire_endpoint", id, file: d.file, page, status: "UNRESOLVED", reason: "wire end does not land on a pin, connector, junction or wire", raw: null });
    }

    // ---- sheet node
    const z = opts.archiveTimes?.get(d.file.toUpperCase());
    const stamp: PlotStamp = z
      ? { text: `${z.entry.replace(/\//g, "\\")} ${formatPlotTime(z.mtime)}`, archive_entry: z.entry, mtime: z.mtime.toISOString(), status: "DERIVED", basis: "archive entry path and timestamp; the plotter's drive/root prefix is not in the source" }
      : { text: d.file, archive_entry: null, mtime: null, status: "NOT_PRESENT", basis: "CAD bytes carry no plot stamp and no archive timestamp was supplied" };
    if (!z) unresolved.push({ kind: "plot_stamp", id: `${d.file}:stamp`, file: d.file, page, status: "NOT_PRESENT", reason: stamp.basis, raw: null });
    for (const u of d.titleBlock.unassigned) unresolved.push({ kind: "title_block_text", id: `${d.file}:title:${u}`, file: d.file, page, status: "UNRESOLVED", reason: "title-block text not assigned to a field", raw: u });
    sheetNodes.push({
      file: d.file,
      page,
      sha256: d.sha256,
      title_block: titleFields,
      title_block_unassigned: d.titleBlock.unassigned,
      plot_stamp: stamp,
      frame: { present: d.frame.present, symbol: d.frame.symbolName, library: d.frame.library },
      counts: {
        function_blocks: d.functionBlocks.length,
        pins: d.pins.length,
        wires: d.connections.length,
        junctions: d.junctions.length,
        connectors: d.connectors.length,
        texts: d.texts.length,
        arcs: d.arcs.length,
        unknown_records: d.unknownRecords.length,
      },
    });
  }

  // ---- logic connections (fb-spec), terminals rewritten with resolved labels
  const termIndex = new Map<string, Terminal>();
  for (const t of terminals) if (t.pin && t.label) termIndex.set(`${t.block_id}|${t.pin}`, t);
  const termOf = (file: string | null, block: number | null, terminal: string | null): Terminal | undefined => {
    if (!file || block == null || !terminal) return undefined;
    const cadId = cadBlockOf.get(`${file}#${block}`);
    return cadId ? termIndex.get(`${file}:${cadId}|${terminal.split("/")[0]}`) : undefined;
  };
  const relabelFast = (file: string | null, block: number | null, terminal: string | null): string | null => {
    const t = termOf(file, block, terminal);
    return t && terminal ? `${terminal.split("/")[0]}/${t.label}` : terminal;
  };
  // Output address of a driving pin = block + k from its N+k row label.
  const outputAddressOf = (file: string | null, block: number | null, terminal: string | null): { address: number; status: Status; basis: string } | null => {
    const t = termOf(file, block, terminal);
    const m = t?.label ? /^N(?:\+(\d+))?$/.exec(t.label) : null;
    if (!t || !m || block == null) return null;
    return { address: block + (m[1] ? +m[1] : 0), status: t.association === "EXPLICIT" || t.association === "DERIVED" ? "DERIVED" : "INFERRED", basis: `driving pin ${t.pin} is output ${t.label} (${t.association_method})` };
  };
  const derivedAddress = new Map<string, { address: number | null; status: Status | null; basis: string | null; file: string; block: number | null; output: string | null }>();
  const junctionsOfWire = new Map<string, string[]>();
  for (const w of wires) junctionsOfWire.set(w.id, w.junctions);
  for (const c of fb.connections) {
    const wireIds = c.source_entity_ids.map((e) => wireByOffset.get(e)).filter((x): x is string => !!x);
    const derived = outputAddressOf(c.file, c.source_block, c.source_terminal);
    let source_address = c.source_address;
    let source_address_status: Status | null = c.source_address != null ? "EXPLICIT" : null;
    let source_address_basis: string | null = c.source_address != null ? "fb-spec output pin address" : null;
    if (derived && c.source_address == null) {
      source_address = derived.address;
      source_address_status = derived.status;
      source_address_basis = derived.basis;
    } else if (derived && derived.address !== c.source_address) {
      source_address_status = "CONFLICT";
      source_address_basis = `fb-spec address ${c.source_address} vs ${derived.basis} -> ${derived.address}`;
      unresolved.push({ kind: "connection_source_address", id: `${c.file}:${c.id}`, file: c.file, page: c.page, status: "CONFLICT", reason: source_address_basis, raw: null });
    }
    derivedAddress.set(`${c.target_file ?? c.file}|${c.id}`, { address: source_address, status: source_address_status, basis: source_address_basis, file: c.file, block: c.source_block, output: relabelFast(c.file, c.source_block, c.source_terminal)?.split("/")[1] ?? null });
    const node: LogicConnectionNode = {
      id: `${c.file}:${c.id}`,
      kind: c.kind,
      source_block: c.source_block,
      source_terminal: relabelFast(c.file, c.source_block, c.source_terminal),
      source_address,
      source_address_status,
      source_address_basis,
      target_block: c.target_block,
      target_terminal: relabelFast(c.target_file ?? c.file, c.target_block, c.target_terminal),
      wire_ids: wireIds,
      junction_ids: [...new Set(wireIds.flatMap((w) => junctionsOfWire.get(w) ?? []))],
      page: c.page,
      file: c.file,
      target_page: c.target_page,
      target_file: c.target_file,
      cross_page: !!c.target_file && c.target_file !== c.file,
      signal: c.signal,
      spec_check: c.spec_check ?? null,
      source_entities: c.source_entity_ids,
      status: c.status as Status,
      note: c.note ?? null,
    };
    connections.push(node);
    if (c.status === "UNRESOLVED") unresolved.push({ kind: "logic_connection", id: node.id, file: c.file, page: c.page, status: "UNRESOLVED", reason: c.note ?? "endpoint not resolved", raw: null });
  }

  // Wired inputs: the compiler takes the input address from the wire, not the
  // trailer value (which is often a placeholder constant block).
  const pageOfBlock = new Map(blocks.map((b) => [b.id, b.page]));
  for (const s of specs) {
    s.effective_input = null;
    if (!s.wired_from.length) continue;
    const file = s.parent_block.split(":")[0];
    const ds = s.wired_from.map((w) => {
      const d = derivedAddress.get(`${file}|${w.wire_or_connection}`);
      if (d && w.source_address == null && d.address != null) { w.source_address = d.address; w.status = d.status ?? w.status; }
      return d;
    });
    const addrs = [...new Set(ds.map((d) => d?.address ?? null))];
    const d = ds[0];
    if (addrs.length === 1 && addrs[0] != null && d) {
      const trailerReal = typeof s.actual_value === "number" && s.actual_value >= 10;
      const agrees = trailerReal ? s.actual_value === d.address : null;
      s.effective_input = { address: d.address, source_file: d.file, source_block: d.block, source_output: d.output, status: agrees === false ? "CONFLICT" : (d.status ?? "INFERRED"), basis: `${d.basis ?? "wire"}${trailerReal ? `; trailer value ${s.actual_value} ${agrees ? "agrees" : "differs"}` : "; trailer holds a placeholder"}` };
      if (agrees === false) unresolved.push({ kind: "effective_input", id: s.id, file, page: pageOfBlock.get(s.parent_block) ?? 0, status: "CONFLICT", reason: s.effective_input.basis, raw: s.raw_value_text });
    } else {
      s.effective_input = { address: null, source_file: d?.file ?? null, source_block: d?.block ?? null, source_output: d?.output ?? null, status: addrs.length > 1 ? "CONFLICT" : "UNRESOLVED", basis: addrs.length > 1 ? `wires deliver different addresses: ${addrs.join(", ")}` : "driving pin has no resolved N+k output row" };
    }
  }

  const kb = knowledgeBase();
  const scene: SceneGraph = {
    schema_version: 1,
    module: { name: opts.module, type: reconstructed.moduleHeader?.moduleType ?? fb.module.module_type ?? null, executive_blocks: execs, segment_blocks: segs, cad_files: cads.length },
    manual: { document: kb.source.document, sha256: kb.source.sha256 },
    sheets: sheetNodes,
    entities,
    function_blocks: blocks,
    sub_blocks: subBlocks,
    terminals,
    specifications: specs,
    wires,
    connections,
    references,
    channels,
    unresolved,
    terminal_validation: validation,
  };
  return { scene, reconstructed, extraction: fb };

  function blockNode(d: DrawingSheet, page: number, b: ReconstructModel.FunctionBlock | null, rec: (typeof fb.blocks)[number] | undefined, schema: FunctionCodeSchema | undefined, id: string, tf: ReturnType<typeof pageTransform>): FunctionBlockNode {
    const fc = rec?.function_code ?? b?.functionCode ?? null;
    const diagnostics = [...(rec?.diagnostics ?? [])];
    let status: Status = "EXPLICIT";
    if (!rec && b) {
      status = b.blockNumber != null ? "UNRESOLVED" : "EXPLICIT";
      if (b.blockNumber != null) diagnostics.push("symbol carries a block number but the trailer has no entry for it");
    }
    if (rec && fc != null && !schema) {
      status = "UNRESOLVED";
      diagnostics.push(`FC${fc} not in the manual knowledge base`);
    }
    if (rec?.status === "CONFLICT") status = "CONFLICT";
    if (status === "UNRESOLVED" || status === "CONFLICT") unresolved.push({ kind: "function_block", id, file: d.file, page, status, reason: diagnostics.join("; ") || "unresolved", raw: rec?.payload_hex ?? b?.rawHex ?? null });
    return {
      id,
      file: d.file,
      page,
      drawn: !!b,
      source_bbox: b ? [b.sourceBBox.x1, b.sourceBBox.y1, b.sourceBBox.x2, b.sourceBBox.y2] : null,
      page_bbox: b ? [r2(tf.x(b.sourceBBox.x1)), r2(tf.y(b.sourceBBox.y1)), r2(tf.x(b.sourceBBox.x2)), r2(tf.y(b.sourceBBox.y2))] : null,
      insertion: b ? [b.insertion.x, b.insertion.y] : null,
      rotation: b?.rotation ?? 0,
      symbol_name: b?.symbolName ?? rec?.symbol_name ?? null,
      glyph: b ? b.glyph.status : "NONE",
      function_code: fc,
      function_name: schema?.name ?? null,
      manual_title: schema?.symbol.title ?? null,
      block_address: rec?.block_address ?? b?.blockNumber ?? null,
      specifications: [],
      sub_blocks: [],
      input_terminals: [],
      output_terminals: [],
      wires: [],
      irefs: [],
      orefs: [],
      captions: [],
      module: opts.module,
      module_type: rec?.module.module_type ?? null,
      segment_block: rec?.segment.segment_block ?? null,
      executive_block: rec?.module.executive_block ?? null,
      source_entities: [...(b ? [`${d.file}@${b.source.offset}`] : []), ...(rec?.source.entity_ids ?? [])],
      manual_page: schema?.manual_page ?? null,
      status,
      diagnostics,
    };
  }
}

function bboxOf(pts: Array<{ x: number; y: number }>): [number, number, number, number] {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
