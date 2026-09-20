import type { CadAnnotation, CadLogicBlock, EngineeringSheetModel } from "@infi90/core";
import { classifySymbol, type SymbolRole } from "./semantic/classify";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Compute canvas size from all placed elements so nothing is clipped. */
function computePageSize(model: EngineeringSheetModel): {
  width: number;
  height: number;
} {
  let maxX = model.page.width || 1200;
  let maxY = model.page.height || 800;

  for (const b of model.blocks) {
    maxX = Math.max(maxX, b.x + b.width + 40);
    maxY = Math.max(maxY, b.y + b.height + 40);
  }
  for (const conn of model.connections) {
    for (const seg of conn.geometry) {
      maxX = Math.max(maxX, seg.x1 + 40, seg.x2 + 40);
      maxY = Math.max(maxY, seg.y1 + 40, seg.y2 + 40);
    }
  }
  // Legacy models stack cross-references in a right-hand column; decoded
  // models carry real positions and need no extra room.
  const columnXrefs = model.crossReferences.filter((x) => x.x == null);
  if (columnXrefs.length > 0) {
    maxX = Math.max(maxX, (model.page.width || 1200) - 250 + 210 + 40);
    maxY = Math.max(maxY, 60 + columnXrefs.length * 30 + 40);
  }
  for (const a of model.annotations) maxY = Math.max(maxY, a.y + 24);

  return { width: Math.ceil(maxX), height: Math.ceil(maxY + 24) };
}

const ROLE_STYLE: Record<SymbolRole, { fill: string; stroke: string; text: string }> = {
  border: { fill: "none", stroke: "#1f2a24", text: "#1f2a24" },
  frame: { fill: "none", stroke: "#9aa8a0", text: "#5a6b62" },
  connector: { fill: "#c2410c", stroke: "#c2410c", text: "#c2410c" },
  "input-ref": { fill: "#eef4ff", stroke: "#1d4ed8", text: "#1d3a8a" },
  "output-ref": { fill: "#fff8ec", stroke: "#b45309", text: "#8a4708" },
  logic: { fill: "#ffffff", stroke: "#1f2a24", text: "#1f2a24" },
  "io-module": { fill: "#f4f6f5", stroke: "#3d4f45", text: "#1f2a24" },
  generic: { fill: "#fafafa", stroke: "#6b7280", text: "#374151" },
};

function blockStyle(b: CadLogicBlock) {
  return ROLE_STYLE[classifySymbol(b.functionCode)] ?? ROLE_STYLE.generic;
}

// ---------------------------------------------------------------------------
// Overlap control
// ---------------------------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Keeps track of occupied space so labels never cover another element.
 * Source text positions are honoured first; only when a label would collide
 * is it nudged, and only along the axis that resolves the collision.
 */
class SpaceMap {
  private readonly taken: Rect[] = [];

  reserve(r: Rect) {
    this.taken.push(r);
  }

  private hits(r: Rect): boolean {
    for (const t of this.taken) {
      if (r.x < t.x + t.w && r.x + r.w > t.x && r.y < t.y + t.h && r.y + r.h > t.y) {
        return true;
      }
    }
    return false;
  }

  /**
   * Find a free position near the requested one. Candidates step away
   * vertically first, since engineering sheets are laid out in rows and
   * vertical nudges preserve left-to-right signal order.
   */
  place(r: Rect, maxShift = 26): Rect | null {
    if (!this.hits(r)) {
      this.reserve(r);
      return r;
    }
    for (let d = 3; d <= maxShift; d += 3) {
      for (const cand of [
        { ...r, y: r.y - d },
        { ...r, y: r.y + d },
        { ...r, x: r.x + d },
        { ...r, x: r.x - d },
      ]) {
        if (!this.hits(cand)) {
          this.reserve(cand);
          return cand;
        }
      }
    }
    return null;
  }
}

/** Monospace advance width, used to size label boxes for collision tests. */
const CHAR_W = 0.62;

/**
 * Vector SVG renderer for the Engineering Logic Model.
 *
 * Element geometry is drawn exactly where the source records place it. Only
 * text is allowed to move, and only to avoid obscuring another element.
 * Emits data-* attributes for interactive viewer hit-testing.
 */
export function renderEngineeringSvg(model: EngineeringSheetModel): string {
  const { width, height } = computePageSize(model);
  const space = new SpaceMap();

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-cad="${escapeXml(model.filename)}">`,
    `<rect width="100%" height="100%" fill="#f7f4ef"/>`,
    `<rect x="12" y="12" width="${width - 24}" height="${height - 24}" fill="none" stroke="#1f2a24" stroke-width="1.5"/>`,
  ];

  const titleText = `${model.filename} — ${model.title ?? model.sheetId ?? "LOGIC"}`;
  parts.push(
    `<text x="28" y="36" font-family="Consolas, monospace" font-size="14" fill="#1f2a24" font-weight="700">${escapeXml(titleText)}</text>`
  );
  space.reserve({ x: 24, y: 22, w: titleText.length * 14 * CHAR_W, h: 20 });
  // The footer strip is reserved so nothing is drawn under it.
  space.reserve({ x: 12, y: height - 30, w: width - 24, h: 26 });

  // ---- Layer: wires. Drawn first so symbols sit on top of them.
  parts.push(`<g data-layer="wires">`);
  for (const conn of model.connections) {
    const stroke = conn.resolved ? "#3d4f45" : "#b45309";
    const dash = conn.resolved ? "" : ` stroke-dasharray="4 3"`;
    // A routed wire is one polyline, so its corners are preserved.
    if (conn.geometry.length > 1) {
      const pts = [
        `${conn.geometry[0].x1},${conn.geometry[0].y1}`,
        ...conn.geometry.map((s) => `${s.x2},${s.y2}`),
      ].join(" ");
      parts.push(
        `<polyline data-connection-id="${conn.id}" data-signal="${escapeXml(conn.signalName || "")}" data-source-block="${conn.sourceBlockId ?? ""}" data-target-block="${conn.targetBlockId ?? ""}" points="${pts}" fill="none" stroke="${stroke}" stroke-width="1.4"${dash}/>`
      );
    } else if (conn.geometry.length === 1) {
      const seg = conn.geometry[0];
      parts.push(
        `<line data-connection-id="${conn.id}" data-signal="${escapeXml(conn.signalName || "")}" data-source-block="${conn.sourceBlockId ?? ""}" data-target-block="${conn.targetBlockId ?? ""}" x1="${seg.x1}" y1="${seg.y1}" x2="${seg.x2}" y2="${seg.y2}" stroke="${stroke}" stroke-width="1.4"${dash}/>`
      );
    }
  }
  parts.push(`</g>`);

  // ---- Layer: blocks, at their exact decoded footprints
  parts.push(`<g data-layer="blocks">`);
  const labelQueue: Array<{ b: CadLogicBlock; lines: string[]; style: { text: string } }> = [];

  for (const b of model.blocks) {
    const style = blockStyle(b);

    // Junctions are wire hardware, not labelled blocks — draw the dot.
    if (b.type === "Junction") {
      parts.push(
        `<circle data-block-id="${b.id}" data-entity-type="junction" data-source-offset="${b.trace.sourceIndex ?? ""}" cx="${round(b.x + b.width / 2)}" cy="${round(b.y + b.height / 2)}" r="${Math.max(1.6, b.width / 2)}" fill="${style.fill}"/>`
      );
      space.reserve({ x: b.x, y: b.y, w: b.width, h: b.height });
      continue;
    }

    const rot = Number(b.parameters.ROT ?? 0);
    const transform =
      rot > 0
        ? ` transform="rotate(${rot} ${round(b.x + b.width / 2)} ${round(b.y + b.height / 2)})"`
        : "";

    parts.push(
      `<g data-block-id="${b.id}" data-entity-type="function-block" data-function-code="${escapeXml(b.functionCode || "")}" data-block-number="${escapeXml(b.blockNumber || "")}" data-source-file="${escapeXml(model.filename)}" data-source-offset="${b.trace.sourceIndex ?? ""}" class="cad-block" style="cursor:pointer">`,
      `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="${style.fill}" stroke="${style.stroke}" stroke-width="1.3" rx="1"${transform}/>`,
      `</g>`
    );
    space.reserve({ x: b.x, y: b.y, w: b.width, h: b.height });

    const fc =
      b.functionCodeNumber != null
        ? `(${b.functionCodeNumber}) ${b.functionCode ?? ""}`
        : b.functionCode ?? "BLOCK";
    const lines = [fc];
    if (b.blockNumber) lines.push(`#${b.blockNumber}`);
    if (b.label && b.label !== b.functionCode) lines.push(b.label);
    labelQueue.push({ b, lines, style });
  }
  parts.push(`</g>`);

  // ---- Layer: block labels, placed after every footprint is reserved so a
  // label can never be written over a symbol or a neighbouring label.
  parts.push(`<g data-layer="fc">`);
  for (const { b, lines, style } of labelQueue) {
    const size = Math.max(7, Math.min(10.5, b.height / 3.2));
    let y = b.y + size + 1.5;
    for (const line of lines) {
      const w = line.length * size * CHAR_W;
      // Prefer inside the footprint; the symbol itself is not an obstacle for
      // its own label, so test against everything placed except that rect.
      const want: Rect = { x: b.x + 2, y: y - size, w, h: size + 1 };
      const fits = w <= b.width - 3 && y <= b.y + b.height;
      const at = fits ? want : space.place(want);
      if (!at) continue;
      parts.push(
        `<text x="${round(at.x + 1)}" y="${round(at.y + size)}" font-family="Consolas, monospace" font-size="${round(size)}" font-weight="${line === lines[0] ? 700 : 400}" fill="${style.text}">${escapeXml(line)}</text>`
      );
      y += size + 1.5;
      if (y > b.y + b.height) break;
    }
  }
  parts.push(`</g>`);

  // ---- Layer: cross refs. Decoded models place these in the drawing
  // already, so only legacy models without coordinates get the column.
  const columnXrefs = model.crossReferences.filter((x) => x.x == null);
  if (columnXrefs.length > 0) {
    parts.push(`<g data-layer="xref">`);
    columnXrefs.forEach((xref, i) => {
      const x = width - 250;
      const y = 60 + i * 30;
      parts.push(
        `<rect data-xref-id="${xref.id}" x="${x}" y="${y}" width="210" height="24" fill="#dde8df" stroke="#2f6b4f" rx="2"/>`,
        `<text x="${x + 6}" y="${y + 16}" font-family="Consolas, monospace" font-size="10" fill="#1f2a24">${escapeXml(xref.targetIdentifier.slice(0, 28))}</text>`
      );
    });
    parts.push(`</g>`);
  }

  // ---- Layer: annotations, at decoded anchors and source glyph height.
  // Longest first, so the most informative text wins any contested space.
  parts.push(`<g data-layer="annotations">`);
  const anns = model.annotations.filter((a) => a.kind !== "title");
  const positioned = anns.length > 0 && anns.every((a) => a.y > 40);
  const ordered: CadAnnotation[] = positioned
    ? [...anns].sort((p, q) => q.text.length - p.text.length)
    : anns;
  let stackY = height - 40 - anns.length * 14;
  let dropped = 0;

  for (const a of ordered) {
    const size = a.height && a.height >= 4 ? Math.min(a.height, 22) : 9.5;
    const w = a.text.length * size * CHAR_W;
    let at: Rect | null;
    if (positioned) {
      at = space.place({ x: a.x, y: a.y - size, w, h: size + 1 });
    } else {
      at = { x: 28, y: stackY - size, w, h: size + 1 };
      stackY += 14;
    }
    if (!at) {
      dropped++;
      continue;
    }
    parts.push(
      `<text data-entity-type="annotation" data-source-offset="${a.trace.sourceIndex ?? ""}" x="${round(at.x)}" y="${round(at.y + size)}" font-family="Consolas, monospace" font-size="${round(size)}" fill="#1f2a24">${escapeXml(a.text)}</text>`
    );
  }
  parts.push(`</g>`);

  // Metadata footer — states what could not be placed, rather than hiding it.
  const overlapNote = dropped > 0 ? `  hidden-labels:${dropped}` : "";
  parts.push(
    `<text x="28" y="${height - 14}" font-family="Consolas, monospace" font-size="9" fill="#5a6b62">blocks:${model.stats.blockCount}  conn:${model.stats.connectionCount}  tags:${model.stats.tagCount}  xref:${model.stats.crossRefCount}  unresolved:${model.stats.unresolvedConnections}  status:${model.validation.status}${overlapNote}</text>`
  );

  parts.push(`</svg>`);
  return parts.join("\n");
}
