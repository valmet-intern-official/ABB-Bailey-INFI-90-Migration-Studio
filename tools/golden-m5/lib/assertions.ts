/**
 * Anti-hallucination assertions over one reconstructed sheet and its render.
 * Each assertion counts violations; any non-zero count fails the gate.
 */
import type { SymbolRegistry } from "../../../packages/cad-engine/src/lbr/library";
import type { RawCadRecord } from "../../../packages/cad-engine/src/records/decode";
import type { Item } from "../../../packages/cad-engine/src/reconstruct/render";
import type { DrawingSheet } from "../../../packages/cad-engine/src/reconstruct/types";

export interface AssertionResult { name: string; checked: number; violations: number; examples: string[] }

export function libraryOffsets(registry: SymbolRegistry, names: string[]): Map<string, Set<number>> {
  const m = new Map<string, Set<number>>();
  for (const n of names) {
    const s = registry.get(n);
    if (!s) continue;
    const set = m.get(s.library) ?? new Set<number>();
    for (const r of s.records) set.add(r.offset);
    m.set(s.library, set);
  }
  return m;
}

export function assertSheet(
  sheet: DrawingSheet,
  records: RawCadRecord[],
  items: Item[],
  libOffsets: Map<string, Set<number>>,
  libTexts: Set<string>,
  trailerFcs: Set<number>,
  allConnectors: Map<string, { sheet: string; tag: string | null }>,
  archiveSheets: Set<string>
): AssertionResult[] {
  const byOffset = new Map(records.map((r) => [r.offset, r]));
  const res = (name: string): AssertionResult => ({ name, checked: 0, violations: 0, examples: [] });
  const fail = (a: AssertionResult, msg: string) => { a.violations++; if (a.examples.length < 5) a.examples.push(msg); };

  const trace = res("every output item traces to a source or library record");
  const wires = res("every drawn wire/rule is a source type-1 record");
  const symbols = res("every drawn symbol glyph is a source symbol record");
  const texts = res("every drawn string exists in source, supporting library or trailer");
  for (const it of items) {
    trace.checked++;
    const [file, off] = it.src.split("@");
    let rec: RawCadRecord | undefined;
    if (file === sheet.file) {
      if (off === "name") { /* the file name itself */ }
      else { rec = byOffset.get(Number(off)); if (!rec) fail(trace, it.src); }
    } else if (!libOffsets.get(file)?.has(Number(off))) fail(trace, it.src);
    if (it.t !== "text" && /^(wire|rule)/.test(it.cls)) {
      wires.checked++;
      if (!rec || rec.type !== 1) fail(wires, `${it.cls} ${it.src}`);
    }
    if (it.t === "path" && /^(block fallback|connector|junction|pin)/.test(it.cls)) {
      symbols.checked++;
      if (!rec || rec.kind !== "symbol") fail(symbols, `${it.cls} ${it.src}`);
    }
    if (it.t === "text") {
      texts.checked++;
      const s = it.text;
      const ok =
        (file === sheet.file && off === "name" && s === sheet.file) ||
        (rec?.kind === "text" && rec.text === s) ||
        (rec?.kind === "symbol" &&
          (s === rec.symbolName ||
            s === rec.tag ||
            s === rec.reference ||
            s === String(rec.blockNumber) ||
            (/^\(\d+\)$/.test(s) && trailerFcs.has(Number(s.slice(1, -1)))) ||
            (rec.entries ?? []).some((e) => s === [e.reference, e.tag].filter(Boolean).join(" ")))) ||
        (file !== sheet.file && libTexts.has(s));
      if (!ok) fail(texts, `'${s}' ${it.src}`);
    }
  }

  const dest = res("no invented destination: every resolved partner exists with the same tag");
  const amb = res("ambiguous references stay ambiguous (no partner chosen)");
  const unres = res("unresolved references and wires remain traceable");
  for (const c of sheet.connectors) {
    const r = c.resolution;
    if (r.targetConnectorId) {
      dest.checked++;
      const t = allConnectors.get(r.targetConnectorId);
      if (!t || (r.targetSheet && !archiveSheets.has(r.targetSheet)) || (t.tag ?? "").replace(/\s+/g, " ").trim().toUpperCase() !== (c.tag ?? "").replace(/\s+/g, " ").trim().toUpperCase())
        fail(dest, `${c.id} -> ${r.targetConnectorId}`);
    }
    if (r.status === "AMBIGUOUS") {
      amb.checked++;
      if (r.targetConnectorId || r.relation !== "UNRESOLVED" || r.candidates.length === 0) fail(amb, c.id);
    }
    if (r.status === "UNRESOLVED") {
      unres.checked++;
      if (!byOffset.has(c.source.offset) || r.evidence.length === 0) fail(unres, c.id);
    }
  }
  for (const w of sheet.connections) {
    if (w.relationStatus !== "UNRESOLVED") continue;
    unres.checked++;
    if (!byOffset.has(w.source.offset)) fail(unres, w.id);
  }
  return [trace, wires, symbols, texts, dest, amb, unres];
}
