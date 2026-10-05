/**
 * Source record stream -> typed DrawingSheet.
 *
 * Geometry is the source geometry, verbatim. Topology comes only from type 1
 * polyline vertices meeting symbols, junction symbols or other polylines at
 * source coordinates. Nothing is placed on a synthetic grid and nothing is
 * connected by reading order or proximity of labels.
 */
import crypto from "node:crypto";
import { readLibraryName } from "../binary/reader";
import type { SymbolRegistry } from "../lbr/library";
import { decodeRecordStream, type RawCadRecord } from "../records/decode";
import { decodeTrailer, specificationsByBlock } from "../records/trailer";
import { familyOf } from "./families";
import { expandSymbol } from "./libexpand";
import { FRAME_SYMBOLS, JUNCTION_SYMBOL, templateKey, type PinTemplate } from "./templates";
import type * as T from "./types";

/** Vertex-to-feature coincidence that counts as exact, in source units. */
export const EXACT_TOL = 3;
/** Near-miss tolerance: accepted as DERIVED and reported with its distance. */
export const NEAR_TOL = 15;
/** Only pins witnessed on at least this many instances enter a template. */
const TEMPLATE_MIN_WITNESSES = 2;

export interface ZoneGrid {
  /** Column origin and row origin relative to the frame insertion point. */
  dx: number;
  dy: number;
  pitch: number;
}

export interface BuildContext {
  registry: SymbolRegistry;
  templates: Map<string, PinTemplate>;
  zoneGrid: ZoneGrid | null;
  specNames?: Record<number, Record<string, string>>;
}

const hexOf = (r: RawCadRecord) => r.words.map((w) => (w & 0xff).toString(16).padStart(2, "0") + (w >> 8).toString(16).padStart(2, "0")).join("");
const srcRef = (file: string, r: RawCadRecord): T.SourceRef => ({ file, offset: r.offset, recordType: r.type, lengthBytes: r.lengthBytes });
const dist = (a: T.Pt, b: T.Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const inBox = (b: T.BBox, p: T.Pt, tol = 0) => p.x >= b.x1 - tol && p.x <= b.x2 + tol && p.y >= b.y1 - tol && p.y <= b.y2 + tol;
const boxDist = (b: T.BBox, p: T.Pt) => Math.hypot(Math.max(b.x1 - p.x, 0, p.x - b.x2), Math.max(b.y1 - p.y, 0, p.y - b.y2));
const area = (b: T.BBox) => (b.x2 - b.x1) * (b.y2 - b.y1);
const bboxOf = (r: RawCadRecord): T.BBox => ({ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 });

/** Distance from p to segment ab, and whether the foot is strictly interior. */
function segDist(p: T.Pt, a: T.Pt, b: T.Pt): { d: number; interior: boolean } {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return { d: dist(p, a), interior: false };
  const t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  const tc = Math.max(0, Math.min(1, t));
  const d = Math.hypot(p.x - (a.x + tc * vx), p.y - (a.y + tc * vy));
  const L = Math.sqrt(len2);
  return { d, interior: t * L > EXACT_TOL && (1 - t) * L > EXACT_TOL };
}

export function zoneOf(grid: ZoneGrid | null, frameIns: T.Pt | null, p: T.Pt): string | null {
  if (!grid || !frameIns) return null;
  const col = Math.floor((p.x - (frameIns.x + grid.dx)) / grid.pitch);
  const row = Math.floor((frameIns.y + grid.dy - p.y) / grid.pitch);
  if (col < 0 || row < 0 || col > 99 || row > 99) return null;
  return `${String(row).padStart(2, "0")}.${String(col).padStart(2, "0")}`;
}

export function lineTypeOf(style: number): T.Connection["lineType"] {
  return style === 0 ? "solid" : style === 1 ? "dashed" : style === 2 ? "long-dash" : "unknown";
}

export function buildDrawingSheet(buf: Buffer, file: string, ctx: BuildContext): T.DrawingSheet {
  const sheetId = file.replace(/\.CAD$/i, "").toUpperCase();
  const { records, clean, diagnostics } = decodeRecordStream(buf);
  const trailer = decodeTrailer(buf);
  const specs = specificationsByBlock(trailer);
  const diag: string[] = [...diagnostics, ...trailer.diagnostics];
  // FC 81 is stored under block 0 and drawn as the EX/… symbol at block 10.
  // The same one-to-one pairing fb-spec already applies.
  const drawnBlockNumbers = new Set(records.filter((r) => r.kind === "symbol" && r.blockNumber != null).map((r) => r.blockNumber!));
  const undrawnExecutive = [...specs.values()].filter((s) => s.functionCode === 81 && !drawnBlockNumbers.has(s.blockNumber));
  const orphanExecutive = records.filter(
    (r) => r.kind === "symbol" && r.symbolName && /^EX\//i.test(r.symbolName) && r.blockNumber != null && !specs.has(r.blockNumber)
  );
  const pairedExecutive = undrawnExecutive.length === 1 && orphanExecutive.length === 1 ? orphanExecutive[0].blockNumber! : null;
  let seq = 0;
  const nid = (p: string) => `${sheetId}:${p}${++seq}`;

  // ------------------------------------------------------------ frame
  const frameRec = records.find((r) => r.kind === "symbol" && r.symbolName === "DBORDH");
  const frameDef = frameRec ? ctx.registry.get("DBORDH") : undefined;
  const framePrims = frameRec && frameDef ? expandSymbol(ctx.registry, "DBORDH", frameRec.insertionX!, frameRec.insertionY!, frameRec.rotation ?? 0).primitives : [];
  const frame: T.DrawingFrame = {
    present: Boolean(frameRec),
    symbolName: frameRec?.symbolName ?? null,
    source: frameRec ? srcRef(file, frameRec) : null,
    bbox: frameRec ? bboxOf(frameRec) : null,
    insertion: frameRec ? { x: frameRec.insertionX!, y: frameRec.insertionY! } : null,
    library: frameDef?.library ?? null,
    libraryResolved: Boolean(frameDef),
    primitiveCount: framePrims.length,
    components: records
      .filter((r) => r.kind === "symbol" && r.symbolName && r !== frameRec && FRAME_SYMBOLS.has(r.symbolName))
      .map((r) => ({
        symbolName: r.symbolName!,
        source: srcRef(file, r),
        insertion: { x: r.insertionX!, y: r.insertionY! },
        bbox: bboxOf(r),
        rotation: r.rotation ?? 0,
        libraryResolved: ctx.registry.has(r.symbolName),
      })),
  };
  if (frameRec && !frameDef) diag.push("DBORDH frame symbol not found in any supplied library");
  const frameIns = frame.insertion;

  const gridMarks: T.GridMark[] = [];
  for (const p of framePrims) {
    if (p.kind !== "text" || p.symbol !== "DBORDH" || !/^\d{2}$/.test(p.text)) continue;
    gridMarks.push({
      axis: p.rotation === 90 || p.rotation === 270 ? "row" : "column",
      label: p.text,
      at: p.at,
      source: { file: p.library, offset: p.offset, recordType: 5, lengthBytes: 0, library: p.library },
    });
  }

  // Title block region: the nested TITLE and REV instances of the frame.
  let titleBox: T.BBox | null = null;
  if (frameRec && frameDef) {
    for (const r of frameDef.records) {
      if (r.kind !== "symbol" || (r.symbolName !== "TITLE" && r.symbolName !== "REV")) continue;
      const dx = frameRec.insertionX! - frameDef.insertionX;
      const dy = frameRec.insertionY! - frameDef.insertionY;
      const b = { x1: r.x1 + dx, y1: r.y1 + dy, x2: r.x2 + dx, y2: r.y2 + dy };
      titleBox = titleBox ? { x1: Math.min(titleBox.x1, b.x1), y1: Math.min(titleBox.y1, b.y1), x2: Math.max(titleBox.x2, b.x2), y2: Math.max(titleBox.y2, b.y2) } : b;
    }
  }
  // Field captions are the small layer-8 texts of the title and revision
  // symbols; customer and supplier names in the same symbols are content.
  const titleLabels = framePrims.filter(
    (p): p is Extract<typeof p, { kind: "text" }> =>
      p.kind === "text" && (p.symbol === "TITLE" || p.symbol === "REV") && p.layer === 8 && p.height <= 10 && /[A-Z]/.test(p.text)
  );

  // ------------------------------------------------------------ symbols
  const functionBlocks: T.FunctionBlock[] = [];
  const connectors: T.Connector[] = [];
  const junctions: T.Junction[] = [];
  const blockRec = new Map<string, RawCadRecord>();
  const templateFor = new Map<string, PinTemplate | undefined>();

  for (const r of records) {
    if (r.kind !== "symbol" || !r.symbolName) continue;
    const name = r.symbolName;
    if (FRAME_SYMBOLS.has(name)) continue;
    if (name === JUNCTION_SYMBOL) {
      junctions.push({ id: nid("J"), kind: "connected", at: { x: r.insertionX!, y: r.insertionY! }, status: "EXPLICIT", source: srcRef(file, r), connectionIds: [] });
      continue;
    }
    const tpl = ctx.templates.get(templateKey(r));
    if (name === "IREF" || name === "IREFO" || name === "OREF") {
      // IREFO has an input-shaped glyph but exports its net: the vendor's
      // I90XREF lists every IREFO as a cross-reference source (output).
      const kind = name === "IREF" ? "IREF" : "OREF";
      // The connection point is the template pin that most instances witness.
      const best = tpl?.pins.slice().sort((a, b) => b.witnesses - a.witnesses)[0];
      const cp = best ? { x: r.insertionX! + best.relX, y: r.insertionY! + best.relY } : null;
      const id = nid(kind === "IREF" ? "I" : "O");
      connectors.push({
        id,
        kind,
        source: srcRef(file, r),
        symbolName: name,
        tag: r.tag ?? null,
        tagRaw: r.tagRaw ?? null,
        reference: r.reference ?? null,
        sourceBBox: bboxOf(r),
        insertion: { x: r.insertionX!, y: r.insertionY! },
        connectionPoint: cp,
        connectionPointStatus: cp ? "DERIVED" : "UNRESOLVED",
        connectionIds: [],
        zone: zoneOf(ctx.zoneGrid, frameIns, cp ?? { x: r.insertionX!, y: r.insertionY! }),
        resolution: { status: "UNRESOLVED", relation: "UNRESOLVED", targetSheet: null, targetZone: null, targetConnectorId: null, candidates: [], evidence: [] },
        rawHex: hexOf(r),
      });
      blockRec.set(id, r);
      continue;
    }
    const lib = ctx.registry.get(name);
    const spec = r.blockNumber != null ? specs.get(r.blockNumber) : undefined;
    const paired = spec == null && r.blockNumber === pairedExecutive;
    const fam = familyOf(name);
    const id = nid("B");
    functionBlocks.push({
      id,
      source: srcRef(file, r),
      recordType: r.type,
      symbolName: name,
      functionCode: spec?.functionCode ?? (paired ? 81 : null),
      functionCodeStatus: spec ? "EXPLICIT" : paired ? "DERIVED" : "UNRESOLVED",
      blockNumber: r.blockNumber ?? null,
      family: fam,
      glyph: lib
        ? { status: "LIBRARY", family: fam, library: lib.library }
        : { status: "FALLBACK", family: fam, note: "symbol definition absent from every supplied .LBR; drawn at source bbox with source-derived pins" },
      sourceBBox: bboxOf(r),
      insertion: { x: r.insertionX!, y: r.insertionY! },
      rotation: r.rotation ?? 0,
      flags: r.flags ?? 0,
      layer: r.layer,
      pinIds: [],
      parameterIds: [],
      attachedTextIds: [],
      terminals: r.entries,
      reserved: r.reserved,
      rawHex: hexOf(r),
    });
    blockRec.set(id, r);
    templateFor.set(id, tpl);
  }

  // ------------------------------------------------------------ connections
  const polys = records.filter((r) => r.kind === "polyline" && r.points.length >= 2);
  const connections: T.Connection[] = polys.map((r) => {
    const first = r.points[0];
    const last = r.points[r.points.length - 1];
    const closed = r.points.length > 2 && first.x === last.x && first.y === last.y;
    return {
      id: nid("W"),
      source: srcRef(file, r),
      points: r.points.map((p) => ({ x: p.x, y: p.y })),
      style: r.style ?? 0,
      lineType: lineTypeOf(r.style ?? 0),
      layer: r.layer,
      from: { kind: "dangling", at: first, refId: null, status: "UNRESOLVED", distance: 0 },
      to: { kind: "dangling", at: last, refId: null, status: "UNRESOLVED", distance: 0 },
      netId: null,
      relationStatus: "UNRESOLVED",
      connectionType: closed || r.style === 2 ? "rule" : "signal",
    };
  });
  const signal = connections.filter((c) => c.connectionType === "signal");

  const classify = (self: T.Connection, p: T.Pt): T.Endpoint => {
    for (const j of junctions) {
      const d = dist(j.at, p);
      if (d <= EXACT_TOL) return { kind: "junction", at: p, refId: j.id, status: "EXPLICIT", distance: d };
    }
    for (const c of connectors) {
      if (c.connectionPoint && dist(c.connectionPoint, p) <= EXACT_TOL)
        return { kind: "connector", at: p, refId: c.id, status: "EXPLICIT", distance: dist(c.connectionPoint, p) };
    }
    const containing = functionBlocks.filter((b) => inBox(b.sourceBBox, p)).sort((a, b) => area(a.sourceBBox) - area(b.sourceBBox));
    if (containing.length) return { kind: "pin", at: p, refId: containing[0].id, status: "EXPLICIT", distance: 0 };
    const inConn = connectors.filter((c) => inBox(c.sourceBBox, p));
    if (inConn.length) {
      const c = inConn[0];
      return { kind: "connector", at: p, refId: c.id, status: "DERIVED", distance: c.connectionPoint ? dist(c.connectionPoint, p) : boxDist(c.sourceBBox, p) };
    }
    for (const o of signal) {
      if (o === self) continue;
      for (let i = 1; i < o.points.length; i++) {
        const s = segDist(p, o.points[i - 1], o.points[i]);
        if (s.d <= 1) return { kind: "wire", at: p, refId: o.id, status: "DERIVED", distance: s.d };
      }
    }
    let best: { b: T.FunctionBlock; d: number } | null = null;
    for (const b of functionBlocks) {
      const d = boxDist(b.sourceBBox, p);
      if (d <= NEAR_TOL && (!best || d < best.d)) best = { b, d };
    }
    if (best) return { kind: "pin", at: p, refId: best.b.id, status: "DERIVED", distance: best.d };
    return { kind: "dangling", at: p, refId: null, status: "UNRESOLVED", distance: 0 };
  };

  for (const c of signal) {
    c.from = classify(c, c.points[0]);
    c.to = classify(c, c.points[c.points.length - 1]);
    const st = [c.from.status, c.to.status];
    c.relationStatus = st.includes("UNRESOLVED") ? "UNRESOLVED" : st.includes("DERIVED") ? "DERIVED" : "EXPLICIT";
  }
  for (const c of connections) if (c.connectionType === "rule") { c.relationStatus = "EXPLICIT"; }

  // ------------------------------------------------------------ pins
  const pins: T.FunctionPin[] = [];
  const pinAt = new Map<string, T.FunctionPin>();
  const sideOf = (b: T.BBox, p: T.Pt): T.FunctionPin["side"] => {
    const w = Math.max(1, b.x2 - b.x1), h = Math.max(1, b.y2 - b.y1);
    const fx = (p.x - b.x1) / w, fy = (p.y - b.y1) / h;
    if (fx <= 0.3) return "left";
    if (fx >= 0.7) return "right";
    if (fy >= 0.7) return "top";
    if (fy <= 0.3) return "bottom";
    return "interior";
  };
  const ensurePin = (b: T.FunctionBlock, x: number, y: number, status: T.RelationStatus): T.FunctionPin => {
    const key = `${b.id}|${x},${y}`;
    let pin = pinAt.get(key);
    if (pin) return pin;
    const side = sideOf(b.sourceBBox, { x, y });
    pin = {
      id: "",
      blockId: b.id,
      pinName: "",
      pinIndex: 0,
      side,
      direction: side === "left" ? "input" : side === "right" ? "output" : "unknown",
      directionStatus: side === "left" || side === "right" ? "INFERRED" : "UNRESOLVED",
      sourceX: x,
      sourceY: y,
      relX: x - b.insertion.x,
      relY: y - b.insertion.y,
      status,
      connected: false,
      connectionIds: [],
      rawSourceFields: [],
    };
    pinAt.set(key, pin);
    pins.push(pin);
    return pin;
  };
  for (const c of signal) {
    for (const [ep, vertex] of [[c.from, "first"], [c.to, "last"]] as const) {
      if (ep.kind !== "pin" || !ep.refId) continue;
      const b = functionBlocks.find((x) => x.id === ep.refId)!;
      const pin = ensurePin(b, ep.at.x, ep.at.y, "EXPLICIT");
      pin.connected = true;
      pin.connectionIds.push(c.id);
      pin.rawSourceFields.push({ wireOffset: c.source.offset, vertex });
    }
  }
  for (const b of functionBlocks) {
    const tpl = templateFor.get(b.id);
    if (!tpl) continue;
    for (const tp of tpl.pins) {
      if (tp.witnesses < TEMPLATE_MIN_WITNESSES && tpl.instances > 1) continue;
      ensurePin(b, b.insertion.x + tp.relX, b.insertion.y + tp.relY, "DERIVED");
    }
  }
  // Positional names per side, reading order (top-down, left-right).
  for (const b of functionBlocks) {
    const mine = pins.filter((p) => p.blockId === b.id);
    for (const side of ["left", "right", "top", "bottom", "interior"] as const) {
      const list = mine.filter((p) => p.side === side).sort((a, c) => (side === "top" || side === "bottom" ? a.sourceX - c.sourceX : c.sourceY - a.sourceY || a.sourceX - c.sourceX));
      list.forEach((p, i) => {
        p.pinIndex = i + 1;
        p.pinName = `${side[0].toUpperCase()}${i + 1}`;
        p.id = `${b.id}.${p.pinName}`;
      });
    }
  }
  const sideRank = { left: 0, right: 1, top: 2, bottom: 3, interior: 4 };
  const blockRank = new Map(functionBlocks.map((b, i) => [b.id, i]));
  pins.sort((a, c) => blockRank.get(a.blockId)! - blockRank.get(c.blockId)! || sideRank[a.side] - sideRank[c.side] || a.pinIndex - c.pinIndex);
  for (const b of functionBlocks) b.pinIds = pins.filter((p) => p.blockId === b.id).map((p) => p.id);
  for (const c of signal) {
    for (const ep of [c.from, c.to]) {
      if (ep.kind !== "pin" || !ep.refId) continue;
      const pin = pinAt.get(`${ep.refId}|${ep.at.x},${ep.at.y}`);
      if (pin) ep.refId = pin.id;
    }
    for (const ep of [c.from, c.to]) {
      if (ep.kind === "connector" && ep.refId) connectors.find((x) => x.id === ep.refId)?.connectionIds.push(c.id);
    }
  }

  // ------------------------------------------------------------ junctions
  for (const j of junctions) {
    for (const c of signal) {
      const touches = [c.from, c.to].some((e) => e.kind === "junction" && e.refId === j.id);
      const through = c.points.some((_, i) => i > 0 && segDist(j.at, c.points[i - 1], c.points[i]).d <= EXACT_TOL);
      if (touches || through) j.connectionIds.push(c.id);
    }
  }
  const derivedAt = new Map<string, T.Junction>();
  for (const c of signal) {
    for (const ep of [c.from, c.to]) {
      if (ep.kind !== "wire" || !ep.refId) continue;
      const other = signal.find((o) => o.id === ep.refId)!;
      const onInterior = other.points.some((_, i) => i > 0 && segDist(ep.at, other.points[i - 1], other.points[i]).interior && segDist(ep.at, other.points[i - 1], other.points[i]).d <= 1);
      const key = `${ep.at.x},${ep.at.y}`;
      let j = derivedAt.get(key);
      if (!j) {
        j = { id: nid("J"), kind: onInterior ? "branch" : "wire-join", at: ep.at, status: "DERIVED", source: null, connectionIds: [], note: "tee/join by exact vertex coincidence; no N90CNECT junction symbol in source" };
        derivedAt.set(key, j);
        junctions.push(j);
      }
      for (const id of [c.id, other.id]) if (!j.connectionIds.includes(id)) j.connectionIds.push(id);
    }
    for (const ep of [c.from, c.to]) {
      if (ep.kind !== "connector" || !ep.refId) continue;
      junctions.push({ id: nid("J"), kind: "reference-endpoint", at: ep.at, status: ep.status, source: null, connectionIds: [c.id], note: `wire end on ${ep.refId}` });
    }
  }
  // Crossings: interior-interior intersections with no junction symbol.
  const segs: Array<{ c: T.Connection; a: T.Pt; b: T.Pt }> = [];
  for (const c of signal) for (let i = 1; i < c.points.length; i++) segs.push({ c, a: c.points[i - 1], b: c.points[i] });
  for (let i = 0; i < segs.length; i++) {
    for (let k = i + 1; k < segs.length; k++) {
      const s = segs[i], t = segs[k];
      if (s.c === t.c) continue;
      const sh = s.a.y === s.b.y, sv = s.a.x === s.b.x, th = t.a.y === t.b.y, tv = t.a.x === t.b.x;
      let p: T.Pt | null = null;
      if (sh && tv) p = { x: t.a.x, y: s.a.y };
      else if (sv && th) p = { x: s.a.x, y: t.a.y };
      if (!p) continue;
      const sd = segDist(p, s.a, s.b), td = segDist(p, t.a, t.b);
      if (sd.d > 0.5 || td.d > 0.5 || !sd.interior || !td.interior) continue;
      if (junctions.some((j) => j.kind === "connected" && dist(j.at, p!) <= EXACT_TOL)) continue;
      junctions.push({ id: nid("J"), kind: "crossing-no-connection", at: p, status: "DERIVED", source: null, connectionIds: [s.c.id, t.c.id], note: "segments cross with no junction symbol: not connected" });
    }
  }

  // ------------------------------------------------------------ nets
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));
  for (const c of signal) parent.set(c.id, c.id);
  for (const j of junctions) {
    if (j.kind === "connected" || j.kind === "branch" || j.kind === "wire-join") {
      for (let i = 1; i < j.connectionIds.length; i++) union(j.connectionIds[0], j.connectionIds[i]);
    }
  }
  const netsByRoot = new Map<string, T.Net>();
  for (const c of signal) {
    const root = find(c.id);
    let n = netsByRoot.get(root);
    if (!n) {
      n = { id: nid("N"), connectionIds: [], pinIds: [], connectorIds: [], junctionIds: [], drivers: [], sinks: [] };
      netsByRoot.set(root, n);
    }
    n.connectionIds.push(c.id);
    c.netId = n.id;
    for (const ep of [c.from, c.to]) {
      if (ep.kind === "pin" && ep.refId && !n.pinIds.includes(ep.refId)) n.pinIds.push(ep.refId);
      if (ep.kind === "connector" && ep.refId && !n.connectorIds.includes(ep.refId)) n.connectorIds.push(ep.refId);
    }
  }
  for (const j of junctions) {
    const c = j.connectionIds[0];
    if (!c || j.kind === "crossing-no-connection") continue;
    const n = netsByRoot.get(find(c));
    if (n) n.junctionIds.push(j.id);
  }
  const pinById = new Map(pins.map((p) => [p.id, p]));
  for (const n of netsByRoot.values()) {
    for (const pid of n.pinIds) {
      const p = pinById.get(pid);
      if (p?.direction === "output") n.drivers.push(pid);
      else if (p?.direction === "input") n.sinks.push(pid);
    }
    for (const cid of n.connectorIds) {
      const k = connectors.find((x) => x.id === cid);
      if (k?.kind === "IREF") n.drivers.push(cid);
      else if (k) n.sinks.push(cid);
    }
    // A net that is exported (output reference) must be driven; when its only
    // pin was classed input by drawing side, that pin is the driver.
    const pinSinks = n.sinks.filter((id) => pinById.has(id));
    const exported = n.sinks.some((id) => connectors.find((x) => x.id === id)?.kind === "OREF");
    if (!n.drivers.length && exported && pinSinks.length === 1) {
      const p = pinById.get(pinSinks[0])!;
      p.direction = "output";
      p.directionStatus = "DERIVED";
      n.sinks = n.sinks.filter((id) => id !== p.id);
      n.drivers.push(p.id);
    }
  }

  // ------------------------------------------------------------ texts
  const texts: T.TextAnnotation[] = [];
  const arcs: T.Arc[] = [];
  for (const r of records) {
    if (r.kind === "primitive3") {
      arcs.push({ id: nid("A"), source: srcRef(file, r), center: r.points[0], start: r.points[1], end: r.points[2], layer: r.layer });
      continue;
    }
    if (r.kind !== "text" || r.text == null) continue;
    const bbox = bboxOf(r);
    const anchor = { x: r.x1, y: r.y1 };
    let role: T.TextAnnotation["role"] = "engineering";
    if (titleBox && inBox(titleBox, anchor)) role = "title-block";
    else if (r.layer === 8 && /^[A-Z0-9]{4}-\d{2}\.\d{2}$/.test(r.text.trim())) role = "xref-annotation";
    let attachedTo: string | null = null;
    if (role !== "title-block") {
      let best: { id: string; d: number } | null = null;
      for (const c of connectors) {
        const d = boxDist(c.sourceBBox, anchor);
        if (d <= 40 && (!best || d < best.d)) best = { id: c.id, d };
      }
      for (const b of functionBlocks) {
        const d = boxDist(b.sourceBBox, anchor);
        if (d <= 20 && (!best || d < best.d)) best = { id: b.id, d };
      }
      attachedTo = best?.id ?? null;
    }
    const t: T.TextAnnotation = { id: nid("T"), source: srcRef(file, r), text: r.text, bbox, height: r.textHeight ?? 0, heightFlag: Boolean(r.textHeightFlag), rotation: r.rotation ?? 0, layer: r.layer, role, attachedTo };
    texts.push(t);
    if (attachedTo) functionBlocks.find((b) => b.id === attachedTo)?.attachedTextIds.push(t.id);
  }

  // Title fields: each title-region text takes the nearest library label above it.
  const titleBlock: T.TitleBlock = { present: Boolean(titleBox), bbox: titleBox, fields: [], unassigned: [] };
  for (const t of texts.filter((x) => x.role === "title-block")) {
    let best: { label: string; score: number; at: T.Pt } | null = null;
    for (const l of titleLabels) {
      const dy = l.at.y - t.bbox.y1;
      const dx = t.bbox.x1 - l.at.x;
      if (dy <= 0 || dy > 90 || dx < -15) continue;
      const score = dy + Math.abs(dx) * 0.3;
      if (!best || score < best.score) best = { label: l.text.trim(), score, at: { x: l.at.x, y: l.at.y } };
    }
    if (best) titleBlock.fields.push({ label: best.label, value: t.text.trim(), textId: t.id, status: "DERIVED", at: { x: t.bbox.x1, y: t.bbox.y1 }, labelAt: best.at });
    else titleBlock.unassigned.push(t.text.trim());
  }

  // ------------------------------------------------------------ parameters
  const parameters: T.Parameter[] = [];
  for (const b of functionBlocks) {
    if (b.blockNumber == null) continue;
    const spec = specs.get(b.blockNumber);
    if (!spec) continue;
    for (const c of spec.specs) {
      const name = `S${c.index + 1}`;
      const value =
        c.likely === "zero" ? "0" : c.likely === "integer" ? String(c.words[0]) : c.likely === "float" ? String(Number(c.float.toPrecision(6))) : `${c.words[0]}|${c.words[1]}?`;
      const p: T.Parameter = {
        id: `${b.id}.${name}`,
        blockId: b.id,
        blockNumber: b.blockNumber,
        name,
        description: b.functionCode != null ? ctx.specNames?.[b.functionCode]?.[name] : undefined,
        value,
        status: c.likely === "ambiguous" ? "UNRESOLVED" : "EXPLICIT",
        raw: { offset: c.offset, words: c.words, float: c.float, likely: c.likely },
      };
      parameters.push(p);
      b.parameterIds.push(p.id);
    }
  }

  // ------------------------------------------------------------ unknowns
  const unknownRecords: T.UnknownRecord[] = [];
  for (const r of records) {
    const fields = r.unresolved.filter((u) => u !== "style" && !(r.type === 4 && u === "primitiveKind"));
    if (r.kind === "unknown" || fields.length || r.residualHex) {
      unknownRecords.push({ source: srcRef(file, r), kind: r.kind, fields, reserved: r.reserved ?? [], residualHex: r.residualHex });
    }
  }

  const dangling = signal.filter((c) => c.relationStatus === "UNRESOLVED").length;
  if (dangling) diag.push(`${dangling} signal polyline(s) with an endpoint not incident on any symbol, junction or wire`);

  return {
    id: sheetId,
    file,
    sha256: crypto.createHash("sha256").update(buf).digest("hex"),
    byteSize: buf.length,
    library: readLibraryName(buf) ?? null,
    recordCount: records.length,
    clean,
    frame,
    titleBlock,
    gridMarks,
    functionBlocks,
    pins,
    connectors,
    connections,
    junctions,
    arcs,
    texts,
    parameters,
    crossSheetReferences: [],
    unknownRecords,
    nets: [...netsByRoot.values()],
    diagnostics: diag,
  };
}
