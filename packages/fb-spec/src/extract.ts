/**
 * Module-level function-block specification extraction.
 *
 * Block identity and actual values come only from each sheet's CAD trailer
 * (`BCCo SPC LIST`: block number, function code, packed payload). A trailer
 * entry is associated with a drawn symbol by the symbol record's own block
 * number (native entity relation). Spec semantics and the payload layout come
 * only from the manual knowledge base, looked up by function code.
 */
import { decodeTrailer, pageTransform, type ReconstructModel } from "@infi90/cad-engine";
import {
  decodePayload,
  fixedBlock,
  getFunctionCode,
  knowledgeBase,
  outputOffsets,
  type FunctionCodeSchema,
} from "@infi90/function-codes";
import { buildConnections, specConnections } from "./logic";
import type {
  AddressResolution,
  Diagnostic,
  DrawingContext,
  ExtractionResult,
  FunctionBlockRecord,
  LogicConnection,
  ModuleContext,
  PinAssociation,
  SegmentContext,
  SheetInfo,
  SourceLocation,
  SpecificationRecord,
} from "./types";

type DrawingSheet = ReconstructModel.DrawingSheet;
type FunctionBlock = ReconstructModel.FunctionBlock;

export interface ExtractSheetInput {
  drawing: DrawingSheet;
  data: Buffer;
}

export interface ExtractInput {
  /** Module identifier as named by the source (e.g. archive or file stem). */
  module: string;
  moduleType?: string | null;
  /** Sheets in drawing-page order. */
  sheets: ExtractSheetInput[];
}

const EXTRACTION_METHOD = "CAD_TRAILER_SPC_LIST+MANUAL_SCHEMA_LAYOUT";
const SEGMENT_BASIS =
  "Manual FC 82 explanation (p.230): a segment starts with the block number of a segment control block and ends at the next higher numbered segment control block or last block";

/** A spec whose manual description names a block in this module. */
export function isLocalBlockAddressSpec(description: string): boolean {
  return /^block address of/i.test(description) && !/\b(module|node|loop|pcu|remote)\b/i.test(description);
}

interface Entry {
  file: string;
  page: number;
  blockNumber: number;
  functionCode: number;
  offset: number;
  lengthBytes: number;
  payload: Uint8Array;
  symbol: FunctionBlock | null;
  sheet: DrawingSheet;
  /** Trailer entry stored under a different block number than its drawn symbol. */
  pairedFrom?: { blockNumber: number; basis: string };
}

const EXECUTIVE_PAIRING_BASIS =
  "the sheet has one FC 81 (executive, one per module) spec entry with no drawn symbol and one executive symbol (EX/…) with no spec entry";

export function extractModule(input: ExtractInput): ExtractionResult {
  const kb = knowledgeBase();
  const diagnostics: Diagnostic[] = [];
  const diag = (d: Diagnostic) => diagnostics.push(d);

  // ---------------------------------------------------------------- entries
  const entries: Entry[] = [];
  const orphanSymbols: Array<{ symbol: FunctionBlock; sheet: DrawingSheet; page: number }> = [];
  const sheetInfo: SheetInfo[] = [];
  input.sheets.forEach(({ drawing, data }, i) => {
    const page = i + 1;
    const trailer = decodeTrailer(data);
    if (!trailer.present) {
      diag({ code: "PARSE_FAILURE", severity: "warning", message: "sheet has no BCCo SPC LIST trailer", file: drawing.file, page });
    } else if (!trailer.chainClean) {
      diag({ code: "PARSE_FAILURE", severity: "error", message: `trailer entry chain did not end on the next section token: ${trailer.diagnostics.join("; ")}`, file: drawing.file, page });
    }
    const byBn = new Map<number, FunctionBlock[]>();
    for (const b of drawing.functionBlocks) {
      if (b.blockNumber == null) continue;
      byBn.set(b.blockNumber, [...(byBn.get(b.blockNumber) ?? []), b]);
    }
    const trailerBns = new Set<number>();
    for (const s of trailer.specifications) {
      trailerBns.add(s.blockNumber);
      const syms = byBn.get(s.blockNumber) ?? [];
      if (syms.length > 1) {
        diag({
          code: "AMBIGUOUS_OWNERSHIP",
          severity: "error",
          message: `${syms.length} symbols on the sheet carry block number ${s.blockNumber}; spec entry not associated`,
          file: drawing.file,
          page,
          block_address: s.blockNumber,
          entity_ids: syms.map((x) => `${drawing.file}@${x.source.offset}`),
        });
      }
      entries.push({
        file: drawing.file,
        page,
        blockNumber: s.blockNumber,
        functionCode: s.functionCode,
        offset: s.offset,
        lengthBytes: s.lengthBytes,
        payload: data.subarray(s.offset + 6, s.offset + s.lengthBytes),
        symbol: syms.length === 1 ? syms[0] : null,
        sheet: drawing,
      });
    }
    const sheetEntries = entries.filter((e) => e.file === drawing.file);
    const undrawnExec = sheetEntries.filter((e) => e.functionCode === 81 && !e.symbol);
    const orphanExec = [...byBn].filter(([bn, syms]) => !trailerBns.has(bn) && syms.length === 1 && /^EX\//i.test(syms[0].symbolName ?? ""));
    if (undrawnExec.length === 1 && orphanExec.length === 1) {
      const [bn, [symbol]] = orphanExec[0];
      const e = undrawnExec[0];
      e.pairedFrom = { blockNumber: e.blockNumber, basis: EXECUTIVE_PAIRING_BASIS };
      e.blockNumber = bn;
      e.symbol = symbol;
      trailerBns.add(bn);
    }
    for (const [bn, syms] of byBn) {
      if (trailerBns.has(bn)) continue;
      for (const symbol of syms) orphanSymbols.push({ symbol, sheet: drawing, page });
    }
    sheetInfo.push({
      file: drawing.file,
      page,
      sha256: drawing.sha256,
      block_ids: [],
      trailer_entries: trailer.specifications.length,
      drawn_blocks: [...byBn.values()].reduce((a, x) => a + x.length, 0),
    });
  });

  // ------------------------------------------------------- module indices
  const byAddress = new Map<number, Entry[]>();
  for (const e of entries) byAddress.set(e.blockNumber, [...(byAddress.get(e.blockNumber) ?? []), e]);
  const segmentBlocks = [...new Set(entries.filter((e) => e.functionCode === 82).map((e) => e.blockNumber))].sort((a, b) => a - b);
  const executives = [...new Set(entries.filter((e) => e.functionCode === 81).map((e) => e.blockNumber))].sort((a, b) => a - b);
  const module: ModuleContext = {
    module: input.module,
    module_type: input.moduleType ?? null,
    executive_block: executives.length === 1 ? executives[0] : null,
  };
  if (executives.length > 1) {
    diag({ code: "AMBIGUOUS_OWNERSHIP", severity: "warning", message: `module has ${executives.length} executive (FC 81) blocks: ${executives.join(", ")}` });
  }

  const segmentOf = (addr: number): SegmentContext => {
    let seg: number | null = null;
    for (const s of segmentBlocks) if (s <= addr) seg = s;
    if (seg == null) {
      return {
        segment_block: null,
        evidence: "UNRESOLVED",
        basis: segmentBlocks.length ? `block precedes the first segment control block (${segmentBlocks[0]})` : "no segment control block (FC 82) in the module",
      };
    }
    return { segment_block: seg, evidence: "DERIVED", basis: SEGMENT_BASIS };
  };

  for (const [addr, list] of byAddress) {
    if (list.length < 2) continue;
    const same = list.every((e) => e.functionCode === list[0].functionCode && Buffer.compare(Buffer.from(e.payload), Buffer.from(list[0].payload)) === 0);
    diag({
      code: "DUPLICATE_BLOCK_ADDRESS",
      severity: same ? "warning" : "error",
      message: `block ${addr} is defined ${list.length} times (${list.map((e) => e.file).join(", ")})${same ? " with identical content" : " with different content"}`,
      block_address: addr,
      entity_ids: list.map((e) => `${e.file}@${e.offset}`),
    });
  }

  const fixedScope = kb.fixed_blocks;
  const fixedScopeMatches = !!(fixedScope && module.module_type && fixedScope.scope.toUpperCase().includes(module.module_type.toUpperCase()));
  const sortedAddresses = [...byAddress.keys()].sort((a, b) => a - b);
  const fixedInfo = (value: number) => {
    const fb = value <= 29 ? fixedBlock(value) : undefined;
    return fb && fixedScope ? { fb, info: { description: fb.description, table: fixedScope.table, scope: fixedScope.scope, manual_page: fb.manual_page } } : null;
  };
  const resolveAddress = (value: number): AddressResolution => {
    const target = (t: Entry, output: string | null, evidence: AddressResolution["evidence"], note?: string): AddressResolution => {
      const fx = fixedInfo(value);
      return {
        status: "RESOLVED_BLOCK",
        evidence,
        address: value,
        target_block: t.blockNumber,
        target_output: output,
        target_function_code: t.functionCode,
        target_name: getFunctionCode(t.functionCode)?.name ?? null,
        target_file: t.file,
        target_page: t.page,
        target_segment: segmentOf(t.blockNumber).segment_block,
        ...(fx ? { fixed_block: fx.info } : {}),
        ...(note ? { note } : {}),
      };
    };
    const empty = { address: value, target_block: null, target_output: null, target_function_code: null, target_name: null, target_file: null, target_page: null, target_segment: null };
    const hits = byAddress.get(value);
    if (hits && hits.length > 1) {
      return { status: "UNRESOLVED", evidence: "UNRESOLVED", ...empty, note: `block ${value} is defined in ${hits.length} sheets` };
    }
    if (hits && hits.length === 1) {
      const offs = outputOffsets(hits[0].functionCode);
      return target(hits[0], offs.includes(0) ? "N" : null, "EXPLICIT");
    }
    // Output N+k of the nearest lower block, when its manual outputs include k.
    let owner: number | null = null;
    for (const a of sortedAddresses) {
      if (a >= value) break;
      owner = a;
    }
    if (owner != null) {
      const list = byAddress.get(owner)!;
      const k = value - owner;
      if (list.length === 1 && k > 0 && outputOffsets(list[0].functionCode).includes(k)) {
        return target(list[0], `N+${k}`, "DERIVED", `manual FC ${list[0].functionCode} outputs include N+${k}`);
      }
    }
    const fx = fixedInfo(value);
    if (fx) {
      return {
        status: "RESOLVED_FIXED_BLOCK",
        evidence: fixedScopeMatches ? "DERIVED" : "INFERRED",
        ...empty,
        target_function_code: fx.fb.function_code_source === "PRINTED" ? fx.fb.function_code : null,
        fixed_block: fx.info,
        note: fixedScopeMatches ? undefined : `manual table is scoped to ${fixedScope!.scope}; module type ${module.module_type ?? "unknown"}`,
      };
    }
    return { status: "UNRESOLVED", evidence: "UNRESOLVED", ...empty, note: `no block ${value} (or block output) in the module's CAD trailers` };
  };

  // ------------------------------------------------------ block records
  const blocks: FunctionBlockRecord[] = [];
  const specifications: SpecificationRecord[] = [];
  const unknown = new Map<number, { blocks: Set<number>; files: Set<string> }>();

  const drawingContext = (sheet: DrawingSheet, page: number): DrawingContext => {
    const fields = sheet.titleBlock.fields.map((f) => ({ label: f.label, value: f.value, status: f.status }));
    const dn = fields.find((f) => /^(DWG|DRAWING)\.?\s*(NO|NUMBER)\b/i.test(f.label));
    return { file: sheet.file, page, title_block: fields, drawing_number: dn ? dn.value : null };
  };

  const locate = (sheet: DrawingSheet, page: number, sym: FunctionBlock | null, entityIds: string[]): SourceLocation => {
    if (!sym) return { file: sheet.file, page, bbox: null, source_bbox: null, entity_ids: entityIds };
    const tf = pageTransform(sheet);
    const B = sym.sourceBBox;
    const r = (v: number) => Math.round(v * 100) / 100;
    return {
      file: sheet.file,
      page,
      bbox: [r(tf.x(B.x1)), r(tf.y(B.y1)), r(tf.x(B.x2)), r(tf.y(B.y2))],
      source_bbox: [B.x1, B.y1, B.x2, B.y2],
      entity_ids: [`${sheet.file}@${sym.source.offset}`, ...entityIds],
    };
  };

  for (const e of entries) {
    const id = `${e.file}#${e.blockNumber}`;
    const schema = getFunctionCode(e.functionCode);
    const dups = byAddress.get(e.blockNumber)!;
    const conflict = dups.length > 1 && !dups.every((x) => x.functionCode === e.functionCode && Buffer.compare(Buffer.from(x.payload), Buffer.from(e.payload)) === 0);
    const trailerId = `${e.file}@${e.offset}`;
    const source = locate(e.sheet, e.page, e.symbol, [trailerId]);
    const blockDiag: string[] = [];
    if (e.pairedFrom) {
      blockDiag.push(`spec entry stored as block ${e.pairedFrom.blockNumber}; paired with symbol block ${e.blockNumber}: ${e.pairedFrom.basis}`);
    }
    if (!e.symbol) {
      blockDiag.push("trailer entry has no drawn symbol with this block number");
      diag({ code: "TRAILER_ENTRY_WITHOUT_SYMBOL", severity: "warning", message: `block ${e.blockNumber} FC ${e.functionCode} has a spec entry but no drawn symbol`, file: e.file, page: e.page, block_address: e.blockNumber, function_code: e.functionCode, entity_ids: [trailerId] });
    }
    const pins = pinAssociations(e.sheet, e.symbol, schema);
    if (e.symbol && schema && pins.some((p) => p.label == null)) {
      diag({ code: "PIN_MAPPING_UNRESOLVED", severity: "info", message: pins[0]?.basis ?? "no pins", file: e.file, page: e.page, block_address: e.blockNumber, function_code: e.functionCode });
    }

    const record: FunctionBlockRecord = {
      id,
      block_address: e.blockNumber,
      function_code: e.functionCode,
      name: schema?.name ?? null,
      symbol_name: e.symbol?.symbolName ?? null,
      drawn: !!e.symbol,
      file: e.file,
      page: e.page,
      source,
      module,
      segment: segmentOf(e.blockNumber),
      drawing: drawingContext(e.sheet, e.page),
      manual_page: schema?.manual_page ?? null,
      manual_section: schema?.manual_section ?? null,
      layout_status: "UNKNOWN_FUNCTION_CODE",
      payload_hex: Buffer.from(e.payload).toString("hex"),
      expected_bytes: null,
      actual_bytes: e.payload.length,
      spec_ids: [],
      pins,
      status: conflict ? "CONFLICT" : "EXTRACTED",
      diagnostics: blockDiag,
    };
    blocks.push(record);
    sheetInfo[e.page - 1].block_ids.push(id);

    if (!schema) {
      record.status = conflict ? "CONFLICT" : "UNRESOLVED";
      blockDiag.push(`function code ${e.functionCode} has no manual schema; payload kept as hex`);
      const u = unknown.get(e.functionCode) ?? { blocks: new Set(), files: new Set() };
      u.blocks.add(e.blockNumber);
      u.files.add(e.file);
      unknown.set(e.functionCode, u);
      continue;
    }

    const decoded = decodePayload(schema, e.payload);
    record.layout_status = decoded.status;
    record.expected_bytes = decoded.expected_bytes;
    if (decoded.status !== "DECODED") {
      if (!conflict) record.status = "UNRESOLVED";
      blockDiag.push(...decoded.diagnostics);
      diag({
        code: decoded.status === "LAYOUT_MISMATCH" ? "LAYOUT_MISMATCH" : "LAYOUT_UNRESOLVED",
        severity: "error",
        message: decoded.diagnostics.join("; "),
        file: e.file,
        page: e.page,
        block_address: e.blockNumber,
        function_code: e.functionCode,
        entity_ids: [trailerId],
      });
    }
    const byNumber = new Map(decoded.specs.map((s) => [s.number, s]));
    for (const ms of schema.specifications) {
      const d = byNumber.get(ms.number);
      const specDiag = [...(d?.diagnostics ?? [])];
      if (d?.diagnostics.length) {
        diag({ code: "INT_HIGH_BIT", severity: "info", message: d.diagnostics.join("; "), file: e.file, page: e.page, block_address: e.blockNumber, function_code: e.functionCode, spec: ms.label });
      }
      const local = ms.is_block_address && isLocalBlockAddressSpec(ms.description);
      let resolution: AddressResolution | null = null;
      if (ms.is_block_address) {
        if (!d) resolution = null;
        else if (!local) {
          resolution = {
            status: "NOT_APPLICABLE",
            evidence: "UNRESOLVED",
            address: d.actual_value,
            target_block: null,
            target_output: null,
            target_function_code: null,
            target_name: null,
            target_file: null,
            target_page: null,
            target_segment: null,
            note: "manual description does not identify a block in this module",
          };
        } else {
          resolution = resolveAddress(d.actual_value);
          if (resolution.status === "UNRESOLVED") {
            diag({ code: "UNRESOLVED_BLOCK_ADDRESS", severity: "warning", message: `${ms.label} = ${d.raw_value_text}: ${resolution.note}`, file: e.file, page: e.page, block_address: e.blockNumber, function_code: e.functionCode, spec: ms.label });
          }
        }
      }
      const text = d?.raw_value_text ?? null;
      const enumHit = text != null ? ms.enumerations.find((x) => x.value === text) : undefined;
      const pin = pins.find((p) => p.label === ms.label) ?? null;
      const spec: SpecificationRecord = {
        id: `${id}.${ms.label}`,
        block_id: id,
        block_address: e.blockNumber,
        function_code: e.functionCode,
        spec_number: ms.number,
        label: ms.label,
        raw_value_text: text,
        raw_hex: d?.raw_hex ?? null,
        actual_value: d?.actual_value ?? null,
        normalized_value: d?.normalized_value ?? null,
        type: ms.type,
        default: ms.default,
        tune: ms.tune,
        tune_raw: ms.tune_raw,
        range: ms.range,
        manual_description: ms.description,
        note_refs: ms.note_refs ?? [],
        enumerations: ms.enumerations,
        enumeration_meaning: enumHit?.meaning ?? null,
        is_block_address: ms.is_block_address,
        address_resolution: resolution,
        pin,
        wired_from: [],
        source: {
          ...source,
          byte_offset: d ? e.offset + 6 + d.offset : null,
          byte_length: d ? d.width : null,
        },
        manual_page: ms.manual_page,
        manual_section: schema.manual_section,
        extraction_method: EXTRACTION_METHOD,
        association: e.pairedFrom
          ? { method: `EXECUTIVE_PAIRING (${e.pairedFrom.basis})`, evidence: "DERIVED" }
          : { method: "NATIVE_BLOCK_NUMBER (symbol record +30 = trailer entry block number)", evidence: e.symbol ? "EXPLICIT" : "UNRESOLVED" },
        status: conflict ? "CONFLICT" : d ? "EXTRACTED" : "UNRESOLVED",
        diagnostics: specDiag,
      };
      specifications.push(spec);
      record.spec_ids.push(spec.id);
    }
  }

  for (const o of orphanSymbols) {
    const bn = o.symbol.blockNumber!;
    const id = `${o.sheet.file}#${bn}`;
    const src = locate(o.sheet, o.page, o.symbol, []);
    diag({ code: "SYMBOL_WITHOUT_TRAILER_ENTRY", severity: "warning", message: `symbol ${o.symbol.symbolName} carries block number ${bn} but the sheet trailer has no spec entry for it`, file: o.sheet.file, page: o.page, block_address: bn, entity_ids: src.entity_ids });
    blocks.push({
      id,
      block_address: bn,
      function_code: null,
      name: null,
      symbol_name: o.symbol.symbolName,
      drawn: true,
      file: o.sheet.file,
      page: o.page,
      source: src,
      module,
      segment: segmentOf(bn),
      drawing: drawingContext(o.sheet, o.page),
      manual_page: null,
      manual_section: null,
      layout_status: "NOT_PRESENT",
      payload_hex: "",
      expected_bytes: null,
      actual_bytes: 0,
      spec_ids: [],
      pins: pinAssociations(o.sheet, o.symbol, undefined),
      status: "NOT_PRESENT",
      diagnostics: ["no trailer spec entry: function code and spec values are not present in the CAD"],
    });
    sheetInfo[o.page - 1].block_ids.push(id);
  }

  for (const d of kb.diagnostics) diag({ code: "MANUAL_DIAGNOSTIC", severity: "info", message: d });
  const seenFc = new Set(entries.map((e) => e.functionCode));
  for (const s of kb.function_codes) {
    if (!seenFc.has(s.function_code)) continue;
    for (const m of s.diagnostics) diag({ code: "MANUAL_DIAGNOSTIC", severity: "info", message: m, function_code: s.function_code });
  }

  const unknown_function_codes = [...unknown.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([fc, u]) => {
      diag({ code: "UNKNOWN_FUNCTION_CODE", severity: "error", message: `function code ${fc} is not in the manual (${u.blocks.size} block(s))`, function_code: fc });
      return { function_code: fc, blocks: [...u.blocks].sort((a, b) => a - b), files: [...u.files].sort() };
    });

  const result: ExtractionResult = {
    schema_version: 1,
    module,
    manual: { document: kb.source.document, sha256: kb.source.sha256, schema_version: kb.schema_version },
    sheets: sheetInfo,
    blocks,
    specifications,
    connections: [],
    diagnostics,
    unknown_function_codes,
  };
  const wired = buildConnections(input.sheets.map((s) => s.drawing), result);
  applyWiring(result, wired, resolveAddress);
  result.connections = [...wired, ...specConnections(result)];
  return result;
}

const RANK = { UNRESOLVED: 0, INFERRED: 1, DERIVED: 2, EXPLICIT: 3 } as const;
const weaker = (a: keyof typeof RANK, b: keyof typeof RANK) => (RANK[a] <= RANK[b] ? a : b);

/**
 * Attach drawn wiring to specs through established pin labels. For a
 * block-address spec whose pin is wired, the stored CAD value is kept
 * verbatim but the input is resolved from the wire: on these drawings the
 * stored value of a wired input is a placeholder (0, or a constant block
 * such as 5), and the vendor spec report prints that same placeholder.
 */
function applyWiring(result: ExtractionResult, connections: LogicConnection[], resolveAddress: (v: number) => AddressResolution) {
  const specById = new Map(result.specifications.map((s) => [s.id, s]));
  for (const c of connections) {
    if (c.target_block == null || !c.target_terminal?.includes("/")) continue;
    const label = c.target_terminal.split("/")[1];
    const spec = specById.get(`${c.target_file ?? c.file}#${c.target_block}.${label}`);
    if (!spec) continue;
    spec.wired_from.push({ connection_id: c.id, source_block: c.source_block, source_address: c.source_address, kind: c.kind, status: c.status });
  }
  const blocksById = new Map(result.blocks.map((b) => [b.id, b]));
  for (const s of result.specifications) {
    if (!s.is_block_address || !s.address_resolution || s.address_resolution.status === "NOT_APPLICABLE") continue;
    if (s.wired_from.length) {
      const addrs = [...new Set(s.wired_from.map((w) => w.source_address))];
      const stored = s.address_resolution;
      const pinEvidence = s.pin?.evidence ?? "UNRESOLVED";
      if (addrs.length === 1 && addrs[0] != null) {
        const via = resolveAddress(addrs[0]);
        const w = s.wired_from[0];
        const agrees = s.actual_value === addrs[0];
        s.address_resolution = {
          ...via,
          status: "WIRED_INPUT",
          evidence: agrees ? "EXPLICIT" : weaker(pinEvidence, w.status),
          address: addrs[0],
          note:
            (agrees ? `stored value ${s.raw_value_text} names the wired source` : `CAD stores ${s.raw_value_text} for this input (placeholder); the drawn wire into ${s.pin?.pin ?? "the pin"} supplies block ${addrs[0]}`) +
            (stored.status === "RESOLVED_FIXED_BLOCK" && stored.fixed_block ? `; stored value alone would read as fixed block '${stored.fixed_block.description}'` : ""),
        };
      } else {
        s.address_resolution = {
          status: "UNRESOLVED",
          evidence: "UNRESOLVED",
          address: null,
          target_block: null,
          target_output: null,
          target_function_code: null,
          target_name: null,
          target_file: null,
          target_page: null,
          target_segment: null,
          note: `pin is wired but the source output address is not established (${s.wired_from.map((w) => `${w.kind} from ${w.source_block ?? "?"}`).join(", ")}); CAD stores ${s.raw_value_text}`,
        };
        result.diagnostics.push({ code: "UNRESOLVED_BLOCK_ADDRESS", severity: "warning", message: s.address_resolution.note!, file: s.source.file, page: s.source.page, block_address: s.block_address, function_code: s.function_code, spec: s.label });
      }
      continue;
    }
    const blk = blocksById.get(s.block_id)!;
    const unmappedWired = blk.pins.filter((p) => p.side === "left" && p.connected && p.label == null).length;
    const r = s.address_resolution;
    const placeholderLike = r.status === "RESOLVED_FIXED_BLOCK" || (r.address != null && r.address <= 29);
    if (unmappedWired && s.pin == null && placeholderLike) {
      r.note = [r.note, `block has ${unmappedWired} wired input pin(s) whose spec is not established; this stored value may be a placeholder for a wired input`].filter(Boolean).join("; ");
      if (r.evidence === "EXPLICIT" || r.evidence === "DERIVED") r.evidence = "INFERRED";
    }
  }
}

/**
 * Positional pins → manual symbol labels. The CAD records no pin labels (the
 * function-block glyph library is not supplied), so a label is assigned only
 * when the unrotated symbol's drawn pins on a side are exactly as many as the
 * manual symbol prints on that side, in the same top-to-bottom order.
 */
export function pinAssociations(sheet: DrawingSheet, sym: FunctionBlock | null, schema: FunctionCodeSchema | undefined): PinAssociation[] {
  if (!sym) return [];
  const pins = sheet.pins.filter((p) => p.blockId === sym.id);
  const out: PinAssociation[] = [];
  for (const side of ["left", "right"] as const) {
    const drawn = pins.filter((p) => p.side === side).sort((a, b) => a.pinIndex - b.pinIndex);
    const manual = side === "left" ? schema?.symbol.inputs ?? [] : schema?.symbol.outputs ?? [];
    let basis: string;
    let ok = false;
    if (!schema) basis = "no manual schema";
    else if (sym.rotation !== 0) basis = `symbol rotated ${sym.rotation}; side order not comparable to the manual symbol`;
    else if (!manual.length) basis = `manual symbol prints no ${side === "left" ? "input" : "output"} labels`;
    else if (drawn.length !== manual.length) basis = `${drawn.length} drawn ${side} pin(s) vs ${manual.length} manual label(s) (${manual.join(",")}); not mapped`;
    else {
      ok = true;
      basis = `drawn ${side} pins in top-to-bottom order matched one-to-one to manual symbol labels ${manual.join(",")} (p.${schema.manual_page})`;
    }
    drawn.forEach((p, i) => {
      out.push({
        pin: p.pinName,
        side,
        label: ok ? manual[i] : null,
        evidence: ok ? "DERIVED" : "UNRESOLVED",
        basis,
        connected: p.connected,
        connection_ids: p.connectionIds,
      });
    });
  }
  return out;
}
