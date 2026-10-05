import fs from "node:fs";
import path from "node:path";
import type { CorrelatedProject } from "@infi90/core";
import { buildEngineeringPdf, runModule, type ExtractionResult } from "@infi90/fb-spec";

function listCads(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listCads(full));
    else if (/\.cad$/i.test(e.name)) out.push(full);
  }
  return out.sort();
}

export const CAD_LOGIC_FILE = "cad-logic.json";

export interface SheetLogicSpec {
  label: string;
  value: string | null;
  status: string;
  type: string;
  default: string;
  range: string;
  description: string;
  meaning: string | null;
}

export interface SheetLogicBlock {
  block: number;
  functionCode: number | null;
  name: string | null;
  symbol: string | null;
  status: string;
  specs: SheetLogicSpec[];
}

/** Blocks and S1…SN specifications per sheet, keyed by upper-case CAD file name. */
export type CadLogic = Record<string, SheetLogicBlock[]>;

function cadLogic(result: ExtractionResult): CadLogic {
  const specsOf = new Map<string, ExtractionResult["specifications"]>();
  for (const s of result.specifications) {
    if (!specsOf.has(s.block_id)) specsOf.set(s.block_id, []);
    specsOf.get(s.block_id)!.push(s);
  }
  const out: CadLogic = {};
  for (const b of [...result.blocks].sort((x, y) => x.block_address - y.block_address)) {
    const key = b.file.toUpperCase();
    (out[key] ??= []).push({
      block: b.block_address,
      functionCode: b.function_code,
      name: b.name,
      symbol: b.symbol_name,
      status: b.status,
      specs: (specsOf.get(b.id) ?? [])
        .sort((x, y) => x.spec_number - y.spec_number)
        .map((s) => ({
          label: s.label,
          value: s.raw_value_text,
          status: s.status,
          type: s.type,
          default: s.default,
          range: s.range,
          description: s.manual_description,
          meaning: s.enumeration_meaning,
        })),
    });
  }
  return out;
}

/**
 * CAD PDF with function-block specifications: each drawing page is marked
 * with its blocks and followed by the S1…SN schedule, connections and source
 * traceability of every block on that sheet. The same schedule is written as
 * JSON for the viewer.
 */
export function writeCadSpecPdf(project: CorrelatedProject, extractDir: string, outFile: string) {
  const files = listCads(extractDir);
  if (!files.length) return false;
  const moduleName = project.meta.module || project.meta.name;
  const cads = files.map((f) => ({ name: path.basename(f), data: fs.readFileSync(f) }));
  const { result, reconstructed } = runModule({ module: moduleName, cads, extractDir });
  fs.writeFileSync(path.join(path.dirname(outFile), CAD_LOGIC_FILE), JSON.stringify(cadLogic(result)));
  const { pdf } = buildEngineeringPdf(
    result,
    reconstructed.sheets.map((s) => ({ file: s.filename, items: s.items })),
    "marked",
    `${moduleName} CAD LOGIC`
  );
  fs.writeFileSync(outFile, pdf);
  return true;
}
