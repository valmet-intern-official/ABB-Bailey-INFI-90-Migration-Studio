import type { SceneGraph, SceneNode, Pt, PaintStyle, TextSpec } from "../scene/scene";
import { resolveColor, type Palette, type RGB } from "./palette";

/**
 * Device-independent draw list shared by the SVG, PDF and PNG back-ends so the
 * three outputs are produced from exactly the same primitives.
 */
export type DrawOp =
  | { op: "path"; nodeId: string; objectId: number; points: Pt[]; closed: boolean; fill: RGB | null; fillAlpha: number; fillIndex: number | null; fillStyle: number | null; stroke: RGB | null; strokeIndex: number | null; strokeWidth: number; dash: number[] | null }
  | { op: "text"; nodeId: string; objectId: number; at: Pt; text: string; size: number; anchor: "start" | "middle" | "end"; baseline: "bottom" | "middle" | "top"; color: RGB; colorIndex: number | null; scaleX: number; bold: boolean }
  | { op: "placeholder"; nodeId: string; objectId: number; at: Pt; templateName: string; label: string | null };

export interface Layout {
  width: number;
  height: number;
  scale: number;
  background: RGB;
  /** Source graphic only. No template names, no record ids. */
  ops: DrawOp[];
  /** Engineering tags at each instance origin. Does not move `ops`. */
  marking: DrawOp[];
  /** Template names, object ids and insertion crosses. Diagnostic only. */
  debug: DrawOp[];
  colorUse: Record<number, { source: string; uses: number }>;
}

export type RenderMode = "NORMAL" | "MARKING" | "SOURCE_DEBUG";

export interface LayoutOptions {
  palette: Palette;
  width?: number;
  /**
   * `true` keeps the previous behaviour of painting template names into the
   * graphic. Prefer `mode`. Default is NORMAL: unresolved templates are
   * recorded on the scene node and are not drawn as labels.
   */
  showPlaceholders?: boolean;
  mode?: RenderMode;
}

/** Reference displays draw 1-unit strokes as one screen pixel at ≈12 px/unit. */
const REFERENCE_PX_PER_UNIT = 12.1;

export function layoutScene(scene: SceneGraph, opts: LayoutOptions): Layout {
  const ext = scene.extent;
  const worldW = ext.maxX - ext.minX;
  const worldH = ext.maxY - ext.minY;
  const width = opts.width ?? 1280;
  const scale = width / worldW;
  const height = Math.round(worldH * scale);
  const toDev = ([x, y]: Pt): Pt => [(x - ext.minX) * scale, (ext.maxY - y) * scale];
  const colorUse: Layout["colorUse"] = {};
  const color = (i: number | null): RGB | null => {
    const e = resolveColor(opts.palette, i);
    if (!e) return null;
    const u = (colorUse[e.index] ??= { source: e.source, uses: 0 });
    u.uses++;
    return e.rgb;
  };
  const px = scale / REFERENCE_PX_PER_UNIT;

  const mode: RenderMode = opts.mode ?? (opts.showPlaceholders ? "SOURCE_DEBUG" : "NORMAL");
  const ops: DrawOp[] = [];
  const marking: DrawOp[] = [];
  const debug: DrawOp[] = [];
  const text = (n: SceneNode, t: TextSpec): Extract<DrawOp, { op: "text" }> | null => {
    if (!t.text) return null;
    return {
      op: "text",
      nodeId: n.nodeId,
      objectId: n.objectId,
      at: toDev(t.anchor),
      text: t.text,
      size: Math.max(1, t.height * scale),
      anchor: t.hAlign === 2 ? "middle" : t.hAlign === 3 ? "end" : "start",
      baseline: t.vAlign === 2 ? "middle" : t.vAlign === 1 ? "top" : "bottom",
      color: color(t.color) ?? [255, 255, 255],
      colorIndex: t.color,
      scaleX: t.scaleX,
      bold: t.font === 4,
    };
  };
  const paint = (st: PaintStyle, closed: boolean) => {
    const filled = closed && st.filled;
    return {
      fill: filled ? color(st.fillColor) : null,
      // RULE-STYLE-002 (CANDIDATE): fillStyle 2 is a 50 % dither; rendered as mean tone.
      fillAlpha: filled && st.fillStyle === 2 ? 0.5 : 1,
      fillIndex: filled ? st.fillColor : null,
      fillStyle: filled ? st.fillStyle : null,
      stroke: color(st.lineColor),
      strokeIndex: st.lineColor,
      strokeWidth: Math.max(0.5, st.lineWidth * px),
      dash: st.lineStyle === 2 ? [4 * px, 3 * px] : null,
    };
  };

  for (const n of scene.nodes) {
    if (n.kind === "shape") {
      ops.push({ op: "path", nodeId: n.nodeId, objectId: n.objectId, points: n.points.map(toDev), closed: n.closed, ...paint(n.style, n.closed) });
      if (n.label) {
        const t = text(n, n.label);
        if (t && n.shape === "rect" && n.points.length >= 2) {
          const xs = n.points.map((p) => toDev(p)[0]);
          const box = Math.max(...xs) - Math.min(...xs);
          const adv = t.text.length * t.size * (t.bold ? 0.62 : 0.56);
          if (adv > 0 && box > 8) t.scaleX = Math.min(t.scaleX, (box * 0.92) / adv);
        }
        if (t) ops.push(t);
      }
    } else if (n.kind === "text") {
      const t = text(n, n.text);
      if (t) ops.push(t);
      if (t && n.role === "tag") marking.push({ ...t, color: [255, 0, 0], bold: true });
    } else if (n.kind === "placeholder") {
      // The template name is a resource reference, not screen text. It is
      // drawn only in SOURCE_DEBUG. The instance stays in the scene graph
      // with reason TEMPLATE_GEOMETRY_UNRESOLVED.
      if (n.tag) {
        const at = toDev(n.insertion);
        const tag: DrawOp = {
          op: "text",
          nodeId: n.nodeId,
          objectId: n.objectId,
          at,
          text: n.tag,
          size: Math.max(8, 0.95 * scale),
          anchor: "start",
          baseline: "bottom",
          color: [255, 255, 255],
          colorIndex: null,
          scaleX: 1,
          bold: true,
        };
        ops.push(tag);
        marking.push({ ...tag, color: [255, 0, 0] });
      }
      if (n.label) {
        const at = toDev(n.insertion);
        ops.push({
          op: "text",
          nodeId: n.nodeId,
          objectId: n.objectId,
          at,
          text: n.label,
          size: Math.max(8, 1.05 * scale),
          anchor: "start",
          baseline: "bottom",
          color: [255, 255, 255],
          colorIndex: null,
          scaleX: 1,
          bold: false,
        });
      }
      debug.push({ op: "placeholder", nodeId: n.nodeId, objectId: n.objectId, at: toDev(n.insertion), templateName: n.templateName, label: n.label });
      debug.push({
        op: "text",
        nodeId: n.nodeId,
        objectId: n.objectId,
        at: toDev(n.insertion),
        text: `#${n.objectId}`,
        size: 8,
        anchor: "start",
        baseline: "top",
        color: [255, 102, 255],
        colorIndex: null,
        scaleX: 1,
        bold: false,
      });
      if (n.navigation && n.navigation !== n.tag) {
        marking.push({
          op: "text",
          nodeId: n.nodeId,
          objectId: n.objectId,
          at: toDev(n.insertion),
          text: n.navigation.replace(/^graphic:/, ""),
          size: 1.1 * scale,
          anchor: "start",
          baseline: "bottom",
          color: [255, 0, 0],
          colorIndex: null,
          scaleX: 1,
          bold: true,
        });
      }
    }
  }
  if (mode === "SOURCE_DEBUG") ops.push(...debug);
  return { width, height, scale, background: [0, 0, 0], ops, marking, debug, colorUse };
}
