/**
 * Output tree for one module:
 *   decoded/   function_blocks.json|csv, specifications.json|csv,
 *              logic_connections.json, manual_function_codes.json,
 *              source_traceability.json
 *   reports/   function_block_report.pdf, unresolved_items.json,
 *              validation_report.json
 *   graphics/  <module>_ENGINEERING.pdf, <module>_ENGINEERING_MARKED.pdf,
 *              original/<sheet>.svg, marked/<sheet>.svg
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { toSvg } from "@infi90/cad-engine";
import { knowledgeBase } from "@infi90/function-codes";
import { buildEngineeringPdf, buildTextReportPdf, type LayoutReport, type SheetDrawing } from "./engineering";
import type { ExtractionResult } from "./types";
import { validateResult, type ValidationOptions, type ValidationReport } from "./validate";

export interface WriteOutputsOptions {
  outDir: string;
  /** Reconstructed drawing display lists, by sheet file. */
  drawings: SheetDrawing[];
  validation?: Omit<ValidationOptions, "layout">;
}

export interface WriteOutputsResult {
  files: string[];
  layout: LayoutReport[];
  validation: ValidationReport;
}

const csvCell = (v: unknown) => {
  if (v == null) return "";
  const s = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (header: string[], rows: unknown[][]) => [header.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n") + "\r\n";

/** Serialized decoded output used for determinism checks. */
export function decodedFingerprint(r: ExtractionResult): string {
  return crypto.createHash("sha256").update(JSON.stringify(r)).digest("hex");
}

export function writeOutputs(result: ExtractionResult, opts: WriteOutputsOptions): WriteOutputsResult {
  const files: string[] = [];
  const dirs = { decoded: path.join(opts.outDir, "decoded"), reports: path.join(opts.outDir, "reports"), graphics: path.join(opts.outDir, "graphics") };
  for (const d of [...Object.values(dirs), path.join(dirs.graphics, "original"), path.join(dirs.graphics, "marked")]) fs.mkdirSync(d, { recursive: true });
  const write = (p: string, data: string | Buffer) => {
    fs.writeFileSync(p, data);
    files.push(path.relative(opts.outDir, p).replace(/\\/g, "/"));
  };
  const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

  // ---------------------------------------------------------------- decoded
  write(path.join(dirs.decoded, "function_blocks.json"), json({ module: result.module, manual: result.manual, sheets: result.sheets, blocks: result.blocks }));
  write(
    path.join(dirs.decoded, "function_blocks.csv"),
    toCsv(
      ["id", "file", "page", "block_address", "function_code", "name", "symbol_name", "drawn", "status", "layout_status", "segment_block", "segment_evidence", "module", "module_type", "drawing_number", "spec_count", "expected_bytes", "actual_bytes", "payload_hex", "bbox", "entity_ids", "manual_page", "diagnostics"],
      result.blocks.map((b) => [b.id, b.file, b.page, b.block_address, b.function_code, b.name, b.symbol_name, b.drawn, b.status, b.layout_status, b.segment.segment_block, b.segment.evidence, b.module.module, b.module.module_type, b.drawing.drawing_number, b.spec_ids.length, b.expected_bytes, b.actual_bytes, b.payload_hex, b.source.bbox?.join(" "), b.source.entity_ids.join(" "), b.manual_page, b.diagnostics.join(" | ")])
    )
  );
  write(path.join(dirs.decoded, "specifications.json"), json({ module: result.module.module, specifications: result.specifications }));
  write(
    path.join(dirs.decoded, "specifications.csv"),
    toCsv(
      ["id", "file", "page", "block_address", "function_code", "spec", "raw_value_text", "raw_hex", "actual_value", "normalized_value", "type", "default", "tune", "range", "manual_description", "enumeration_meaning", "status", "address_status", "address_value", "address_target_block", "address_target_output", "address_evidence", "address_note", "pin", "pin_evidence", "wired_from", "byte_offset", "byte_length", "manual_page", "manual_section", "extraction_method"],
      result.specifications.map((s) => [
        s.id, s.source.file, s.source.page, s.block_address, s.function_code, s.label, s.raw_value_text, s.raw_hex, s.actual_value, s.normalized_value, s.type, s.default, s.tune_raw, s.range, s.manual_description, s.enumeration_meaning, s.status,
        s.address_resolution?.status, s.address_resolution?.address, s.address_resolution?.target_block, s.address_resolution?.target_output, s.address_resolution?.evidence, s.address_resolution?.note,
        s.pin?.pin, s.pin?.evidence, s.wired_from.map((w) => `${w.source_block ?? "?"}${w.source_address != null ? `@${w.source_address}` : ""}`).join(" "), s.source.byte_offset, s.source.byte_length, s.manual_page, s.manual_section, s.extraction_method,
      ])
    )
  );
  write(path.join(dirs.decoded, "logic_connections.json"), json({ module: result.module.module, connections: result.connections }));
  write(path.join(dirs.decoded, "manual_function_codes.json"), json(knowledgeBase()));
  write(
    path.join(dirs.decoded, "source_traceability.json"),
    json({
      module: result.module.module,
      manual: result.manual,
      sheets: result.sheets.map((s) => ({ file: s.file, page: s.page, sha256: s.sha256 })),
      blocks: result.blocks.map((b) => ({ id: b.id, file: b.file, page: b.page, bbox: b.source.bbox, source_bbox: b.source.source_bbox, entity_ids: b.source.entity_ids, manual_page: b.manual_page, manual_section: b.manual_section })),
      specifications: result.specifications.map((s) => ({
        id: s.id,
        file: s.source.file,
        page: s.source.page,
        byte_offset: s.source.byte_offset,
        byte_length: s.source.byte_length,
        raw_hex: s.raw_hex,
        entity_ids: s.source.entity_ids,
        manual_page: s.manual_page,
        manual_section: s.manual_section,
        extraction_method: s.extraction_method,
        association: s.association,
      })),
      connections: result.connections.map((c) => ({ id: c.id, kind: c.kind, status: c.status, source_entity_ids: c.source_entity_ids })),
    })
  );

  // --------------------------------------------------------------- graphics
  const name = result.module.module;
  const plain = buildEngineeringPdf(result, opts.drawings, "plain", `${name} ENGINEERING`);
  write(path.join(dirs.graphics, `${name}_ENGINEERING.pdf`), plain.pdf);
  const marked = buildEngineeringPdf(result, opts.drawings, "marked", `${name} ENGINEERING MARKED`);
  write(path.join(dirs.graphics, `${name}_ENGINEERING_MARKED.pdf`), marked.pdf);
  for (const d of opts.drawings) {
    const stem = d.file.replace(/\.CAD$/i, "");
    write(path.join(dirs.graphics, "original", `${stem}.svg`), toSvg(d.items, d.file));
    const page = marked.pages.find((p) => p.label === d.file);
    if (page) write(path.join(dirs.graphics, "marked", `${stem}.svg`), toSvg(page.items.filter((it) => it.cls !== "footer"), `${d.file} (marked)`));
  }

  // ---------------------------------------------------------------- reports
  const layout = [plain.report, marked.report];
  const validation = validateResult(result, { ...opts.validation, layout });
  write(path.join(dirs.reports, "validation_report.json"), json({ ...validation, layout: layout.map((l) => ({ ...l, callouts_frame_only: l.callouts_frame_only.length })) }));
  const unresolved = {
    module: name,
    blocks: result.blocks.filter((b) => b.status !== "EXTRACTED").map((b) => ({ id: b.id, status: b.status, layout_status: b.layout_status, diagnostics: b.diagnostics })),
    specifications: result.specifications.filter((s) => s.status !== "EXTRACTED").map((s) => ({ id: s.id, status: s.status, diagnostics: s.diagnostics })),
    block_addresses: result.specifications
      .filter((s) => s.address_resolution?.status === "UNRESOLVED")
      .map((s) => ({ id: s.id, value: s.raw_value_text, note: s.address_resolution!.note, wired_from: s.wired_from })),
    pin_mappings: result.blocks.filter((b) => b.pins.some((p) => p.label == null)).map((b) => ({ id: b.id, basis: [...new Set(b.pins.map((p) => p.basis))] })),
    connections: result.connections.filter((c) => c.status === "UNRESOLVED").map((c) => ({ id: c.id, kind: c.kind, file: c.file, source_block: c.source_block, target_block: c.target_block, signal: c.signal, note: c.note })),
    unknown_function_codes: result.unknown_function_codes,
    callouts_frame_only: marked.report.callouts_frame_only,
    diagnostics: result.diagnostics.filter((d) => d.severity !== "info"),
  };
  write(path.join(dirs.reports, "unresolved_items.json"), json(unresolved));
  write(path.join(dirs.reports, "function_block_report.pdf"), buildTextReportPdf(`${name} FUNCTION BLOCK REPORT`, reportLines(result, validation, layout)));
  return { files, layout, validation };
}

function reportLines(r: ExtractionResult, v: ValidationReport, layout: LayoutReport[]) {
  const lines: Array<string | { text: string; heading?: boolean }> = [];
  const h = (text: string) => lines.push({ text, heading: true });
  const count = <T,>(xs: T[], k: (x: T) => string) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(k(x), (m.get(k(x)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([a, n]) => `${a} ${n}`).join(", ");
  };
  h(`${r.module.module} FUNCTION BLOCK REPORT`);
  lines.push(`module type ${r.module.module_type ?? "-"}; sheets ${r.sheets.length}; manual ${r.manual.document} (${r.manual.sha256.slice(0, 16)})`);
  lines.push(`blocks ${r.blocks.length}: ${count(r.blocks, (b) => b.status)}`);
  lines.push(`specifications ${r.specifications.length}: ${count(r.specifications, (s) => s.status)}`);
  lines.push(`block-address specs: ${count(r.specifications.filter((s) => s.address_resolution), (s) => s.address_resolution!.status)}`);
  lines.push(`pins: ${count(r.blocks.flatMap((b) => b.pins), (p) => p.evidence)}`);
  lines.push(`connections ${r.connections.length}: ${count(r.connections, (c) => `${c.kind}/${c.status}`)}`);
  lines.push(`function codes used: ${count(r.blocks.filter((b) => b.function_code != null), (b) => String(b.function_code).padStart(3, "0"))}`);
  h("VALIDATION");
  lines.push(`overall: ${v.passed ? "PASS" : "FAIL"}`);
  for (const c of v.checks) {
    lines.push(`${c.pass ? "PASS" : "FAIL"}  ${c.id}: ${c.name}${c.detail ? ` (${c.detail})` : ""}`);
    for (const f of c.failures ?? []) lines.push(`      ${f}`);
  }
  for (const [k, o] of Object.entries(v.oracle)) {
    h(`ORACLE ${k}`);
    for (const [kk, vv] of Object.entries(o as Record<string, unknown>)) {
      if (Array.isArray(vv)) {
        lines.push(`${kk}: ${vv.length} item(s)`);
        for (const x of vv.slice(0, 40)) lines.push(`      ${typeof x === "string" ? x : JSON.stringify(x)}`);
      } else lines.push(`${kk}: ${typeof vv === "object" ? JSON.stringify(vv) : String(vv)}`);
    }
  }
  h("LAYOUT");
  for (const l of layout) lines.push(`${l.mode}: ${l.pages} pages (${l.drawing_pages} drawings, ${l.schedule_pages} schedule); overlaps ${l.overlaps.length}; clipped ${l.clipped.length}; callouts ${l.callouts_placed} placed, ${l.callouts_frame_only.length} frame-only`);
  h("UNKNOWN FUNCTION CODES");
  if (!r.unknown_function_codes.length) lines.push("none");
  for (const u of r.unknown_function_codes) lines.push(`FC ${u.function_code}: blocks ${u.blocks.join(", ")} in ${u.files.join(", ")}`);
  h("DIAGNOSTICS (warnings and errors)");
  for (const d of r.diagnostics.filter((d) => d.severity !== "info")) lines.push(`${d.severity.toUpperCase()} ${d.code}${d.file ? ` ${d.file}` : ""}${d.block_address != null ? ` blk ${d.block_address}` : ""}${d.spec ? ` ${d.spec}` : ""}: ${d.message}`);
  return lines;
}
