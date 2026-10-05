import { KB } from "./generated/kb";
import type { FixedBlock, FunctionCodeSchema, ManualKnowledgeBase, ManualSpecification } from "./types";

export * from "./types";
export * from "./decode";

const byCode = new Map<number, FunctionCodeSchema>(KB.function_codes.map((s) => [s.function_code, s]));

export function knowledgeBase(): ManualKnowledgeBase {
  return KB;
}

export function getFunctionCode(fc: number): FunctionCodeSchema | undefined {
  return byCode.get(fc);
}

export function allFunctionCodes(): FunctionCodeSchema[] {
  return KB.function_codes;
}

export function getSpecification(fc: number, number: number): ManualSpecification | undefined {
  return byCode.get(fc)?.specifications.find((s) => s.number === number);
}

/**
 * Output offsets k the manual lists for a function code (`N` → 0, `N+k` → k),
 * sorted. Empty when the outputs table uses fixed addresses or is absent.
 */
export function outputOffsets(fc: number): number[] {
  const s = byCode.get(fc);
  if (!s) return [];
  const ks = s.outputs
    .map((o) => /^N(?:\s*\+\s*(\d+))?$/.exec(o.blk))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => (m[1] ? Number(m[1]) : 0));
  return [...new Set(ks)].sort((a, b) => a - b);
}

/**
 * Fixed block address from the manual's block address table. Only single
 * addresses are returned; the printed table is scoped to one controller type
 * (see `knowledgeBase().fixed_blocks.scope`).
 */
export function fixedBlock(address: number): FixedBlock | undefined {
  return KB.fixed_blocks?.blocks.find((b) => b.block_address === String(address));
}
