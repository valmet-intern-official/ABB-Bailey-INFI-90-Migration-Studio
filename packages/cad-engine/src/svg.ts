import type { CadAnnotation, CadLogicBlock, EngineeringSheetModel } from "@infi90/core";
import { classifySymbol, type SymbolRole } from "./semantic/classify";
import { fitSheetToA3 } from "./layout/page";
import { layoutAndRoute } from "./layout/pipeline";

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

/** Canvas size — A3 sheets use fixed paper dimensions; otherwise grow to content. */
function computePageSize(model: EngineeringSheetModel): {
  width: number;
  height: number;
} {
  if (model.page.paperSize === "A3" && model.page.width && model.page.height) {
    return { width: model.page.width, height: model.page.height };
  }

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

  private hits(r: Rect, except?: Rect | null): boolean {
    for (const t of this.taken) {
      if (except && t === except) continue;
      if (
        except &&
        t.x === except.x &&
        t.y === except.y &&
        t.w === except.w &&
        t.h === except.h
      ) {
        continue;
      }
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
   * `except` lets a block's own footprint host its labels without colliding.
   */
  place(r: Rect, maxShift = 26, except?: Rect | null): Rect | null {
    if (!this.hits(r, except)) {
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
        if (!this.hits(cand, except)) {
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

function rectArea(r: Rect): number {
  return Math.max(0, r.w) * Math.max(0, r.h);
}

function overlapArea(a: Rect, b: Rect): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const w = x2 - x1;
  const h = y2 - y1;
  if (w <= 0 || h <= 0) return 0;
  return w * h;
}

function asRect(b: Pick<CadLogicBlock, "x" | "y" | "width" | "height">): Rect {
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

type LayoutBlock = CadLogicBlock & {
  /** When set, this block is drawn only as a note on the parent — no second box. */
  nestedUnderId?: string;
  /** Extra lines merged from contained child symbols. */
  nestedNotes?: string[];
};

/**
 * Resolve stacked Bailey symbols so boxes/labels never cover each other.
 *
 * Source CAD often nests markers (e.g. DI1SYS) inside an I/O module footprint
 * (e.g. RDI01A7). Drawing both rectangles at face value produces the overlap
 * users see in the viewer/PDF. Contained symbols are folded into the parent
 * label; remaining partial overlaps are nudged apart and wires follow.
 */
function prepareBlockLayout(model: EngineeringSheetModel): {
  blocks: LayoutBlock[];
  connections: EngineeringSheetModel["connections"];
} {
  const GAP = 6;
  const CONTAIN_RATIO = 0.65;

  const blocks: LayoutBlock[] = model.blocks.map((b) => ({
    ...b,
    nestedNotes: [],
  }));
  const movable = blocks.filter((b) => b.type !== "Junction");

  // Largest first so parents claim children before siblings compete.
  movable.sort((a, b) => rectArea(asRect(b)) - rectArea(asRect(a)));

  const suppressed = new Set<string>();
  for (let i = 0; i < movable.length; i++) {
    const parent = movable[i];
    if (suppressed.has(parent.id)) continue;
    const pr = asRect(parent);
    if (rectArea(pr) < 8) continue;

    for (let j = i + 1; j < movable.length; j++) {
      const child = movable[j];
      if (suppressed.has(child.id)) continue;
      const cr = asRect(child);
      const childArea = rectArea(cr);
      if (childArea < 4) continue;
      const ratio = overlapArea(pr, cr) / childArea;
      if (ratio < CONTAIN_RATIO) continue;

      // Fold nested symbol into the parent — do not draw a second overlapping box.
      suppressed.add(child.id);
      child.nestedUnderId = parent.id;
      const note =
        child.functionCodeNumber != null
          ? `+ (${child.functionCodeNumber}) ${child.functionCode ?? ""}${
              child.blockNumber ? ` #${child.blockNumber}` : ""
            }`
          : `+ ${child.functionCode ?? "SYM"}${
              child.blockNumber ? ` #${child.blockNumber}` : ""
            }`;
      parent.nestedNotes = parent.nestedNotes || [];
      parent.nestedNotes.push(note.trim());
    }
  }

  // Nudge remaining partial overlaps so rectangles stay clear of each other.
  const drawn = movable.filter((b) => !suppressed.has(b.id));
  const deltas = new Map<string, { dx: number; dy: number }>();

  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (let i = 0; i < drawn.length; i++) {
      for (let j = i + 1; j < drawn.length; j++) {
        const a = drawn[i];
        const b = drawn[j];
        const ar = asRect(a);
        const br = asRect(b);
        const o = overlapArea(ar, br);
        if (o <= 1) continue;

        // Move the smaller footprint.
        const moveA = rectArea(ar) <= rectArea(br);
        const moving = moveA ? a : b;
        const other = moveA ? b : a;
        const mr = asRect(moving);
        const or = asRect(other);

        const overlapX =
          Math.min(mr.x + mr.w, or.x + or.w) - Math.max(mr.x, or.x);
        const overlapY =
          Math.min(mr.y + mr.h, or.y + or.h) - Math.max(mr.y, or.y);

        let dx = 0;
        let dy = 0;
        if (overlapX <= overlapY) {
          // Push horizontally — choose the side with more room toward sheet flow.
          const pushRight = mr.x + mr.w / 2 >= or.x + or.w / 2;
          dx = pushRight ? overlapX + GAP : -(overlapX + GAP);
        } else {
          const pushDown = mr.y + mr.h / 2 >= or.y + or.h / 2;
          dy = pushDown ? overlapY + GAP : -(overlapY + GAP);
        }

        moving.x += dx;
        moving.y += dy;
        const prev = deltas.get(moving.id) || { dx: 0, dy: 0 };
        deltas.set(moving.id, { dx: prev.dx + dx, dy: prev.dy + dy });
        moved = true;
      }
    }
    if (!moved) break;
  }

  // Keep junction dots put; carry block nudges onto wire endpoints that were
  // attached near the original footprint so lines stay connected.
  const connections = model.connections.map((conn) => {
    if (deltas.size === 0 || conn.geometry.length === 0) return conn;
    const geometry = conn.geometry.map((seg) => {
      let { x1, y1, x2, y2 } = seg;
      for (const b of drawn) {
        const d = deltas.get(b.id);
        if (!d || (d.dx === 0 && d.dy === 0)) continue;
        // Original footprint before this block's accumulated nudge:
        const ox = b.x - d.dx;
        const oy = b.y - d.dy;
        const pad = 10;
        const hit = (x: number, y: number) =>
          x >= ox - pad &&
          x <= ox + b.width + pad &&
          y >= oy - pad &&
          y <= oy + b.height + pad;
        if (hit(x1, y1)) {
          x1 += d.dx;
          y1 += d.dy;
        }
        if (hit(x2, y2)) {
          x2 += d.dx;
          y2 += d.dy;
        }
      }
      return { ...seg, x1, y1, x2, y2 };
    });
    return { ...conn, geometry };
  });

  return { blocks, connections };
}

/**
 * Force every segment onto an axis-aligned HVH path so the SVG never emits
 * a diagonal line, even if upstream geometry still has one.
 */
function orthogonalizeGeometry(
  geometry: { x1: number; y1: number; x2: number; y2: number }[]
): { x1: number; y1: number; x2: number; y2: number }[] {
  const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const s of geometry) {
    const dx = Math.abs(s.x2 - s.x1);
    const dy = Math.abs(s.y2 - s.y1);
    if (dx < 0.51 || dy < 0.51) {
      out.push(s);
      continue;
    }
    // Horizontal then vertical.
    out.push({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y1 });
    out.push({ x1: s.x2, y1: s.y1, x2: s.x2, y2: s.y2 });
  }
  return out;
}

/**
 * Vector SVG renderer for the Engineering Logic Model.
 *
 * Used when CAD_RENDER_ENGINE is v1/v2. The product default (`source`) serves
 * the reconstruct pipeline SVG instead and does not call this function.
 */
export function renderEngineeringSvg(
  model: EngineeringSheetModel,
  opts: { engine?: "v1" | "v2" | "source" } = {}
): string {
  const raw =
    opts.engine ??
    (process.env.CAD_RENDER_ENGINE || "source").trim().toLowerCase();
  const engine: "v1" | "v2" = raw === "v1" ? "v1" : "v2";

  let working = model;
  if (engine === "v2") {
    working = layoutAndRoute(model).model;
  }

  const laidOut =
    engine === "v2"
      ? { blocks: working.blocks as LayoutBlock[], connections: working.connections }
      : prepareBlockLayout(working);

  // Hard guarantee: never draw diagonal segments.
  const connections = laidOut.connections.map((c) => ({
    ...c,
    geometry: orthogonalizeGeometry(c.geometry),
  }));

  let layoutModel: EngineeringSheetModel = {
    ...working,
    blocks: laidOut.blocks,
    connections,
  };
  // All CAD pages print on ISO A3 (v2 already fits in layoutAndRoute).
  if (engine === "v1") {
    layoutModel = fitSheetToA3(layoutModel);
  }
  const { width, height } = computePageSize(layoutModel);
  const space = new SpaceMap();

  const bg = engine === "v2" ? "#ffffff" : "#f7f4ef";

  const orientation = layoutModel.page.orientation ?? (width >= height ? "landscape" : "portrait");
  const paper = layoutModel.page.paperSize ?? "A3";

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-cad="${escapeXml(model.filename)}" data-engine="${engine}" data-paper="${paper}" data-orientation="${orientation}">`,
    `<rect width="100%" height="100%" fill="${bg}"/>`,
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
  for (const conn of connections) {
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

  // ---- Layer: blocks (nested children skipped — folded into parent labels)
  parts.push(`<g data-layer="blocks">`);
  const labelQueue: Array<{
    b: LayoutBlock;
    lines: string[];
    style: { text: string };
  }> = [];

  for (const b of laidOut.blocks) {
    if (b.nestedUnderId) continue; // absorbed into parent

    const style = blockStyle(b);

    // Junctions are wire hardware, not labelled blocks — draw the dot.
    if (b.type === "Junction") {
      parts.push(
        `<circle data-block-id="${b.id}" data-entity-type="junction" data-source-offset="${b.trace.sourceIndex ?? ""}" cx="${round(b.x + b.width / 2)}" cy="${round(b.y + b.height / 2)}" r="${Math.max(1.6, b.width / 2)}" fill="${style.fill}"/>`
      );
      space.reserve({ x: b.x, y: b.y, w: b.width, h: b.height });
      continue;
    }

    const rot = engine === "v2" ? 0 : Number(b.parameters.ROT ?? 0);
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
    // Surface timer / S params on the block.
    for (const [k, v] of Object.entries(b.parameters)) {
      if (/^TO=/i.test(k) || k === "TO") lines.push(`${k}=${v}`);
      else if (/^S\d+$/i.test(k) && lines.length < 5) lines.push(`${k}=${v}`);
    }
    if (b.nestedNotes?.length) lines.push(...b.nestedNotes);
    labelQueue.push({ b, lines, style });
  }
  parts.push(`</g>`);

  // ---- Layer: block labels — collision-checked; own footprint is allowed
  parts.push(`<g data-layer="fc">`);
  for (const { b, lines, style } of labelQueue) {
    const own = { x: b.x, y: b.y, w: b.width, h: b.height };
    const size = Math.max(
      7,
      Math.min(10.5, b.height / Math.max(3.2, lines.length + 0.5))
    );
    let y = b.y + size + 1.5;
    for (const line of lines) {
      const w = Math.min(line.length * size * CHAR_W, Math.max(8, b.width - 4));
      const want: Rect = { x: b.x + 2, y: y - size, w, h: size + 1 };
      const at = space.place(want, 48, own) ?? want;
      parts.push(
        `<text x="${round(at.x + 1)}" y="${round(at.y + size)}" font-family="Consolas, monospace" font-size="${round(size)}" font-weight="${line === lines[0] ? 700 : 400}" fill="${style.text}">${escapeXml(line)}</text>`
      );
      y = at.y + size + 1.5 + size;
    }
  }
  parts.push(`</g>`);

  // ---- Layer: cross refs. Decoded models place these in the drawing
  // already, so only legacy models without coordinates get the column.
  const columnXrefs = working.crossReferences.filter((x) => x.x == null);
  if (columnXrefs.length > 0) {
    parts.push(`<g data-layer="xref">`);
    columnXrefs.forEach((xref, i) => {
      const x = width - 250;
      const y = 60 + i * 30;
      parts.push(
        `<rect data-xref-id="${xref.id}" x="${x}" y="${y}" width="210" height="24" fill="#dde8df" stroke="#2f6b4f" rx="2"/>`,
        `<text x="${x + 6}" y="${y + 16}" font-family="Consolas, monospace" font-size="10" fill="#1f2a24">${escapeXml(xref.targetIdentifier.slice(0, 28))}</text>`
      );
      space.reserve({ x, y, w: 210, h: 24 });
    });
    parts.push(`</g>`);
  }

  // ---- Layer: annotations, at decoded anchors and source glyph height.
  // Longest first, so the most informative text wins any contested space.
  parts.push(`<g data-layer="annotations">`);
  const anns = working.annotations.filter((a) => a.kind !== "title");
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
      at = space.place({ x: a.x, y: a.y - size, w, h: size + 1 }, 48);
    } else {
      at = { x: 28, y: stackY - size, w, h: size + 1 };
      stackY += 14;
      space.reserve(at);
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
  const nestedCount = laidOut.blocks.filter((b) => b.nestedUnderId).length;
  const overlapNote =
    (dropped > 0 ? `  hidden-labels:${dropped}` : "") +
    (nestedCount > 0 ? `  nested-merged:${nestedCount}` : "") +
    `  engine:${engine}`;
  parts.push(
    `<text x="28" y="${height - 14}" font-family="Consolas, monospace" font-size="9" fill="#5a6b62">blocks:${model.stats.blockCount}  conn:${model.stats.connectionCount}  tags:${model.stats.tagCount}  xref:${model.stats.crossRefCount}  unresolved:${model.stats.unresolvedConnections}  status:${working.validation.status}${overlapNote}</text>`
  );

  parts.push(`</svg>`);
  return parts.join("\n");
}
