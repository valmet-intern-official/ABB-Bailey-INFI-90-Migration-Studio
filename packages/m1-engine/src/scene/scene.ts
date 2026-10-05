import type { DecodedM1, M1Record } from "../decoder/types";
import { extractBindings, type InstanceBindings } from "../bindings/bindings";
import type { TemplateLibrary } from "../templates/library";
import {
  apply,
  bboxOf,
  compose,
  fromMat2x3,
  fromScal2d,
  IDENTITY,
  unionBBox,
  type Affine,
  type BBox,
} from "../geometry/transform";

export type Pt = [number, number];

export interface PaintStyle {
  lineColor: number | null;
  lineStyle: number | null;
  lineWidth: number;
  fillColor: number | null;
  fillStyle: number | null;
  fillPattern: number | null;
  filled: boolean;
}

interface NodeBase {
  nodeId: string;
  objectId: number;
  className: string;
  offset: number;
  /** Ancestor object ids from the Model root to the direct parent. */
  path: number[];
  order: number;
  transform: Affine;
  bbox: BBox | null;
}

export interface ShapeNode extends NodeBase {
  kind: "shape";
  shape: "rect" | "polyline" | "polygon" | "ellipse" | "sector" | "spline";
  points: Pt[];
  closed: boolean;
  style: PaintStyle;
  /** For TRect: embedded label. */
  label?: TextSpec;
}

export interface TextSpec {
  text: string;
  anchor: Pt;
  height: number;
  hAlign: number;
  vAlign: number;
  font: number;
  color: number | null;
  scaleX: number;
}

export interface TextNode extends NodeBase {
  kind: "text";
  text: TextSpec;
  /** `tag` is the instance's engineering tag, painted again in the marking overlay. */
  role?: "source" | "tag";
}

export interface PlaceholderNode extends NodeBase {
  kind: "placeholder";
  templateName: string;
  insertion: Pt;
  scale: [number, number];
  label: string | null;
  tag: string | null;
  navigation: string | null;
  bindings: InstanceBindings | null;
  reason: string;
}

export interface MarkerNode extends NodeBase {
  kind: "marker";
  point: Pt;
  symbolNames: string[];
}

export type SceneNode = ShapeNode | TextNode | PlaceholderNode | MarkerNode;

export interface SceneIssue {
  severity: "ERROR" | "WARNING" | "INFO";
  code: string;
  objectId: number;
  message: string;
}

export interface SceneGraph {
  file: string;
  modelName: string;
  extent: BBox;
  extentRule: string;
  contentBBox: BBox | null;
  nodes: SceneNode[];
  issues: SceneIssue[];
  stats: Record<string, number>;
  /** Template names whose geometry was instantiated from the symbol library. */
  instantiatedTemplates: string[];
}

export interface SceneOptions {
  library?: TemplateLibrary | null;
  /** Shared across the page and the submodels it instantiates. */
  cache?: Map<string, SceneGraph | null>;
}

const ELLIPSE_SEGMENTS = 96;

export function buildSceneGraph(m1: DecodedM1, opts: SceneOptions = {}): SceneGraph {
  const options: SceneOptions = { ...opts, cache: opts.cache ?? new Map() };
  const get = (id: number): M1Record | undefined => m1.records[id - 1];
  const instantiated = new Set<string>();
  const localOf = (name: string): SceneGraph | null => {
    if (!options.library) return null;
    const cache = options.cache!;
    if (cache.has(name)) return cache.get(name) ?? null;
    const tpl = options.library.get(name);
    if (!tpl) {
      cache.set(name, null);
      return null;
    }
    cache.set(name, null);
    try {
      const scene = buildSceneGraph(tpl, options);
      cache.set(name, scene);
      return scene;
    } catch {
      return null;
    }
  };
  const bindings = new Map(extractBindings(m1).map((b) => [b.instanceId, b]));
  const nodes: SceneNode[] = [];
  const issues: SceneIssue[] = [];
  const stats: Record<string, number> = {};
  const bump = (k: string) => (stats[k] = (stats[k] ?? 0) + 1);

  const model = m1.records.find((r) => r.className === "Model");
  if (!model) throw new Error("no Model record");

  const localTransform = (d: { transformRef?: number }, objectId: number): Affine => {
    if (!d.transformRef) return IDENTITY;
    const t = get(d.transformRef);
    if (t?.className === "Scal2d") return fromScal2d(t.decoded as never);
    if (t?.className === "Mat2x3") return fromMat2x3(t.decoded as never);
    issues.push({ severity: "ERROR", code: "BAD_TRANSFORM", objectId, message: `transformRef ${d.transformRef} is ${t?.className}` });
    return IDENTITY;
  };

  const pointsOf = (ids: number[] | undefined, objectId: number): Pt[] => {
    const pts: Pt[] = [];
    if (!ids) return pts;
    for (const id of ids) {
      const r = get(id);
      if (r?.className === "PtArray") pts.push(...((r.decoded as { points: Pt[] }).points));
      else if (r?.className === "Point") {
        const p = r.decoded as { x: number; y: number };
        pts.push([p.x, p.y]);
      } else issues.push({ severity: "ERROR", code: "BAD_GEOMETRY", objectId, message: `geometry ref ${id} is ${r?.className}` });
    }
    return pts;
  };

  const styleOf = (s: Record<string, number> | undefined): PaintStyle => ({
    lineColor: s?.lineColor ?? null,
    lineStyle: s?.lineStyle ?? null,
    lineWidth: s?.lineWidth ?? 1,
    fillColor: s?.fillColor ?? null,
    fillStyle: s?.fillStyle ?? null,
    fillPattern: s?.fillPattern ?? null,
    filled: (s?.filled ?? 0) === 1,
  });

  let order = 0;
  const visit = (id: number, parentT: Affine, path: number[], inherited?: PaintStyle) => {
    const r = get(id);
    if (!r) return;
    const d = r.decoded as Record<string, any>;
    const T = compose(parentT, localTransform(d, r.id));
    const base = { nodeId: `o${r.id}`, objectId: r.id, className: r.className, offset: r.offset, path, transform: T };
    bump(r.className);

    switch (r.className) {
      case "Group":
      case "FillGroup": {
        const st = r.className === "FillGroup" ? styleOf(d.style) : inherited;
        if (!Array.isArray(d.children)) return;
        for (const c of d.children as number[]) visit(c, T, [...path, r.id], st);
        return;
      }
      case "G_Rect_30":
      case "G_TRect_30": {
        const [p0, p1] = pointsOf(d.geometry, r.id);
        if (!p0 || !p1) return;
        const local: Pt[] = [p0, [p1[0], p0[1]], p1, [p0[0], p1[1]]];
        const pts = local.map((p) => apply(T, p));
        const node: ShapeNode = { ...base, kind: "shape", shape: "rect", points: pts, closed: true, style: styleOf(d.style), order: order++, bbox: bboxOf(pts) };
        if (r.className === "G_TRect_30") {
          const cx = (p0[0] + p1[0]) / 2;
          const cy = (p0[1] + p1[1]) / 2;
          const hx = d.hAlign === 2 ? cx : Math.min(p0[0], p1[0]);
          node.label = {
            text: d.text,
            anchor: apply(T, [hx, cy]),
            height: (d.height / 65536) * Math.abs(T.d),
            hAlign: d.hAlign,
            vAlign: 2,
            font: d.font,
            color: d.color,
            scaleX: Math.abs(T.a / (T.d || 1)),
          };
        }
        nodes.push(node);
        return;
      }
      case "G_Line_30": {
        const pts = pointsOf(d.geometry, r.id).map((p) => apply(T, p));
        const style = styleOf(d.style);
        const first = pts[0], last = pts[pts.length - 1];
        const closed = pts.length > 2 && first[0] === last[0] && first[1] === last[1];
        nodes.push({ ...base, kind: "shape", shape: style.filled && closed ? "polygon" : "polyline", points: pts, closed, style, order: order++, bbox: bboxOf(pts) });
        return;
      }
      case "G_Circ_30": {
        const [c, e] = pointsOf(d.geometry, r.id);
        if (!c || !e) return;
        const rad = Math.hypot(e[0] - c[0], e[1] - c[1]);
        const pts: Pt[] = [];
        for (let i = 0; i < ELLIPSE_SEGMENTS; i++) {
          const a = (i / ELLIPSE_SEGMENTS) * Math.PI * 2;
          pts.push(apply(T, [c[0] + rad * Math.cos(a), c[1] + rad * Math.sin(a)]));
        }
        nodes.push({ ...base, kind: "shape", shape: "ellipse", points: pts, closed: true, style: styleOf(d.style), order: order++, bbox: bboxOf(pts) });
        return;
      }
      case "G_Sect_30": {
        const [c, s] = pointsOf(d.geometry, r.id);
        if (!c || !s) return;
        const rad = Math.hypot(s[0] - c[0], s[1] - c[1]);
        const start = (d.startAngle * Math.PI) / 180;
        const sweep = (d.sweepAngle * Math.PI) / 180;
        const n = Math.max(8, Math.ceil((Math.abs(d.sweepAngle) / 360) * ELLIPSE_SEGMENTS));
        const pts: Pt[] = [apply(T, c)];
        for (let i = 0; i <= n; i++) {
          const a = start + (sweep * i) / n;
          pts.push(apply(T, [c[0] + rad * Math.cos(a), c[1] + rad * Math.sin(a)]));
        }
        nodes.push({ ...base, kind: "shape", shape: "sector", points: pts, closed: true, style: styleOf(d.style), order: order++, bbox: bboxOf(pts) });
        return;
      }
      case "G_Spline_30": {
        const pts = pointsOf(d.geometry, r.id).map((p) => apply(T, p));
        const style = styleOf(d.style);
        const fillFrom = inherited && inherited.filled ? inherited : style;
        nodes.push({
          ...base,
          kind: "shape",
          shape: "spline",
          points: pts,
          closed: d.closed === 1,
          style: { ...style, filled: fillFrom.filled && d.closed === 1, fillColor: fillFrom.fillColor, fillStyle: fillFrom.fillStyle, fillPattern: fillFrom.fillPattern },
          order: order++,
          bbox: bboxOf(pts),
        });
        return;
      }
      case "Text": {
        const [a] = pointsOf(d.anchor, r.id);
        if (!a) return;
        const anchor = apply(T, a);
        nodes.push({
          ...base,
          kind: "text",
          text: {
            text: d.text,
            anchor,
            height: (d.height / 65536) * Math.abs(T.d),
            hAlign: d.hAlign,
            vAlign: d.vAlign,
            font: d.font,
            color: d.color,
            scaleX: Math.abs(T.a / (T.d || 1)),
          },
          order: order++,
          bbox: bboxOf([anchor]),
        });
        return;
      }
      case "ModInst": {
        const b = bindings.get(r.id) ?? null;
        const insertion = apply(T, [0, 0]);
        const prop = (k: string) => b?.properties.find((p) => p.key === k)?.value;
        const label = typeof prop("button_label") === "string" ? (prop("button_label") as string) : null;
        const nav = prop("graphic_index");
        const local = typeof d.templateName === "string" ? localOf(d.templateName) : null;
        const drawn = local?.nodes.filter((n) => n.kind !== "marker") ?? [];
        if (local && drawn.some((n) => n.kind === "shape" || n.kind === "text")) {
          instantiated.add(d.templateName);
          for (const name of local.instantiatedTemplates) instantiated.add(name);
          const seen = new Set<string>();
          const trace = { objectId: r.id, offset: r.offset, path, prefix: base.nodeId };
          let symbolBox: BBox | null = null;
          for (const n of drawn) {
            const placed = mapThrough(n, T, trace, order++);
            if (placed.bbox && !sitsOnPage(placed.bbox)) continue;
            if (placed.kind === "text" && placed.text.text) seen.add(placed.text.text);
            if (placed.kind === "shape" && placed.label?.text) seen.add(placed.label.text);
            symbolBox = unionBBox(symbolBox, placed.kind === "marker" ? null : placed.bbox);
            nodes.push(placed);
          }
          const tag = b?.primaryTag ?? null;
          if (tag && !seen.has(tag) && symbolBox) {
            const at: Pt = [(symbolBox.minX + symbolBox.maxX) / 2, (symbolBox.minY + symbolBox.maxY) / 2];
            const height = Math.min(1.05, Math.max(0.42, (symbolBox.maxY - symbolBox.minY) * 0.36));
            nodes.push(anchoredText(base, order++, tag, at, "tag", height));
          }
          if (label && !seen.has(label)) nodes.push(anchoredText(base, order++, label, insertion, "source", 0.85));
          bump("instantiated");
          return;
        }
        nodes.push({
          ...base,
          kind: "placeholder",
          templateName: d.templateName,
          insertion,
          scale: [T.a, T.d],
          label,
          tag: b?.primaryTag ?? null,
          navigation: typeof nav === "string" ? nav : null,
          bindings: b,
          reason: "TEMPLATE_GEOMETRY_UNRESOLVED: no definition record for this template exists in the M1 file",
          order: order++,
          bbox: bboxOf([insertion]),
        });
        bump("placeholder");
        return;
      }
      case "Marker": {
        const [p] = pointsOf(d.geometry, r.id);
        nodes.push({
          ...base,
          kind: "marker",
          point: apply(T, p ?? [0, 0]),
          symbolNames: d.symbolNames ?? [],
          order: order++,
          bbox: null,
        });
        return;
      }
      default:
        issues.push({ severity: "WARNING", code: "UNRENDERED_CLASS", objectId: r.id, message: `${r.className} has no render rule` });
    }
  };

  const md = model.decoded as { children?: number[]; modelName: string };
  for (const c of md.children ?? []) visit(c, IDENTITY, [model.id]);

  let contentBBox: BBox | null = null;
  for (const n of nodes) if (n.kind !== "marker") contentBBox = unionBBox(contentBBox, n.bbox);

  // RULE-VIEW-001 (CANDIDATE): the display world is at least [0,100]×[0,75];
  // content beyond that (e.g. side menus up to x≈108) extends the extent.
  const nominal: BBox = { minX: 0, minY: 0, maxX: 100, maxY: 75 };
  const extent = unionBBox(nominal, contentBBox ? clampToPage(contentBBox) : null)!;

  return {
    file: m1.file,
    modelName: md.modelName,
    extent,
    extentRule: "RULE-VIEW-001 (CANDIDATE): union of nominal [0,100]×[0,75] with rendered content",
    contentBBox,
    nodes,
    issues,
    stats,
    instantiatedTemplates: [...instantiated].sort(),
  };
}

/** Re-express a library symbol's local node in the calling instance's transform. */
function mapThrough(
  n: SceneNode,
  T: Affine,
  trace: { objectId: number; offset: number; path: number[]; prefix: string },
  order: number
): SceneNode {
  const sy = Math.hypot(T.c, T.d) || 1;
  const sx = Math.hypot(T.a, T.b) || 1;
  const common = {
    nodeId: `${trace.prefix}/${n.nodeId}`,
    objectId: trace.objectId,
    className: n.className,
    offset: trace.offset,
    path: trace.path,
    transform: T,
    order,
  };
  if (n.kind === "shape") {
    const points = n.points.map((p) => apply(T, p));
    return {
      ...common,
      kind: "shape",
      shape: n.shape,
      points,
      closed: n.closed,
      style: n.style,
      bbox: bboxOf(points),
      label: n.label
        ? { ...n.label, anchor: apply(T, n.label.anchor), height: n.label.height * sy, scaleX: n.label.scaleX * (sx / sy) }
        : undefined,
    };
  }
  if (n.kind === "text") {
    const anchor = apply(T, n.text.anchor);
    return {
      ...common,
      kind: "text",
      role: n.role,
      text: { ...n.text, anchor, height: n.text.height * sy, scaleX: n.text.scaleX * (sx / sy) },
      bbox: bboxOf([anchor]),
    };
  }
  if (n.kind === "placeholder") {
    const insertion = apply(T, n.insertion);
    return {
      ...common,
      kind: "placeholder",
      templateName: n.templateName,
      insertion,
      scale: [sx, sy],
      label: n.label,
      tag: n.tag,
      navigation: n.navigation,
      bindings: n.bindings,
      reason: n.reason,
      bbox: bboxOf([insertion]),
    };
  }
  return { ...common, kind: "marker", point: apply(T, n.point), symbolNames: n.symbolNames, bbox: null };
}

function anchoredText(
  base: { nodeId: string; objectId: number; className: string; offset: number; path: number[]; transform: Affine },
  order: number,
  text: string,
  anchor: Pt,
  role: "source" | "tag",
  height: number
): TextNode {
  const centered = role === "tag";
  return {
    ...base,
    nodeId: `${base.nodeId}/${role}`,
    kind: "text",
    role,
    text: {
      text,
      anchor,
      height,
      hAlign: centered ? 2 : 1,
      vAlign: centered ? 2 : 3,
      font: role === "tag" ? 4 : 0,
      color: null,
      scaleX: 1,
    },
    order,
    bbox: bboxOf([anchor]),
  };
}

/**
 * Instantiated symbols occasionally contain dynamic geometry parked far from the
 * origin (a spin whose rest coordinate is tens of thousands of units away).
 * That geometry is not on the HMI page. Keeping it would stretch the view.
 */
function sitsOnPage(b: BBox): boolean {
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  if (w > 160 || h > 120) return false;
  return b.maxX >= -5 && b.minX <= 125 && b.maxY >= -5 && b.minY <= 80;
}

/** Placeholder insertion points of off-page templates must not blow up the page. */
function clampToPage(b: BBox): BBox {
  return {
    minX: Math.max(b.minX, 0),
    minY: Math.max(b.minY, 0),
    maxX: Math.min(b.maxX, 120),
    maxY: Math.min(b.maxY, 75),
  };
}
