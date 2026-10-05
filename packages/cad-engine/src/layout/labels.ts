import type { CadAnnotation, EngineeringSheetModel } from "@infi90/core";
import { LAYOUT_CONFIG, snap } from "./config";
import type { LogicGraph } from "./graph";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

class SpaceMap {
  private taken: Rect[] = [];

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

  place(r: Rect, maxShift = 40): Rect | null {
    if (!this.hits(r)) {
      this.reserve(r);
      return r;
    }
    for (let d = 4; d <= maxShift; d += 4) {
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

/**
 * Reposition annotations near their associated source Y / group without
 * overlapping blocks. Returns updated annotation list.
 */
export function placeLabels(
  graph: LogicGraph,
  model: EngineeringSheetModel,
  pageWidth: number,
  pageHeight: number
): CadAnnotation[] {
  const space = new SpaceMap();
  const cfg = LAYOUT_CONFIG;

  // Reserve blocks.
  for (const id of graph.nodeOrder) {
    const n = graph.nodes.get(id)!;
    space.reserve({
      x: n.x - cfg.labelClearance,
      y: n.y - cfg.labelClearance,
      w: n.width + cfg.labelClearance * 2,
      h: n.height + cfg.labelClearance * 2,
    });
  }

  // Reserve title / footer.
  space.reserve({ x: 0, y: 0, w: pageWidth, h: cfg.titleBand });
  space.reserve({
    x: 0,
    y: pageHeight - cfg.footerBand,
    w: pageWidth,
    h: cfg.footerBand,
  });

  const charW = cfg.charWidth * 0.85;
  const out: CadAnnotation[] = [];

  // STEP labels go to the left of their group band.
  const stepAnns = model.annotations.filter((a) => /\bSTEP/i.test(a.text));
  const other = model.annotations.filter((a) => !/\bSTEP/i.test(a.text));

  for (const a of stepAnns) {
    // Find nearest group node by source Y.
    let bestY = a.y;
    let bestDist = Infinity;
    for (const id of graph.nodeOrder) {
      const n = graph.nodes.get(id)!;
      if (!n.groupId) continue;
      const sy = n.block.sourceGeometry?.originalY ?? n.block.y;
      const d = Math.abs(sy - a.y);
      if (d < bestDist) {
        bestDist = d;
        bestY = n.y;
      }
    }
    const size = a.height && a.height >= 4 ? Math.min(a.height, 14) : 11;
    const w = a.text.length * charW;
    const want: Rect = {
      x: snap(cfg.pageMargin / 2),
      y: snap(bestY - size),
      w,
      h: size + 2,
    };
    const at = space.place(want, 60) ?? want;
    out.push({ ...a, x: at.x, y: at.y + size, height: size });
  }

  for (const a of other) {
    if (a.kind === "title") {
      out.push({ ...a, x: cfg.pageMargin, y: 32 });
      continue;
    }
    const size = a.height && a.height >= 4 ? Math.min(a.height, 12) : 9;
    const w = Math.min(a.text.length * charW, pageWidth - cfg.pageMargin * 2);
    // Prefer left margin stack for metadata; keep near top for short tags.
    const preferTop = a.text.length < 40 && /[A-Z]{2,}/.test(a.text);
    const want: Rect = preferTop
      ? { x: snap(cfg.pageMargin), y: snap(cfg.titleBand + 4), w, h: size + 2 }
      : {
          x: snap(cfg.pageMargin),
          y: snap(pageHeight - cfg.footerBand - 20),
          w,
          h: size + 2,
        };
    const at = space.place(want, 80);
    if (!at) continue; // drop only if nowhere to place — rare
    out.push({ ...a, x: at.x, y: at.y + size, height: size });
  }

  return out;
}
