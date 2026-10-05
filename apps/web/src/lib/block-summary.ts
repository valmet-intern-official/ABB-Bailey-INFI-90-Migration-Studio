import { getFunctionCode } from "@infi90/function-codes";
import type { BlockSummary, BlockSummaryRow } from "@infi90/exporters";
import { loadCadLogic } from "@/lib/cad-logic-store";

export const BLOCK_SUMMARY_XLSX = "Block_Summary.xlsx";

/** Function blocks of every CAD sheet grouped by function code, named from the manual. */
export function loadBlockSummary(id: string): BlockSummary | null {
  const logic = loadCadLogic(id);
  if (!logic) return null;

  const groups = new Map<string, BlockSummaryRow & { bySheet: Map<string, number[]> }>();
  let totalBlocks = 0;
  for (const [file, blocks] of Object.entries(logic)) {
    for (const b of blocks) {
      totalBlocks++;
      const key = String(b.functionCode ?? "");
      let g = groups.get(key);
      if (!g) {
        const manual = b.functionCode != null ? getFunctionCode(b.functionCode) : undefined;
        const manualSymbol = manual?.symbol?.title && manual.symbol.title !== "-" ? manual.symbol.title : null;
        g = {
          functionCode: b.functionCode,
          name: manual?.name ?? b.name ?? "Function code not in the manual",
          symbol: b.symbol ?? manualSymbol,
          count: 0,
          sheets: [],
          bySheet: new Map(),
        };
        groups.set(key, g);
      }
      g.count++;
      const list = g.bySheet.get(file) ?? [];
      list.push(b.block);
      g.bySheet.set(file, list);
    }
  }

  const rows: BlockSummaryRow[] = [...groups.values()]
    .map(({ bySheet, ...row }) => ({
      ...row,
      sheets: [...bySheet]
        .map(([file, blocks]) => ({ file, blocks: blocks.sort((a, b) => a - b) }))
        .sort((a, b) => b.blocks.length - a.blocks.length || a.file.localeCompare(b.file)),
    }))
    .sort((a, b) => (a.functionCode ?? Number.MAX_SAFE_INTEGER) - (b.functionCode ?? Number.MAX_SAFE_INTEGER));

  return { totalBlocks, sheetCount: Object.keys(logic).length, rows };
}
