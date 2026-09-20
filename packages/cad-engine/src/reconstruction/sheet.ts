/**
 * Canonical sheet reconstruction.
 *
 * Builds the Engineering Logic Model from decoded source records only. No
 * element is placed on a synthetic grid and no connection is inferred from
 * reading order: geometry comes from the records' own coordinates and topology
 * comes from type 1 polylines joined by real coordinate incidence.
 *
 * Every emitted entity carries a `trace` naming the source file and the byte
 * offset of the record it came from.
 */
import {
  newId,
  parseProvenanceFromPath,
  type CadAnnotation,
  type CadConnection,
  type CadCrossReference,
  type CadElementType,
  type CadLogicBlock,
  type CadPort,
  type CadTagNode,
  type EngineeringSheetModel,
  type Traceability,
} from "@infi90/core";
import { readLibraryName } from "../binary/reader";
import { decodeRecordStream, type RawCadRecord } from "../records/decode";
import { decodeTrailer, specificationsByBlock } from "../records/trailer";
import {
  classifySymbol,
  functionCodeNumber,
  type SymbolRole,
} from "../semantic/classify";
import {
  isSelfReference,
  parseReference,
  resolveReferenceTarget,
} from "../semantic/reference";
import { createTransform, unionExtent, type SourceExtent } from "../geometry/transform";

/** Source-space slack when testing whether a wire end meets a symbol. */
const INCIDENCE_TOLERANCE = 40;
/** Line layer/flag 1 = signal wire; other values are drawing rules. */
const WIRE_STYLE = 1;

function nativeTrace(
  filename: string,
  offset: number,
  sourceText?: string,
  confidence = 0.98,
  status: Traceability["validationStatus"] = "verified"
): Traceability {
  return {
    sourceFilename: filename,
    sourceMethod: "CAD_NATIVE",
    sourceText,
    sourceIndex: offset,
    confidence,
    validationStatus: status,
  };
}

const ELEMENT_TYPE: Record<SymbolRole, CadElementType> = {
  border: "Border",
  frame: "Border",
  connector: "Junction",
  "input-ref": "CrossReference",
  "output-ref": "CrossReference",
  logic: "LogicBlock",
  "io-module": "IOMarker",
  generic: "LogicBlock",
};

function blockElementType(role: SymbolRole, name: string): CadElementType {
  const n = name.toUpperCase();
  if (role === "logic") {
    if (/SEQ/.test(n)) return "SequenceBlock";
    if (/^(TD-|T-|ETIMER|P=0)/.test(n)) return "TimingBlock";
  }
  return ELEMENT_TYPE[role];
}

export interface DecodeOptions {
  sourcePath?: string;
  targetWidth?: number;
}

export function decodeCadSheet(
  buf: Buffer,
  filename: string,
  opts: DecodeOptions = {}
): EngineeringSheetModel {
  const { records, diagnostics, clean, coverage } = decodeRecordStream(buf);
  const warnings: string[] = [...diagnostics];

  // The BCCo SPC LIST trailer holds each block's numeric function code and its
  // specification values — engineering data absent from the record stream.
  const trailer = decodeTrailer(buf);
  const specsByBlock = specificationsByBlock(trailer);
  warnings.push(...trailer.diagnostics);

  const symbols = records.filter((r) => r.kind === "symbol");
  const polylines = records.filter((r) => r.kind === "polyline");
  const primitives = records.filter(
    (r) => r.kind === "primitive2" || r.kind === "primitive3"
  );
  const texts = records.filter((r) => r.kind === "text");

  // ---- sheet extent: prefer the decoded drawing border
  const border = symbols.find((s) => classifySymbol(s.symbolName) === "border");
  const geometryBoxes: SourceExtent[] = [
    ...symbols.map((s) => ({ minX: s.x1, minY: s.y1, maxX: s.x2, maxY: s.y2 })),
    ...[...polylines, ...primitives].flatMap((l) =>
      l.points.map((p) => ({ minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }))
    ),
  ];
  const extent = border
    ? { minX: border.x1, minY: border.y1, maxX: border.x2, maxY: border.y2 }
    : unionExtent(geometryBoxes);
  const t = createTransform(extent, opts.targetWidth);

  const blocks: CadLogicBlock[] = [];
  const crossReferences: CadCrossReference[] = [];
  const tags: CadTagNode[] = [];
  const annotations: CadAnnotation[] = [];
  /** Native coordinates retained for incidence testing after transformation. */
  const blockNative = new Map<string, RawCadRecord>();

  // ---- blocks: every placed symbol except the drawing frame
  for (const rec of symbols) {
    const name = rec.symbolName ?? "";
    const role = classifySymbol(name);
    if (role === "border" || role === "frame") continue;

    const id = newId("block");
    const box = {
      x: t.tx(rec.x1),
      y: t.ty(rec.y2),
      width: Math.max(2, t.ts(rec.x2 - rec.x1)),
      height: Math.max(2, t.ts(rec.y2 - rec.y1)),
    };

    // Junctions carry no engineering payload, but wires terminate on them, so
    // they must exist as nodes or the topology breaks at every corner.
    if (role === "connector") {
      blocks.push({
        id,
        type: "Junction",
        functionCode: name,
        ...box,
        parameters: {},
        ports: [],
        inputRefs: [],
        outputRefs: [],
        deviceTags: [],
        trace: nativeTrace(filename, rec.offset, name),
      });
      blockNative.set(id, rec);
      continue;
    }

    // Ports come from the type 7 terminal array when present: each populated
    // slot is a real terminal with its own signal tag and reference.
    const ports: CadPort[] = (rec.entries ?? []).map((e) => ({
      id: newId("port"),
      blockId: id,
      name: `T${e.slot + 1}`,
      specIndex: e.slot + 1,
      direction: "bidirectional" as const,
      signalName: e.tag,
      trace: nativeTrace(
        filename,
        rec.offset,
        [e.reference, e.tag].filter(Boolean).join(" "),
        0.95
      ),
    }));

    const parameters: Record<string, string> = {};
    if (rec.blockNumber != null) parameters.BLOCK = String(rec.blockNumber);
    if (rec.rotation) parameters.ROT = `${rec.rotation}`;
    if (rec.reference) parameters.REF = rec.reference;

    // Specifications from the trailer, keyed by Bailey block address. Slots
    // are labelled S1..Sn by payload order; the value is rendered in whichever
    // reading the slot supports, and an ambiguous slot shows its candidates
    // with a trailing `?` rather than hiding behind a hex blob.
    //
    // Evidence that a slot can hold two uint16 specifications rather than one
    // float: consecutive DIGRP blocks decode as [1,1], [2,1], [3,1] tracking
    // the group number. The per-function-code layout is not established, so
    // both readings are offered and the ambiguity is explicit.
    const spec = rec.blockNumber != null ? specsByBlock.get(rec.blockNumber) : undefined;
    if (spec) {
      parameters.FC = String(spec.functionCode);
      for (const c of spec.specs) {
        if (c.likely === "zero") continue;
        const label = `S${c.index + 1}`;
        parameters[label] =
          c.likely === "integer"
            ? String(c.words[0])
            : c.likely === "float"
              ? String(Number(c.float.toPrecision(6)))
              : `${c.words[0]}|${c.words[1]}?`;
      }
    }

    const isInput = role === "input-ref";
    const isOutput = role === "output-ref";
    const parsedRef = parseReference(rec.reference);

    blocks.push({
      id,
      type: blockElementType(role, name),
      functionCode: name,
      // Source-decoded FC wins over the name-based table, which is only a
      // fallback for blocks with no trailer entry.
      functionCodeNumber: spec?.functionCode ?? functionCodeNumber(name),
      label: rec.tag,
      // The Bailey block address is real engineering identity, not a UI label.
      blockNumber: rec.blockNumber != null ? String(rec.blockNumber) : undefined,
      ...box,
      parameters,
      ports,
      inputRefs: isInput && rec.tag ? [rec.tag] : [],
      outputRefs: isOutput && rec.tag ? [rec.tag] : [],
      deviceTags: rec.tag ? [rec.tag] : [],
      notes: rec.unresolved.length > 0 ? `unresolved: ${rec.unresolved.join(",")}` : undefined,
      trace: nativeTrace(filename, rec.offset, name),
    });
    blockNative.set(id, rec);

    // ---- cross references, from the confirmed reference address
    if (parsedRef) {
      const target = resolveReferenceTarget(parsedRef, filename);
      const self = isSelfReference(parsedRef, filename);
      crossReferences.push({
        id: newId("xref"),
        sourceElementId: id,
        targetIdentifier: rec.tag ?? parsedRef.raw,
        targetFile: self ? undefined : target,
        targetSheet: self ? undefined : target?.replace(/\.CAD$/i, ""),
        address: parsedRef.raw,
        signal: rec.tag,
        referenceType: self ? "local" : target ? "cross_cad" : "unresolved",
        resolved: Boolean(self || target),
        x: t.tx(rec.x1),
        y: t.ty(rec.y2),
        trace: nativeTrace(filename, rec.offset, `${parsedRef.raw}${rec.tag ? ` ${rec.tag}` : ""}`),
      });
    } else if (isInput || isOutput) {
      // An IREF/OREF with no decodable address is reported, not invented.
      crossReferences.push({
        id: newId("xref"),
        sourceElementId: id,
        targetIdentifier: rec.tag ?? name,
        signal: rec.tag,
        referenceType: "unresolved",
        resolved: false,
        x: t.tx(rec.x1),
        y: t.ty(rec.y2),
        trace: nativeTrace(filename, rec.offset, rec.tag ?? name, 0.6, "unresolved"),
      });
    }

    // ---- tags: the signal tag on the record, plus every terminal tag
    const tagTexts = [rec.tag, ...(rec.entries ?? []).map((e) => e.tag)].filter(
      (s): s is string => Boolean(s)
    );
    for (const raw of tagTexts) {
      const normalized = raw.toUpperCase();
      if (tags.some((x) => x.normalized === normalized)) continue;
      const io = normalized.match(/\b(AI|AO|DI|DO)\d/);
      tags.push({
        id: newId("tag"),
        raw,
        normalized,
        ioType: io ? io[1] : undefined,
        connectedBlockIds: [id],
        x: t.tx(rec.x1),
        y: t.ty(rec.y2),
        trace: nativeTrace(filename, rec.offset, raw),
      });
    }
  }

  // ---- topology from polylines
  const hitTest = (x: number, y: number): string | undefined => {
    let best: string | undefined;
    let bestDist = Infinity;
    for (const [id, r] of blockNative) {
      if (x < r.x1 - INCIDENCE_TOLERANCE || x > r.x2 + INCIDENCE_TOLERANCE) continue;
      if (y < r.y1 - INCIDENCE_TOLERANCE || y > r.y2 + INCIDENCE_TOLERANCE) continue;
      const cx = (r.x1 + r.x2) / 2;
      const cy = (r.y1 + r.y2) / 2;
      const d = (cx - x) ** 2 + (cy - y) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = id;
      }
    }
    return best;
  };

  const wires = polylines.filter((p) => p.style === WIRE_STYLE);

  /** A wire may tee onto another wire rather than onto a symbol. */
  const teesOntoWire = (self: RawCadRecord, x: number, y: number): boolean =>
    wires.some((w) => {
      if (w.offset === self.offset) return false;
      // Test against each segment of the other polyline, not its bounding box.
      for (let i = 1; i < w.points.length; i++) {
        const a = w.points[i - 1];
        const b = w.points[i];
        const loX = Math.min(a.x, b.x) - INCIDENCE_TOLERANCE;
        const hiX = Math.max(a.x, b.x) + INCIDENCE_TOLERANCE;
        const loY = Math.min(a.y, b.y) - INCIDENCE_TOLERANCE;
        const hiY = Math.max(a.y, b.y) + INCIDENCE_TOLERANCE;
        if (x >= loX && x <= hiX && y >= loY && y <= hiY) return true;
      }
      return false;
    });

  const connections: CadConnection[] = [];
  let danglingWires = 0;

  for (const ln of polylines) {
    if (ln.points.length < 2) continue;
    const isWire = ln.style === WIRE_STYLE;
    const first = ln.points[0];
    const last = ln.points[ln.points.length - 1];

    const a = isWire ? hitTest(first.x, first.y) : undefined;
    const b = isWire ? hitTest(last.x, last.y) : undefined;
    const attached = isWire
      ? (Boolean(a) || teesOntoWire(ln, first.x, first.y)) &&
        (Boolean(b) || teesOntoWire(ln, last.x, last.y))
      : false;
    if (isWire && !attached) danglingWires++;

    // Every vertex is preserved, so routed corners survive reconstruction.
    const geometry = [];
    for (let i = 1; i < ln.points.length; i++) {
      geometry.push({
        x1: t.tx(ln.points[i - 1].x),
        y1: t.ty(ln.points[i - 1].y),
        x2: t.tx(ln.points[i].x),
        y2: t.ty(ln.points[i].y),
      });
    }

    connections.push({
      id: newId("conn"),
      sourceBlockId: a,
      targetBlockId: b,
      geometry,
      referenceType: "local",
      // Drawing rules are furniture, never "unresolved wires".
      resolved: isWire ? attached : true,
      trace: nativeTrace(
        filename,
        ln.offset,
        `${isWire ? "wire" : "rule"} ${ln.points.length} vertices`,
        isWire && !attached ? 0.7 : 0.95,
        isWire && !attached ? "review_required" : "verified"
      ),
    });
  }

  // Types 2/3/4 are confirmed geometry but their primitive kind is not known,
  // so they are carried as drawing geometry rather than reinterpreted.
  for (const p of primitives) {
    const geometry = [];
    for (let i = 1; i < p.points.length; i++) {
      geometry.push({
        x1: t.tx(p.points[i - 1].x),
        y1: t.ty(p.points[i - 1].y),
        x2: t.tx(p.points[i].x),
        y2: t.ty(p.points[i].y),
      });
    }
    if (geometry.length === 0) continue;
    connections.push({
      id: newId("conn"),
      geometry,
      referenceType: "local",
      resolved: true,
      trace: nativeTrace(
        filename,
        p.offset,
        `type${p.type} primitive (kind unresolved)`,
        0.8,
        "review_required"
      ),
    });
  }

  // ---- annotations at their decoded anchors, with source height and rotation
  for (const tr of texts) {
    if (!tr.text) continue;
    annotations.push({
      id: newId("ann"),
      text: tr.text,
      kind: "label",
      x: t.tx(tr.x1),
      // SVG text y is the baseline, which is the low edge of the source box.
      y: t.ty(tr.y1),
      height: tr.textHeight ? t.ts(tr.textHeight) : undefined,
      trace: nativeTrace(filename, tr.offset, tr.text),
    });
  }

  // ---- sheet identity from decoded text, never fabricated
  const textStrings = texts.map((r) => r.text).filter((s): s is string => Boolean(s));
  const stem = filename.replace(/\.CAD$/i, "").toUpperCase();
  const sheetId =
    textStrings
      .map((s) => s.trim().toUpperCase())
      .find((s) => s.length >= 5 && (stem === s || stem.startsWith(s))) ?? stem;
  const title = textStrings
    .map((s) => s.trim())
    .find(
      (s) =>
        s.length >= 6 &&
        s.length <= 60 &&
        /^[A-Za-z][A-Za-z0-9 .#&'/-]*$/.test(s) &&
        /[A-Za-z]{3}\s+[A-Za-z]{2}/.test(s) &&
        !/^\d/.test(s) &&
        !/\d{4,}/.test(s)
    );

  const provenance = opts.sourcePath ? parseProvenanceFromPath(opts.sourcePath) : undefined;
  const library = readLibraryName(buf);

  if (!clean) warnings.push("Record stream ended early — see diagnostics");
  if (blocks.length === 0) warnings.push("No placed symbols decoded from this sheet");
  if (danglingWires > 0) {
    warnings.push(`${danglingWires} wire(s) not incident on a symbol or another wire`);
  }
  const unresolvedFields = new Map<string, number>();
  for (const r of records) {
    for (const u of r.unresolved) unresolvedFields.set(u, (unresolvedFields.get(u) ?? 0) + 1);
  }
  for (const [field, n] of unresolvedFields) {
    warnings.push(`${n} record(s) carry an uninterpreted field: ${field}`);
  }
  if (coverage.residualBytes > 0) {
    warnings.push(`${coverage.residualBytes} source byte(s) unexplained by the schema`);
  }

  const unresolvedXrefs = crossReferences.filter((x) => !x.resolved).length;

  return {
    version: "1.0",
    filename,
    sheetId,
    title,
    provenance: provenance
      ? { loop: provenance.loop, cpu: provenance.cpu, module: provenance.module }
      : undefined,
    page: { width: t.pageWidth, height: t.pageHeight },
    blocks,
    connections,
    crossReferences,
    tags,
    annotations,
    layers: [
      { id: "border", name: "Page / Border", visible: true },
      { id: "blocks", name: "Function Blocks", visible: true },
      { id: "wires", name: "Wires", visible: true },
      { id: "xref", name: "IREF / OREF", visible: true },
      { id: "tags", name: "Tags", visible: true },
      { id: "annotations", name: "Annotations", visible: true },
      { id: "metadata", name: `Library: ${library ?? "unknown"}`, visible: true },
    ],
    stats: {
      blockCount: blocks.length,
      connectionCount: connections.length,
      tagCount: tags.length,
      crossRefCount: crossReferences.length,
      unresolvedConnections: danglingWires + unresolvedXrefs,
    },
    validation: {
      status: warnings.length > 0 ? "COMPLETED_WITH_WARNINGS" : "COMPLETED",
      warnings: warnings.slice(0, 40),
    },
  };
}

/** True when the buffer looks like a SCAD record-stream CAD file. */
export function isDecodableCad(buf: Buffer): boolean {
  if (buf.length < 300) return false;
  const { records } = decodeRecordStream(buf);
  return records.some((r) => r.kind === "symbol");
}
