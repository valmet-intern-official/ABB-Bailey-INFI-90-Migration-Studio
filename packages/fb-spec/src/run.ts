import { reconstructModule, type CadBuffer, type ReconstructModuleResult } from "@infi90/cad-engine";
import { extractModule } from "./extract";
import type { ExtractionResult } from "./types";

export interface RunModuleOptions {
  module: string;
  cads: CadBuffer[];
  extractDir?: string;
  librarySearchRoots?: string[];
  /** Reuse an existing reconstruction of the same CAD set. */
  reconstructed?: ReconstructModuleResult;
}

export interface RunModuleResult {
  result: ExtractionResult;
  reconstructed: ReconstructModuleResult;
}

/** Reconstruct the module's sheets (sorted by file name) and extract function-block specifications. */
export function runModule(opts: RunModuleOptions): RunModuleResult {
  const cads = opts.cads.filter((c) => /\.CAD$/i.test(c.name)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const reconstructed =
    opts.reconstructed ?? reconstructModule({ cads, extractDir: opts.extractDir, librarySearchRoots: opts.librarySearchRoots });
  const dataOf = new Map(cads.map((c) => [c.name, c.data]));
  const sheets = reconstructed.sheets
    .slice()
    .sort((a, b) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0))
    .map((s) => ({ drawing: s.drawing, data: dataOf.get(s.filename)! }))
    .filter((s) => s.data);
  const result = extractModule({ module: opts.module, moduleType: reconstructed.moduleHeader?.moduleType ?? null, sheets });
  return { result, reconstructed };
}
