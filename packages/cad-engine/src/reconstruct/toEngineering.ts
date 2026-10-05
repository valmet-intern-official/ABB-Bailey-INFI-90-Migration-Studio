/**
 * DrawingSheet → EngineeringSheetModel adapter.
 *
 * Keeps the interactive viewer / exporters on the shared EngineeringSheetModel
 * while the source-faithful reconstruct path owns geometry and topology.
 * Coordinates stay in source units (SCAD grid, Y up); the reconstruct SVG is
 * page-transformed separately and stored on CadSheetParse.reconstructedSvg.
 */
import type {
  CadAnnotation,
  CadConnection,
  CadCrossReference,
  CadLogicBlock,
  CadPort,
  CadTagNode,
  EngineeringSheetModel,
  Traceability,
  ValidationStatus,
} from "@infi90/core";
import type { DrawingSheet, FunctionBlock, FunctionPin, RelationStatus } from "./types";
import { PAGE_H, PAGE_W } from "./render";

function statusOf(r: RelationStatus): ValidationStatus {
  if (r === "EXPLICIT" || r === "DERIVED") return "verified";
  if (r === "INFERRED") return "inferred";
  return "unresolved";
}

function trace(
  filename: string,
  offset: number,
  relation: RelationStatus,
  confidence = 0.98
): Traceability {
  return {
    sourceFilename: filename,
    sourceMethod: "CAD_NATIVE",
    sourceIndex: offset,
    confidence,
    validationStatus: statusOf(relation),
  };
}

function portsFor(block: FunctionBlock, pins: FunctionPin[], filename: string): CadPort[] {
  return pins.map((p) => ({
    id: p.id,
    blockId: block.id,
    name: p.pinName,
    direction:
      p.direction === "input"
        ? "in"
        : p.direction === "output"
          ? "out"
          : "bidirectional",
    x: p.sourceX,
    y: p.sourceY,
    side: p.side === "interior" ? undefined : p.side,
    trace: trace(filename, block.source.offset, p.status, p.connected ? 0.98 : 0.7),
  }));
}

function blockType(b: FunctionBlock): CadLogicBlock["type"] {
  const n = b.symbolName.toUpperCase();
  if (/SEQ/.test(n)) return "SequenceBlock";
  if (/^(TD-|T-|ETIMER|P=0)/.test(n)) return "TimingBlock";
  if (/^(AI|AO|DI|DO|CIS|CISL)/.test(n)) return "IOMarker";
  return "LogicBlock";
}

export function drawingSheetToEngineeringModel(sheet: DrawingSheet): EngineeringSheetModel {
  const pinsByBlock = new Map<string, FunctionPin[]>();
  for (const p of sheet.pins) {
    const list = pinsByBlock.get(p.blockId) ?? [];
    list.push(p);
    pinsByBlock.set(p.blockId, list);
  }

  const parametersByBlock = new Map<string, Record<string, string>>();
  for (const p of sheet.parameters) {
    const m = parametersByBlock.get(p.blockId) ?? {};
    m[p.name] = p.value;
    parametersByBlock.set(p.blockId, m);
  }

  const blocks: CadLogicBlock[] = sheet.functionBlocks.map((b) => {
    const pins = pinsByBlock.get(b.id) ?? [];
    const bb = b.sourceBBox;
    return {
      id: b.id,
      type: blockType(b),
      functionCode: b.symbolName,
      functionCodeNumber: b.functionCode ?? undefined,
      label: b.symbolName,
      blockNumber: b.blockNumber != null ? String(b.blockNumber) : undefined,
      x: bb.x1,
      y: bb.y1,
      width: Math.max(1, bb.x2 - bb.x1),
      height: Math.max(1, bb.y2 - bb.y1),
      parameters: parametersByBlock.get(b.id) ?? {},
      ports: portsFor(b, pins, sheet.file),
      inputRefs: pins.filter((p) => p.direction === "input").map((p) => p.pinName),
      outputRefs: pins.filter((p) => p.direction === "output").map((p) => p.pinName),
      deviceTags: [],
      notes: b.glyph.note,
      sourceGeometry: {
        originalX: bb.x1,
        originalY: bb.y1,
        originalWidth: Math.max(1, bb.x2 - bb.x1),
        originalHeight: Math.max(1, bb.y2 - bb.y1),
      },
      glyphStatus: b.glyph.status === "LIBRARY" ? "AUTHENTIC" : "FALLBACK",
      trace: trace(sheet.file, b.source.offset, b.functionCodeStatus),
    };
  });

  // Junctions are hardware on the wire net, not function blocks, but the
  // viewer still lists them under blocks for selection.
  for (const j of sheet.junctions) {
    if (j.kind !== "connected") continue;
    blocks.push({
      id: j.id,
      type: "Junction",
      x: j.at.x - 4,
      y: j.at.y - 4,
      width: 8,
      height: 8,
      parameters: {},
      ports: [],
      inputRefs: [],
      outputRefs: [],
      deviceTags: [],
      trace: trace(sheet.file, j.source?.offset ?? 0, j.status),
    });
  }

  const connections: CadConnection[] = sheet.connections
    .filter((c) => c.connectionType === "signal")
    .map((c) => {
      const segs =
        c.points.length >= 2
          ? c.points.slice(0, -1).map((p, i) => ({
              x1: p.x,
              y1: p.y,
              x2: c.points[i + 1].x,
              y2: c.points[i + 1].y,
            }))
          : [];
      const sourceBlockId =
        c.from.kind === "pin" || c.from.kind === "connector" ? c.from.refId ?? undefined : undefined;
      const targetBlockId =
        c.to.kind === "pin" || c.to.kind === "connector" ? c.to.refId ?? undefined : undefined;
      // Pins reference block ids via FunctionPin.blockId — resolve when endpoint is a pin.
      const fromPin = c.from.kind === "pin" ? sheet.pins.find((p) => p.id === c.from.refId) : undefined;
      const toPin = c.to.kind === "pin" ? sheet.pins.find((p) => p.id === c.to.refId) : undefined;
      return {
        id: c.id,
        sourceBlockId: fromPin?.blockId ?? sourceBlockId,
        sourcePortId: fromPin?.id,
        targetBlockId: toPin?.blockId ?? targetBlockId,
        targetPortId: toPin?.id,
        geometry: segs,
        referenceType: "local" as const,
        resolved: c.from.kind !== "dangling" && c.to.kind !== "dangling",
        relationType: c.relationStatus === "INFERRED" ? ("INFERRED" as const) : ("EXPLICIT" as const),
        sourceGeometry: {
          originalX: c.points[0]?.x ?? 0,
          originalY: c.points[0]?.y ?? 0,
          originalWidth: 0,
          originalHeight: 0,
          originalPolyline: segs,
        },
        trace: trace(sheet.file, c.source.offset, c.relationStatus),
      };
    });

  const crossReferences: CadCrossReference[] = sheet.crossSheetReferences.map((r) => ({
    id: r.id,
    sourceElementId: r.connectorId,
    targetIdentifier: r.reference ?? r.tag ?? "",
    targetSheet: r.targetSheet ?? undefined,
    address: r.reference ?? undefined,
    signal: r.tag ?? undefined,
    referenceType:
      r.status === "RESOLVED_CROSS_SHEET"
        ? "cross_sheet"
        : r.status === "RESOLVED_EXTERNAL" || r.status === "BOUNDARY_SIGNAL"
          ? "external_io"
          : r.status === "UNRESOLVED" || r.status === "AMBIGUOUS"
            ? "unresolved"
            : "local",
    resolved: r.status.startsWith("RESOLVED") || r.status === "BOUNDARY_SIGNAL",
    trace: trace(sheet.file, 0, r.relation, r.xrefOutConfirmed ? 0.99 : 0.8),
  }));

  const tags: CadTagNode[] = [];
  for (const c of sheet.connectors) {
    if (!c.tag) continue;
    tags.push({
      id: `tag-${c.id}`,
      raw: c.tag,
      normalized: c.tag.toUpperCase(),
      connectedBlockIds: [c.id],
      x: c.insertion.x,
      y: c.insertion.y,
      trace: trace(sheet.file, c.source.offset, c.resolution.relation),
    });
  }

  const annotations: CadAnnotation[] = sheet.texts.map((t) => ({
    id: t.id,
    text: t.text,
    kind:
      t.role === "title-block"
        ? "title"
        : t.role === "note"
          ? "metadata"
          : t.role === "engineering"
            ? "label"
            : "other",
    x: t.bbox.x1,
    y: t.bbox.y1,
    height: t.height,
    trace: trace(sheet.file, t.source.offset, "EXPLICIT"),
  }));

  const title =
    sheet.titleBlock.fields.find((f) => /title|desc/i.test(f.label))?.value ??
    sheet.titleBlock.fields[0]?.value;

  const unresolved =
    connections.filter((c) => !c.resolved).length +
    crossReferences.filter((c) => !c.resolved).length;

  return {
    version: "1.0",
    filename: sheet.file,
    sheetId: sheet.id,
    title,
    page: {
      width: PAGE_W,
      height: PAGE_H,
      orientation: "landscape",
    },
    blocks,
    connections,
    crossReferences,
    tags,
    annotations,
    layers: [
      { id: "logic", name: "Logic", visible: true },
      { id: "wires", name: "Wires", visible: true },
      { id: "refs", name: "References", visible: true },
      { id: "text", name: "Text", visible: true },
    ],
    stats: {
      blockCount: blocks.filter((b) => b.type !== "Junction").length,
      connectionCount: connections.length,
      tagCount: tags.length,
      crossRefCount: crossReferences.length,
      unresolvedConnections: unresolved,
    },
    validation: {
      status:
        unresolved > 0 || sheet.diagnostics.length > 0
          ? "COMPLETED_WITH_WARNINGS"
          : "COMPLETED",
      warnings: [
        ...sheet.diagnostics,
        ...sheet.unknownRecords.map(
          (u) => `Unknown record type ${u.kind} @ ${u.source.offset}`
        ),
      ].slice(0, 50),
    },
  };
}
