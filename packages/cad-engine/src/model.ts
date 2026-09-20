import {
  newId,
  parseProvenanceFromPath,
  type CadAnnotation,
  type CadConnection,
  type CadCrossReference,
  type CadLogicBlock,
  type CadPort,
  type CadSheetParse,
  type CadTagNode,
  type EngineeringSheetModel,
  type Traceability,
} from "@infi90/core";

/** Known Bailey function / sequence block tokens from reference logic sheets. */
export const KNOWN_FUNCTION_CODES = [
  "PID",
  "ETIMER",
  "DSUM",
  "SEQMON",
  "SEQGEN",
  "SEQ",
  "REMSET",
  "DIGRP",
  "TD-DIG",
  "AND",
  "OR",
  "NOT",
  "XOR",
  "ADD",
  "SUB",
  "MUL",
  "DIV",
  "H/L",
  "HLAG",
  "LEAD",
  "RAMP",
  "A/M",
  "TRIG",
  "PULSE",
  "FLIFLO",
  "SRFF",
  "COMPARE",
  "SPLIT",
  "F(x)",
  "AGNTR",
  "M/A",
  "RDI",
  "RDI01A",
  "BMUX",
  "RDEMUX",
  "RMUX",
  "RECIPR",
  "RCM",
  "TEXT",
  "RESET",
  "ENABLE",
] as const;

const NUMERIC_FC_MAP: Record<string, number> = {
  SEQGEN: 118,
  SEQMON: 119,
  BMUX: 120,
  RDEMUX: 124,
  RMUX: 126,
  RECIPR: 149,
  RCM: 151,
  OR: 37,
  AND: 33,
  NOT: 34,
  XOR: 35,
  PID: 161,
  ETIMER: 62,
  TEXT: 45,
};

function trace(
  filename: string,
  sourceText: string | undefined,
  confidence: number,
  validationStatus: Traceability["validationStatus"] = "inferred"
): Traceability {
  return {
    sourceFilename: filename,
    sourceMethod: "STRING_SCRAPE",
    sourceText,
    confidence,
    validationStatus,
  };
}

function collectSpecParameters(
  strings: string[],
  blockToken: string
): Record<string, string> {
  const params: Record<string, string> = {};
  const idx = strings.findIndex((s) =>
    new RegExp(
      `\\b${blockToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "i"
    ).test(s)
  );
  const window = strings.slice(Math.max(0, idx - 12), idx + 24);

  for (const s of window) {
    const m = s.match(/\bS([1-9]|1[0-5])\b\s*[:=]?\s*(.*)$/i);
    if (m) {
      const key = `S${m[1]}`;
      const val = (m[2] || "").trim();
      if (!params[key]) params[key] = val || key;
    }
    const compact = s.match(/\bS([1-9]|1[0-5])([A-Za-z0-9.\-+/*_]+)/i);
    if (compact && !params[`S${compact[1]}`]) {
      params[`S${compact[1]}`] = compact[2];
    }
  }

  // Also harvest bare S1..S15 tokens near the block
  for (const s of window) {
    const bare = s.match(/^S([1-9]|1[0-5])$/i);
    if (bare && !params[`S${bare[1]}`]) params[`S${bare[1]}`] = `S${bare[1]}`;
  }

  return params;
}

function buildPorts(
  blockId: string,
  params: Record<string, string>,
  filename: string
): CadPort[] {
  const ports: CadPort[] = [];
  for (const [name, value] of Object.entries(params)) {
    const specIndex = Number(name.replace(/^S/i, ""));
    ports.push({
      id: newId("port"),
      blockId,
      name,
      specIndex: Number.isFinite(specIndex) ? specIndex : undefined,
      direction: "param",
      signalName: value !== name ? value : undefined,
      trace: trace(filename, `${name}=${value}`, 0.75),
    });
  }
  ports.push({
    id: newId("port"),
    blockId,
    name: "IN",
    direction: "in",
    trace: trace(filename, "IN", 0.55, "review_required"),
  });
  ports.push({
    id: newId("port"),
    blockId,
    name: "OUT",
    direction: "out",
    trace: trace(filename, "OUT", 0.55, "review_required"),
  });
  return ports;
}

/**
 * Build structured Engineering Logic Model from a parsed CAD sheet.
 * Deterministic extraction only — does not invent missing geometry.
 */
export function buildEngineeringModel(
  sheet: CadSheetParse,
  opts?: { sourcePath?: string }
): EngineeringSheetModel {
  const provenance = opts?.sourcePath
    ? parseProvenanceFromPath(opts.sourcePath)
    : undefined;

  const blocks: CadLogicBlock[] = [];
  const connections: CadConnection[] = [];
  const crossReferences: CadCrossReference[] = [];
  const tags: CadTagNode[] = [];
  const warnings: string[] = [];

  const pageWidth = 1200;
  const colGap = 280;
  const rowGap = 110;
  const blockW = 160;
  const blockH = 72;

  sheet.functionBlocks.forEach((fb, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const x = 80 + col * colGap;
    const y = 80 + row * rowGap;
    const blockId = fb.blockId || newId("block");
    const fc = fb.functionCode || "UNKNOWN";
    const params: Record<string, string> = {};
    for (const key of [
      "s0",
      "s0_5",
      "s1",
      "s2",
      "s3",
      "s4",
      "s5",
      "s6",
      "s7",
      "s8",
      "s9",
    ] as const) {
      const val = fb[key];
      if (val) params[key.toUpperCase().replace("_", ".")] = val;
    }

    // Enrich S1–S15 from nearby raw strings when available
    const enriched = collectSpecParameters(sheet.rawStrings, fc);
    for (const [k, v] of Object.entries(enriched)) {
      if (!params[k]) params[k] = v;
    }

    const ports = buildPorts(blockId, params, sheet.filename);
    blocks.push({
      id: blockId,
      type: /SEQ/i.test(fc)
        ? "SequenceBlock"
        : /TIMER|ETIMER|PULSE/i.test(fc)
          ? "TimingBlock"
          : "LogicBlock",
      functionCode: fc,
      functionCodeNumber: NUMERIC_FC_MAP[fc.toUpperCase()],
      label: fb.notes,
      blockNumber: fb.blockId,
      x,
      y,
      width: blockW,
      height: blockH,
      parameters: params,
      ports,
      inputRefs: fb.inputRefs,
      outputRefs: fb.outputRefs,
      deviceTags: fb.deviceTag ? [fb.deviceTag] : [],
      notes: fb.notes,
      trace: trace(sheet.filename, fc, 0.82),
    });
  });

  // Wire sequential blocks in reading order as inferred local connections
  // (geometry placeholder until native CAD coordinates are decoded).
  for (let i = 0; i < blocks.length - 1; i++) {
    const a = blocks[i];
    const b = blocks[i + 1];
    const outPort = a.ports.find((p) => p.direction === "out");
    const inPort = b.ports.find((p) => p.direction === "in");
    connections.push({
      id: newId("conn"),
      sourceBlockId: a.id,
      sourcePortId: outPort?.id,
      targetBlockId: b.id,
      targetPortId: inPort?.id,
      signalName: undefined,
      geometry: [
        {
          x1: a.x + a.width,
          y1: a.y + a.height / 2,
          x2: b.x,
          y2: b.y + b.height / 2,
        },
      ],
      referenceType: "local",
      resolved: true,
      trace: trace(
        sheet.filename,
        `${a.functionCode}->${b.functionCode}`,
        0.45,
        "review_required"
      ),
    });
  }

  // S-port same-name links between adjacent blocks (S1→S1 etc.)
  for (let i = 0; i < blocks.length - 1; i++) {
    const a = blocks[i];
    const b = blocks[i + 1];
    for (const pa of a.ports.filter((p) => p.direction === "param")) {
      const pb = b.ports.find((p) => p.name === pa.name);
      if (!pb) continue;
      connections.push({
        id: newId("conn"),
        sourceBlockId: a.id,
        sourcePortId: pa.id,
        targetBlockId: b.id,
        targetPortId: pb.id,
        signalName: pa.name,
        geometry: [
          {
            x1: a.x + a.width / 2,
            y1: a.y + a.height,
            x2: b.x + b.width / 2,
            y2: b.y,
          },
        ],
        referenceType: "local",
        resolved: true,
        trace: trace(sheet.filename, pa.name, 0.5, "review_required"),
      });
    }
  }

  for (const o of sheet.oreffs) {
    const resolved = Boolean(o.targetCad);
    crossReferences.push({
      id: newId("xref"),
      targetIdentifier: o.tag || o.raw,
      targetFile: o.targetCad,
      signal: o.tag,
      referenceType: resolved ? "cross_cad" : "unresolved",
      resolved,
      trace: trace(sheet.filename, o.raw, resolved ? 0.85 : 0.55, resolved ? "inferred" : "unresolved"),
    });
    if (!resolved) {
      warnings.push(`Unresolved cross-reference: ${o.raw.slice(0, 80)}`);
      connections.push({
        id: newId("conn"),
        signalName: o.tag || o.raw,
        geometry: [],
        crossSheetReference: o.targetCad || o.raw,
        referenceType: "unresolved",
        resolved: false,
        trace: trace(sheet.filename, o.raw, 0.5, "unresolved"),
      });
    }
  }

  for (const raw of sheet.deviceTags) {
    tags.push({
      id: newId("tag"),
      raw,
      normalized: raw.toUpperCase(),
      connectedBlockIds: blocks
        .filter((b) => b.deviceTags.some((t) => t.toUpperCase() === raw.toUpperCase()))
        .map((b) => b.id),
      trace: trace(sheet.filename, raw, 0.8),
    });
  }

  for (const io of sheet.ioRefs) {
    if (!io.deviceTag) continue;
    if (tags.some((t) => t.normalized === io.deviceTag!.toUpperCase())) continue;
    tags.push({
      id: newId("tag"),
      raw: io.deviceTag,
      normalized: io.deviceTag.toUpperCase(),
      ioType: io.ioType,
      connectedBlockIds: [],
      trace: trace(sheet.filename, io.raw, 0.78),
    });
  }

  const annotations: CadAnnotation[] = sheet.descriptions.slice(0, 80).map((text, i) => ({
    id: newId("ann"),
    text,
    kind: "description",
    x: 40,
    y: 0, // assigned after page layout is known
    trace: trace(sheet.filename, text, 0.7),
  }));

  if (sheet.title) {
    annotations.unshift({
      id: newId("ann"),
      text: sheet.title,
      kind: "title",
      x: 40,
      y: 28,
      trace: trace(sheet.filename, sheet.title, 0.9, "verified"),
    });
  }

  const rows = Math.max(1, Math.ceil(Math.max(blocks.length, 1) / 3));
  const blockBottom = 80 + rows * rowGap + blockH;
  const xrefBottom = 60 + crossReferences.length * 30 + 24;
  const annotationStackH = Math.max(0, annotations.length) * 16;
  // Page must fit blocks, full xref column, annotations, and footer — never clip.
  const pageHeight = Math.max(
    800,
    blockBottom + annotationStackH + 80,
    xrefBottom + annotationStackH + 80,
    120 + annotationStackH + 60
  );

  // Place description annotations above the footer, left side.
  const annStartY = pageHeight - 40 - annotationStackH;
  let annY = annStartY;
  for (const a of annotations) {
    if (a.kind === "title") {
      a.y = 28;
      continue;
    }
    a.y = annY;
    annY += 16;
  }

  if (blocks.length === 0) {
    warnings.push("No logic blocks detected — model needs review");
  }

  const unresolvedConnections = connections.filter((c) => !c.resolved).length;

  return {
    version: "1.0",
    filename: sheet.filename,
    sheetId: sheet.sheetId,
    title: sheet.title,
    provenance: provenance
      ? { loop: provenance.loop, cpu: provenance.cpu, module: provenance.module }
      : undefined,
    page: { width: pageWidth, height: pageHeight },
    blocks,
    connections,
    crossReferences,
    tags,
    annotations,
    layers: [
      { id: "border", name: "Page / Border", visible: true },
      { id: "blocks", name: "Logic Blocks", visible: true },
      { id: "ports", name: "Inputs / Outputs", visible: true },
      { id: "wires", name: "Wires", visible: true },
      { id: "tags", name: "Tags", visible: true },
      { id: "fc", name: "Function Codes", visible: true },
      { id: "xref", name: "Cross References", visible: true },
      { id: "annotations", name: "Annotations", visible: true },
      { id: "metadata", name: "Engineering Metadata", visible: true },
    ],
    stats: {
      blockCount: blocks.length,
      connectionCount: connections.length,
      tagCount: tags.length,
      crossRefCount: crossReferences.length,
      unresolvedConnections,
    },
    validation: {
      status:
        warnings.length > 0 || unresolvedConnections > 0
          ? "COMPLETED_WITH_WARNINGS"
          : "COMPLETED",
      warnings,
    },
  };
}

export function engineeringModelToDrawEntities(
  model: EngineeringSheetModel
): import("@infi90/core").CadDrawEntity[] {
  const entities: import("@infi90/core").CadDrawEntity[] = [];

  entities.push({
    type: "text",
    x: 24,
    y: 28,
    text: `${model.filename} — ${model.title ?? model.sheetId ?? "LOGIC"}`,
    label: "title",
  });

  for (const conn of model.connections) {
    for (const seg of conn.geometry) {
      entities.push({
        type: "line",
        x: seg.x1,
        y: seg.y1,
        x2: seg.x2,
        y2: seg.y2,
        label: conn.signalName,
      });
    }
  }

  for (const b of model.blocks) {
    const fcLabel = b.functionCodeNumber
      ? `(${b.functionCodeNumber}) ${b.functionCode}`
      : b.functionCode || "BLOCK";
    entities.push({
      type: "box",
      x: b.x,
      y: b.y,
      w: b.width,
      h: b.height,
      text: fcLabel,
      label: Object.keys(b.parameters).slice(0, 4).join(" "),
    });
  }

  for (const xref of model.crossReferences) {
    entities.push({
      type: "oref",
      x: model.page.width - 260,
      y: 80 + model.crossReferences.indexOf(xref) * 32,
      w: 220,
      h: 26,
      text: xref.targetIdentifier.slice(0, 36),
      label: xref.targetFile,
    });
  }

  let ay = model.page.height - 40 - model.annotations.length * 14;
  for (const a of model.annotations) {
    entities.push({
      type: "text",
      x: 40,
      y: Math.max(ay, model.page.height / 2),
      text: a.text.slice(0, 90),
    });
    ay += 14;
  }

  return entities;
}
