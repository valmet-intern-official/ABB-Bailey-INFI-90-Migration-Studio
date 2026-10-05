/**
 * Terminal resolution: which drawn pin carries which manual label (S1, S5,
 * N, N+1, …), and where each label's terminal sits.
 *
 * The function-block glyph library is not supplied, so the CAD has no pin
 * labels. Evidence, strongest first:
 *
 *  WIRE_SPEC_MATCH (EXPLICIT) — a wire joins output pin D of block A to
 *    input pin P of block B, and exactly one block-address spec of B holds a
 *    value A+k that is an output of A. Then P carries that spec's label and D
 *    is output N+k of A. Both facts come from CAD bytes (wire geometry and
 *    trailer values); the manual only says which specs are block addresses.
 *
 *  TEMPLATE_FROM_EXPLICIT (DERIVED) — pins are fixed relative to the symbol
 *    insertion point, so a label proven on one instance of a symbol (same
 *    name and extent) holds at the same offset on every instance.
 *
 *  EXACT_PIN_COUNT (DERIVED) — the drawn pins on a side are exactly as many
 *    as the manual symbol prints on that side; matched in top-to-bottom order.
 *
 *  PITCH_SLOT (INFERRED) — output slot i is anchor − i·pitch. The anchor is
 *    the unique one that lands every witnessed pin on a manual output row
 *    and keeps every row, including an unwired one, inside the symbol bbox.
 *    Input slot i lies at insertion-row offset −i·pitch. Pitches come from
 *    the symbol's own witnessed pins (or the module's dominant pitch).
 *    Every PITCH_SLOT placement is re-checked against WIRE_SPEC_MATCH
 *    evidence and the agreement rate is reported; a symbol whose witnessed
 *    pins do not fit one such grid gets no PITCH_SLOT labels.
 *
 *  GLYPH_PITCH (INFERRED) — the symbol has no witnessed pin (nothing is
 *    wired to it). Rows use the module pin pitch, and the top row sits
 *    GLYPH_TOP_INSET source units below the symbol bbox top — the inset
 *    measured on wired symbols of this corpus. Used only when every row
 *    falls inside that bbox. Otherwise the rows stay unplaced.
 */
import type { ReconstructModel, ReconstructedSheet, PinTemplate, PageTransform } from "@infi90/cad-engine";
import { pageTransform } from "@infi90/cad-engine";
import type { ExtractionResult, FunctionBlockRecord, SpecificationRecord } from "@infi90/fb-spec";
import { allFunctionCodes, getFunctionCode, outputOffsets, type FunctionCodeSchema } from "@infi90/function-codes";
import type { Status, Terminal, TerminalValidation, XY } from "./types";

type DrawingSheet = ReconstructModel.DrawingSheet;
type FunctionBlock = ReconstructModel.FunctionBlock;

export interface BlockTerminals {
  blockId: string;
  file: string;
  inputs: Terminal[];
  outputs: Terminal[];
  /** Drawn pins that no label claims. */
  unlabeled: Terminal[];
}

interface RelPin {
  relX: number;
  relY: number;
  witnesses: number;
  pinName: string | null;
  wired: boolean;
  wireIds: string[];
}

const keyOf = (b: FunctionBlock) => `${b.symbolName}|${b.sourceBBox.x2 - b.sourceBBox.x1}x${b.sourceBBox.y2 - b.sourceBBox.y1}`;

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));
const gcdAll = (xs: number[]) => xs.reduce((g, x) => gcd(g, Math.round(x)), 0);

function sideOf(b: FunctionBlock, x: number): "left" | "right" | null {
  const w = Math.max(1, b.sourceBBox.x2 - b.sourceBBox.x1);
  const f = (x - b.sourceBBox.x1) / w;
  return f <= 0.3 ? "left" : f >= 0.7 ? "right" : null;
}

/** Output labels a function code has, from the manual symbol, else from the outputs table. */
export function outputLabels(schema: FunctionCodeSchema | undefined, fc: number | null): string[] {
  if (schema?.symbol.outputs.length) return schema.symbol.outputs;
  if (fc == null) return [];
  return outputOffsets(fc).map((k) => (k ? `N+${k}` : "N"));
}

/**
 * Output blocks owned by a function block. Most FCs number outputs N+k; the
 * executive FCs (81, 90) number them absolutely (FC81: 0-14 with 0-9 the
 * module's fixed constants), so only absolute rows at or above the block's own
 * address belong to it.
 */
export function outputRows(schema: FunctionCodeSchema | undefined, fc: number | null, address: number): Array<{ label: string; offset: number; row: FunctionCodeSchema["outputs"][number] | undefined; basis: "relative" | "absolute" }> {
  const rel = outputLabels(schema, fc);
  if (rel.length) {
    return rel.flatMap((label) => {
      const k = labelOffset(label);
      return k == null ? [] : [{ label, offset: k, row: schema?.outputs.find((o) => o.blk.replace(/\s+/g, "") === label), basis: "relative" as const }];
    });
  }
  const abs = (schema?.outputs ?? []).filter((o) => /^\d+$/.test(o.blk.trim()));
  if (!abs.length || abs.length !== schema!.outputs.length) return [];
  return abs
    .filter((o) => Number(o.blk) >= address)
    .map((o) => {
      const k = Number(o.blk) - address;
      return { label: k ? `N+${k}` : "N", offset: k, row: o, basis: "absolute" as const };
    });
}

const labelOffset = (l: string) => {
  const m = /^N(?:\+(\d+))?$/.exec(l);
  return m ? (m[1] ? Number(m[1]) : 0) : null;
};

export function resolveTerminals(
  sheets: ReconstructedSheet[],
  fb: ExtractionResult,
  templates: Map<string, PinTemplate>,
  pageOf: Map<string, number>
): { byBlock: Map<string, BlockTerminals>; validation: TerminalValidation } {
  const recByKey = new Map<string, FunctionBlockRecord>(fb.blocks.map((b) => [`${b.file}#${b.block_address}`, b]));
  const specsByBlock = new Map<string, SpecificationRecord[]>();
  for (const s of fb.specifications) specsByBlock.set(s.block_id, [...(specsByBlock.get(s.block_id) ?? []), s]);

  // ---- module-wide dominant pitches
  const leftP = new Map<number, number>();
  const rightP = new Map<number, number>();
  for (const t of templates.values()) {
    const xs = t.pins.map((p) => p.relX);
    if (!xs.length) continue;
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    for (const [side, acc, x0] of [["L", leftP, minX], ["R", rightP, maxX]] as const) {
      void side;
      const ys = [...new Set(t.pins.filter((p) => p.relX === x0).map((p) => p.relY))].sort((a, b) => b - a);
      if (ys.length < 2) continue;
      const g = gcdAll(ys.slice(1).map((y, i) => ys[i] - y));
      if (g >= 10) acc.set(g, (acc.get(g) ?? 0) + 1);
    }
  }
  const mode = (m: Map<number, number>) => [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const moduleLeftPitch = mode(leftP);
  const moduleRightPitch = mode(rightP);

  // ---- instance context
  interface Ctx {
    sheet: DrawingSheet;
    tf: PageTransform;
    b: FunctionBlock;
    rec: FunctionBlockRecord | undefined;
    schema: FunctionCodeSchema | undefined;
    pins: RelPin[];
  }
  const ctxs: Ctx[] = [];
  for (const s of sheets) {
    const d = s.drawing;
    const tf = pageTransform(d);
    const pinsOf = new Map<string, ReconstructModel.FunctionPin[]>();
    for (const p of d.pins) pinsOf.set(p.blockId, [...(pinsOf.get(p.blockId) ?? []), p]);
    for (const b of d.functionBlocks) {
      const rec = b.blockNumber != null ? recByKey.get(`${d.file}#${b.blockNumber}`) : undefined;
      const fc = rec?.function_code ?? b.functionCode;
      const schema = fc != null ? getFunctionCode(fc) : undefined;
      const rel = new Map<string, RelPin>();
      for (const p of pinsOf.get(b.id) ?? []) {
        rel.set(`${p.relX},${p.relY}`, { relX: p.relX, relY: p.relY, witnesses: 0, pinName: p.pinName, wired: p.connected, wireIds: p.connectionIds });
      }
      for (const tp of templates.get(keyOf(b))?.pins ?? []) {
        const k = `${tp.relX},${tp.relY}`;
        const e = rel.get(k);
        if (e) e.witnesses = tp.witnesses;
        else rel.set(k, { relX: tp.relX, relY: tp.relY, witnesses: tp.witnesses, pinName: null, wired: false, wireIds: [] });
      }
      ctxs.push({ sheet: d, tf, b, rec, schema, pins: [...rel.values()] });
    }
  }
  const ctxById = new Map(ctxs.map((c) => [c.b.id, c]));

  // ---- pass 1: WIRE_SPEC_MATCH
  const explicitIn = new Map<string, Map<string, RelPin>>(); // blockId -> label -> pin
  const explicitOut = new Map<string, Map<string, RelPin>>();
  const keyLabelPos = new Map<string, Map<string, Set<string>>>(); // symbol key -> label -> rel positions
  const note = (blockId: string, side: "in" | "out", label: string, pin: RelPin) => {
    const m = side === "in" ? explicitIn : explicitOut;
    const mm = m.get(blockId) ?? new Map<string, RelPin>();
    mm.set(label, pin);
    m.set(blockId, mm);
    const c = ctxById.get(blockId)!;
    const k = keyOf(c.b);
    const km = keyLabelPos.get(k) ?? new Map<string, Set<string>>();
    const set = km.get(label) ?? new Set<string>();
    set.add(`${pin.relX},${pin.relY}`);
    km.set(label, set);
    keyLabelPos.set(k, km);
  };
  for (const s of sheets) {
    const d = s.drawing;
    const pinById = new Map(d.pins.map((p) => [p.id, p]));
    for (const net of d.nets) {
      const drivers = net.drivers.map((id) => pinById.get(id)).filter((p): p is ReconstructModel.FunctionPin => !!p);
      const sinks = net.sinks.map((id) => pinById.get(id)).filter((p): p is ReconstructModel.FunctionPin => !!p);
      for (const sp of sinks) {
        const B = ctxById.get(sp.blockId);
        if (!B?.rec || !B.schema || B.b.rotation !== 0) continue;
        const inputs = B.schema.symbol.inputs;
        const specs = (specsByBlock.get(B.rec.id) ?? []).filter((x) => x.is_block_address && x.status === "EXTRACTED" && x.actual_value != null && inputs.includes(x.label));
        for (const dp of drivers) {
          const A = ctxById.get(dp.blockId);
          if (!A?.rec || A.b.blockNumber == null) continue;
          const ks = A.rec.function_code != null ? outputOffsets(A.rec.function_code) : [];
          const offs = ks.length ? ks : [0];
          const hits = specs.filter((x) => offs.includes(x.actual_value! - A.b.blockNumber!));
          if (hits.length !== 1) continue;
          const sinkPin = B.pins.find((p) => p.relX === sp.relX && p.relY === sp.relY)!;
          note(B.b.id, "in", hits[0].label, sinkPin);
          if (A.b.rotation === 0) {
            const k = hits[0].actual_value! - A.b.blockNumber!;
            const lab = k ? `N+${k}` : "N";
            const outs = outputLabels(A.schema, A.rec.function_code);
            const drvPin = A.pins.find((p) => p.relX === dp.relX && p.relY === dp.relY)!;
            if (outs.includes(lab)) note(A.b.id, "out", lab, drvPin);
          }
        }
      }
    }
  }

  // ---- pass 2: assign
  const byBlock = new Map<string, BlockTerminals>();
  const validation: TerminalValidation = { by_method: {}, pitch_slot_checked: 0, pitch_slot_agree: 0, pitch_slot_disagree: [], rotated_blocks_skipped: 0 };
  const count = (m: string) => (validation.by_method[m] = (validation.by_method[m] ?? 0) + 1);

  /** Output pin offsets witnessed on any instance of each symbol (name|size). */
  const symbolOutputPins = new Map<string, RelPin[]>();
  const symbolInputPins = new Map<string, RelPin[]>();
  // keyed by symbol name: one name is one vendor glyph, while source bbox sizes vary with text extents
  for (const c of ctxs) {
    const k = c.b.symbolName;
    symbolOutputPins.set(k, [...(symbolOutputPins.get(k) ?? []), ...c.pins.filter((p) => sideOf(c.b, c.b.insertion.x + p.relX) === "right")]);
    symbolInputPins.set(k, [...(symbolInputPins.get(k) ?? []), ...c.pins.filter((p) => sideOf(c.b, c.b.insertion.x + p.relX) === "left")]);
  }

  for (const c of ctxs) {
    const { b, tf, rec, schema } = c;
    const out: BlockTerminals = { blockId: b.id, file: c.sheet.file, inputs: [], outputs: [], unlabeled: [] };
    byBlock.set(b.id, out);
    const page = pageOf.get(c.sheet.file) ?? 0;
    void page;
    const P = (rx: number, ry: number): { s: XY; p: XY } => {
      const sx = b.insertion.x + rx, sy = b.insertion.y + ry;
      return { s: [sx, sy], p: [round(tf.x(sx)), round(tf.y(sy))] };
    };
    const left = c.pins.filter((p) => sideOf(b, b.insertion.x + p.relX) === "left").sort((a, z) => z.relY - a.relY);
    const right = c.pins.filter((p) => sideOf(b, b.insertion.x + p.relX) === "right").sort((a, z) => z.relY - a.relY);
    const claimed = new Set<RelPin>();
    const mk = (side: "input" | "output", label: string | null, slot: number | null, pin: RelPin | null, pos: { s: XY; p: XY } | null, association: Status, method: Terminal["association_method"], positionStatus: Status, basis: string): Terminal => {
      if (pin) claimed.add(pin);
      count(method);
      return {
        id: `${b.id}.${side === "input" ? "in" : "out"}.${label ?? pin?.pinName ?? `${pin?.relX},${pin?.relY}`}`,
        block_id: b.id,
        pin: pin?.pinName ?? (pin ? `T(${pin.relX},${pin.relY})` : null),
        side,
        label,
        slot_index: slot,
        source_xy: pos?.s ?? null,
        page_xy: pos?.p ?? null,
        wired: pin?.wired ?? false,
        wire_ids: pin?.wireIds ?? [],
        association,
        association_method: method,
        position_status: positionStatus,
        basis,
      };
    };
    const posStatus = (pin: RelPin | null): Status => (!pin ? "INFERRED" : pin.wired ? "EXPLICIT" : "DERIVED");

    if (!schema || b.rotation !== 0) {
      if (schema && b.rotation !== 0) validation.rotated_blocks_skipped++;
      for (const p of [...left, ...right]) {
        if (!p.pinName) continue;
        out.unlabeled.push(mk(left.includes(p) ? "input" : "output", null, null, p, P(p.relX, p.relY), "UNRESOLVED", "NONE", posStatus(p), !schema ? "no manual schema for this symbol" : `symbol rotated ${b.rotation}`));
      }
      continue;
    }

    const address = rec?.block_address ?? b.blockNumber;
    const outputLabelList = address != null ? outputRows(schema, rec?.function_code ?? b.functionCode, address).map((r) => r.label) : outputLabels(schema, rec?.function_code ?? b.functionCode);
    const sides: Array<{ side: "input" | "output"; labels: string[]; pins: RelPin[]; explicit: Map<string, RelPin> | undefined; modulePitch: number | null }> = [
      { side: "input", labels: schema.symbol.inputs, pins: left, explicit: explicitIn.get(b.id), modulePitch: moduleLeftPitch },
      { side: "output", labels: outputLabelList, pins: right, explicit: explicitOut.get(b.id), modulePitch: moduleRightPitch },
    ];
    const keyPos = keyLabelPos.get(keyOf(b));
    const bboxRelY: [number, number] = [Math.min(b.sourceBBox.y1, b.sourceBBox.y2) - b.insertion.y, Math.max(b.sourceBBox.y1, b.sourceBBox.y2) - b.insertion.y];
    const bboxRelX: [number, number] = [Math.min(b.sourceBBox.x1, b.sourceBBox.x2) - b.insertion.x, Math.max(b.sourceBBox.x1, b.sourceBBox.x2) - b.insertion.x];

    for (const sd of sides) {
      const list: Terminal[] = [];
      const slotPlan = pitchSlots(sd.side, sd.labels, sd.pins, sd.modulePitch, keyPos, (sd.side === "output" ? symbolOutputPins : symbolInputPins).get(b.symbolName), bboxRelY, sd.side === "input" ? manualInputMultiple(schema) : null, bboxRelX);
      sd.labels.forEach((label, i) => {
        const ex = sd.explicit?.get(label);
        if (ex) {
          list.push(mk(sd.side, label, i, ex, P(ex.relX, ex.relY), "EXPLICIT", "WIRE_SPEC_MATCH", posStatus(ex), "wire from the driving block's output to this pin; the only block-address spec whose CAD value names that output is " + label));
          // validate the pitch convention against explicit evidence
          const plan = slotPlan.plan?.get(label);
          if (plan) {
            validation.pitch_slot_checked++;
            if (plan.relX === ex.relX && plan.relY === ex.relY) validation.pitch_slot_agree++;
            else validation.pitch_slot_disagree.push({ block: b.id, label, explicit_pin: `${ex.relX},${ex.relY}`, inferred_pin: `${plan.relX},${plan.relY}` });
          }
          return;
        }
        const tp = keyPos?.get(label);
        if (tp && tp.size === 1) {
          const [rx, ry] = [...tp][0].split(",").map(Number);
          const pin = sd.pins.find((p) => p.relX === rx && p.relY === ry) ?? null;
          list.push(mk(sd.side, label, i, pin, P(rx, ry), "DERIVED", "TEMPLATE_FROM_EXPLICIT", posStatus(pin), `${label} proven by wire/spec match on another instance of ${b.symbolName} at offset (${rx},${ry})`));
          return;
        }
        if (tp && tp.size > 1) {
          list.push(mk(sd.side, label, i, null, null, "CONFLICT", "NONE", "UNRESOLVED", `instances of ${b.symbolName} prove ${label} at different offsets: ${[...tp].join(" | ")}`));
          return;
        }
        const drawn = sd.pins.filter((p) => p.pinName);
        if (drawn.length === sd.labels.length && drawn.length > 0) {
          const pin = drawn[i];
          list.push(mk(sd.side, label, i, pin, P(pin.relX, pin.relY), "DERIVED", "EXACT_PIN_COUNT", posStatus(pin), `${drawn.length} drawn ${sd.side} pins matched one-to-one, top to bottom, to manual labels ${sd.labels.join(",")} (p.${schema.manual_page})`));
          return;
        }
        const plan = slotPlan.plan?.get(label);
        if (plan) {
          const pin = sd.pins.find((p) => p.relX === plan.relX && p.relY === plan.relY) ?? null;
          list.push(mk(sd.side, label, i, pin, P(plan.relX, plan.relY), "INFERRED", slotPlan.method, pin ? posStatus(pin) : "INFERRED", slotPlan.basis));
          return;
        }
        list.push(mk(sd.side, label, i, null, null, "UNRESOLVED", "NONE", "UNRESOLVED", slotPlan.basis));
      });
      if (sd.side === "input") out.inputs = list;
      else out.outputs = list;
    }
    for (const p of [...left, ...right]) {
      if (claimed.has(p) || !p.pinName) continue;
      out.unlabeled.push(mk(left.includes(p) ? "input" : "output", null, null, p, P(p.relX, p.relY), "UNRESOLVED", "NONE", posStatus(p), "drawn pin not claimed by any manual label"));
    }
  }
  return { byBlock, validation };
}

const sLabelYs = (schema: FunctionCodeSchema) =>
  schema.symbol.items.filter((i) => /^S\d+$/.test(i.s.replace(/\s+/g, ""))).map((i) => i.y).sort((a, b) => b - a);

/** Standard manual pin spacing (pt): the most common adjacent S-label spacing over all manual symbols. */
let standardSpacing: number | null | undefined;
function manualStandardSpacing(): number | null {
  if (standardSpacing !== undefined) return standardSpacing;
  const hist = new Map<number, number>();
  for (const s of allFunctionCodes()) {
    const ys = sLabelYs(s);
    for (let i = 1; i < ys.length; i++) {
      const d = Math.round((ys[i - 1] - ys[i]) * 2) / 2;
      if (d > 3) hist.set(d, (hist.get(d) ?? 0) + 1);
    }
  }
  standardSpacing = hist.size ? [...hist].sort((a, b) => b[1] - a[1])[0][0] : null;
  return standardSpacing;
}

/** Input spacing of a manual symbol as a whole multiple of the standard spacing, when uniform. */
export function manualInputMultiple(schema: FunctionCodeSchema): number | null {
  const std = manualStandardSpacing();
  const ys = sLabelYs(schema);
  if (!std || ys.length < 2) return null;
  const ratios = ys.slice(1).map((y, i) => (ys[i] - y) / std);
  const k = Math.round(ratios[0]);
  return k >= 1 && ratios.every((r) => Math.abs(r - k) < 0.2) ? k : null;
}

/** Modal gap, on wired symbols, from the bbox top down to the top pin. */
const GLYPH_TOP_INSET = 25;

type SlotMethod = "PITCH_SLOT" | "GLYPH_PITCH";
type SlotPlan = { plan: Map<string, { relX: number; relY: number }> | null; basis: string; method: SlotMethod };

/**
 * The one anchor that puts every witnessed output row on a manual label and
 * keeps every label, wired or not, inside the symbol bbox. Null when zero
 * or several anchors satisfy that.
 */
function uniqueOutputAnchor(labels: string[], ys: number[], pitch: number, bboxRelY?: [number, number]): { anchor: number; basis: string } | null {
  if (!labels.length || !ys.length || pitch < 10) return null;
  const anchors = new Set<number>();
  for (const y of ys) for (let i = 0; i < labels.length; i++) anchors.add(y + i * pitch);
  const fits: number[] = [];
  for (const anchor of anchors) {
    const onSlot = ys.every((y) => {
      const i = Math.round((anchor - y) / pitch);
      return Math.abs(anchor - i * pitch - y) < 0.01 && i >= 0 && i < labels.length;
    });
    if (!onSlot) continue;
    const inside = !bboxRelY || labels.every((_, i) => {
      const ry = anchor - i * pitch;
      return ry >= bboxRelY[0] - 2 && ry <= bboxRelY[1] + 2;
    });
    if (inside) fits.push(anchor);
  }
  if (fits.length !== 1) return null;
  return {
    anchor: fits[0],
    basis: `PITCH_SLOT: ${ys.length} witnessed output rows align uniquely with ${labels.length} manual outputs at pitch ${pitch}, and every output row lies inside the symbol bbox`,
  };
}

/** PITCH_SLOT plan for one side of a symbol, or the reason there is none. */
function pitchSlots(
  side: "input" | "output",
  labels: string[],
  pins: RelPin[],
  modulePitch: number | null,
  keyPos: Map<string, Set<string>> | undefined,
  symbolPins?: RelPin[],
  /** Symbol source bbox, vertical extent relative to the insertion [low, high]. */
  bboxRelY?: [number, number],
  /** Manual symbol input spacing as a whole multiple of the manual's standard pin spacing. */
  manualMultiple?: number | null,
  /** Symbol source bbox, horizontal extent relative to the insertion [left, right]. */
  bboxRelX?: [number, number]
): SlotPlan {
  const none = (basis: string): SlotPlan => ({ plan: null, basis, method: "PITCH_SLOT" });
  if (!labels.length) return none(`manual symbol prints no ${side} labels`);
  const xs = pins.map((p) => p.relX);
  if (!xs.length) {
    if (side !== "output" || !modulePitch || !bboxRelY || !bboxRelX) return none(`no ${side} pin witnessed on any instance; slot positions unknown`);
    const top = bboxRelY[1] - GLYPH_TOP_INSET;
    const rows = labels.map((_, i) => top - i * modulePitch);
    if (rows.some((y) => y < bboxRelY[0] - 2 || y > bboxRelY[1] + 2)) {
      return none(`no witnessed output pin; ${labels.length} rows at module pitch ${modulePitch}, inset ${GLYPH_TOP_INSET} from the symbol top, do not fit the source bbox`);
    }
    const plan = new Map<string, { relX: number; relY: number }>();
    labels.forEach((l, i) => plan.set(l, { relX: bboxRelX[1], relY: rows[i] }));
    return {
      plan,
      method: "GLYPH_PITCH",
      basis: `GLYPH_PITCH: no wire witnesses this symbol; ${labels.length} manual outputs at module pin pitch ${modulePitch}, top row ${GLYPH_TOP_INSET} below the symbol bbox top (inset measured on wired symbols)`,
    };
  }
  const relX = side === "input" ? Math.min(...xs) : Math.max(...xs);
  const ys = [...new Set(pins.filter((p) => p.relX === relX).map((p) => p.relY))].sort((a, b) => b - a);
  // pitch from rows witnessed on any instance of this symbol (same glyph geometry)
  // Inputs: pitch from rows witnessed on any instance (same glyph). Outputs: from this instance only,
  // since output rows need not be evenly spaced; every witnessed row must still fit the grid below.
  const allYs = [...new Set([...ys, ...(symbolPins ?? []).filter((p) => p.relX === relX).map((p) => p.relY)])].sort((a, b) => b - a);
  const pitchYs = side === "input" ? allYs : ys;
  let pitch = pitchYs.length >= 2 ? gcdAll(pitchYs.slice(1).map((y, i) => pitchYs[i] - y)) : modulePitch ?? 0;
  if (pitch < 10) pitch = modulePitch ?? 0;
  if (!pitch) return none(`${side} pitch not determinable`);
  let pitchBasis = pitchYs.length >= 2 ? `rows witnessed on ${side === "input" ? "instances of this symbol" : "this instance"} (${pitchYs.join(",")})` : "module dominant pitch";
  if (side === "input" && modulePitch && pitch > modulePitch && pitch % modulePitch === 0) {
    // Witnessed spacing is a multiple of the module pitch: an unwired row may sit between.
    // Accept a reading only if exactly one keeps every slot inside the symbol's source bbox.
    const top = Math.max(...ys);
    const fits = [pitch, modulePitch].filter((p) => !bboxRelY || top - (labels.length - 1) * p >= bboxRelY[0]);
    const byManual = manualMultiple != null ? fits.find((p) => p === manualMultiple * modulePitch) : undefined;
    if (byManual != null) {
      pitch = byManual;
      pitchBasis = `manual symbol spaces inputs at ${manualMultiple}x the standard pin pitch, so ${byManual} (witnessed spacing ${allYs.join(",")})`;
    } else if (fits.length === 1) {
      pitch = fits[0];
      pitchBasis = `${pitch === modulePitch ? "module" : "witnessed"} pitch; the other reading would put slots outside the symbol's source bbox`;
    } else {
      return none(`input pitch ambiguous: witnessed spacing ${pitch} and module pitch ${modulePitch} both ${fits.length ? "fit" : "fail"} the symbol extent, and the manual symbol spacing does not decide`);
    }
  }
  let anchor: number;
  let anchorBasis: string;
  if (side === "input") {
    const topAll = allYs[0], botAll = allYs[allYs.length - 1];
    if (topAll > 0) {
      // inputs start above the insertion row: accepted only when witnessed rows pin both ends
      const slots = (topAll - botAll) / pitch + 1;
      if (slots !== labels.length) return none(`inputs start above the insertion row (top witnessed relY ${topAll}); witnessed rows ${topAll}..${botAll} span ${slots} slots at pitch ${pitch}, manual has ${labels.length} labels, so the first input row is not determinable`);
      anchor = topAll;
      anchorBasis = `rows witnessed on instances of this symbol span exactly ${labels.length} slots (${topAll}..${botAll})`;
    } else {
      anchor = 0;
      anchorBasis = "first input slot on the insertion row";
    }
  } else {
    const fit = uniqueOutputAnchor(labels, ys, pitch, bboxRelY);
    if (fit) {
      const plan = new Map<string, { relX: number; relY: number }>();
      labels.forEach((l, i) => plan.set(l, { relX, relY: fit.anchor - i * pitch }));
      return { plan, method: "PITCH_SLOT", basis: fit.basis };
    }
    // anchor N from any proven output label of this symbol, else the top witnessed output row
    const proven = keyPos ? [...keyPos].filter(([l, s]) => labels.includes(l) && s.size === 1) : [];
    if (proven.length) {
      const [l, s] = proven[0];
      const ry = Number([...s][0].split(",")[1]);
      anchor = ry + labels.indexOf(l) * pitch;
      anchorBasis = `top output row from proven ${l} at relY ${ry} (manual top-down order ${labels.join(",")})`;
    } else {
      anchor = Math.max(...ys, ...(symbolPins ?? []).filter((p) => p.relX === relX).map((p) => p.relY));
      if (anchor < 0) return none(`top output row witnessed on any instance is relY ${anchor}, below the insertion row; the first manual output (${labels[0]}) may sit on an unwitnessed row above, so output rows are not determinable`);
      anchorBasis = `first manual output (${labels[0]}) on the top output row witnessed on any instance of this symbol`;
    }
  }
  for (const y of allYs) {
    const i = (anchor - y) / pitch;
    if (!Number.isInteger(i) || i < 0 || i >= labels.length) {
      return none(`witnessed ${side} row relY ${y} does not fit pitch ${pitch} from ${anchorBasis} over ${labels.length} labels`);
    }
  }
  // Output rows of vendor symbols are not always evenly spaced, so output slots are
  // only placed within the span of rows witnessed on some instance of the symbol.
  const spanYs = [...ys, ...(symbolPins ?? []).filter((p) => p.relX === relX).map((p) => p.relY)];
  const [loY, hiY] = [Math.min(...spanYs), Math.max(...spanYs)];
  const plan = new Map<string, { relX: number; relY: number }>();
  labels.forEach((l, i) => {
    const relY = anchor - i * pitch;
    if (side === "output" && (relY < loY || relY > hiY)) return;
    plan.set(l, { relX, relY });
  });
  return { plan, method: "PITCH_SLOT", basis: `PITCH_SLOT: ${side} slot i (manual top-down order) at relY ${anchor} − i·${pitch} (${anchorBasis}; pitch from ${pitchBasis}), relX ${relX}${side === "output" ? `; output slots outside the rows witnessed on any instance of this symbol (${hiY}..${loY}) left unplaced` : ""}` };
}

const round = (v: number) => Math.round(v * 100) / 100;
