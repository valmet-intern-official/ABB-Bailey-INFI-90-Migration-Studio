import type { LoopDevice, LoopEndpoint, LoopRecord } from "./types";

/** The Loop List output columns, in order. */
export const LOOP_LIST_COLUMNS = [
  "$(PACKAGE)",
  "Process Area ID",
  "$(EXE)",
  "$(CTRLROOM)",
  "$(ALGROUP)",
  "$(NAME40_1)",
  "$(TAG)",
  "$(CARDTYPE1)",
  "$(DEVICETAG1)",
  "$(DEVICETAG1:MIN)",
  "$(DEVICETAG1:MAX)",
  "$(DEVICETAG1:UNIT)",
  "$(CARDTYPE2)",
  "$(DEVICETAG2)",
  "$(DEVICETAG2:MIN)",
  "$(DEVICETAG2:MAX)",
  "$(DEVICETAG2:UNIT)",
] as const;

/** One Loop List row: a loop tag with at most one device on each side. */
export interface LoopListRow {
  loop: LoopRecord;
  input?: LoopDevice;
  output?: LoopDevice;
}

/** Distinct devices that can fill one side of a loop (records sharing a tag count once). */
function sideDevices(l: LoopRecord, e: LoopEndpoint): LoopDevice[] {
  const seen = new Set<string>();
  const out: LoopDevice[] = [];
  for (const d of l.relatedDevices) {
    if (!e.candidates.includes(d.ioRecordId)) continue;
    const k = `${d.cardType}\u0000${d.deviceTag}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(d);
  }
  return out;
}

/**
 * Rows of one loop. A single device on a side is repeated on every row; when a
 * side has several devices each gets its own row. If both sides have several,
 * inputs and outputs get separate rows rather than being paired up.
 */
export function loopListRows(l: LoopRecord): LoopListRow[] {
  if (!l.loopTag) return [];
  const inputs = sideDevices(l, l.input);
  const outputs = sideDevices(l, l.output);
  if (inputs.length <= 1 && outputs.length <= 1) return [{ loop: l, input: inputs[0], output: outputs[0] }];
  if (outputs.length <= 1) return inputs.map((input) => ({ loop: l, input, output: outputs[0] }));
  if (inputs.length <= 1) return outputs.map((output) => ({ loop: l, input: inputs[0], output }));
  return [...inputs.map((input) => ({ loop: l, input })), ...outputs.map((output) => ({ loop: l, output }))];
}

/** Cell text of one row, aligned with `LOOP_LIST_COLUMNS`. */
export function loopListCells(r: LoopListRow): string[] {
  return [
    "",
    "",
    "",
    "",
    "",
    r.input?.description ?? "",
    r.loop.loopTag,
    r.input?.cardType ?? "",
    r.input?.deviceTag ?? "",
    "",
    "",
    "",
    r.output?.cardType ?? "",
    r.output?.deviceTag ?? "",
    "",
    "",
    "",
  ];
}
