import { FieldReader } from "../binary/reader";
import type { RefSlot } from "./types";

export interface RecordDecodeResult {
  decoded: Record<string, unknown>;
  refs: RefSlot[];
}

type Decoder = (r: FieldReader, ctx: DecodeContext) => RecordDecodeResult;

export interface DecodeContext {
  preamble: number;
}

/** Record families observed in the supplied corpus. Anything else is UNKNOWN_RECORD. */
export const KNOWN_CLASSES = [
  "Model",
  "Marker",
  "ModInst",
  "Group",
  "FillGroup",
  "Text",
  "LinkRef",
  "Point",
  "PtArray",
  "Mat2x3",
  "Scal2d",
  "G_Line_30",
  "G_Rect_30",
  "G_Circ_30",
  "G_Sect_30",
  "G_Spline_30",
  "G_TRect_30",
  "G_StrConst_30",
  "G_IntConst_30",
  "G_VarRef_30",
  "G_DynProp_30",
  "G_EVap_30",
  "G_Svap_30",
  "G_Cvap_30",
  "G_Action_30X",
  "G_FctnCall_30",
  "G_UnExpr_30",
  "G_RelExpr_30",
  "Z2",
] as const;

class RefCollector {
  readonly refs: RefSlot[] = [];
  constructor(private readonly r: FieldReader) {}

  one(field: string, role: string, note?: string): number {
    const id = this.r.ref(field, note);
    if (id !== 0) this.refs.push({ field, targetId: id, role });
    return id;
  }

  list(countField: string, itemField: string, role: string): number[] {
    const n = this.r.u32(countField, "KNOWN", "element count of the following reference list");
    const ids: number[] = [];
    for (let i = 0; i < n && this.r.remaining() >= 4; i++) ids.push(this.one(`${itemField}[${i}]`, role));
    return ids;
  }
}

/**
 * Shared object header (RULE-HDR-001): three u32 slots, u16 flags, two
 * NUL-terminated names and one u32. Slot 1 holds the transform reference on
 * instances/text; slot 2 is a secondary reference seen on some instances.
 */
function base(r: FieldReader, c: RefCollector) {
  const dynPropRef = c.one("hdr.dynPropRef", "dynamic", "RULE-HDR-002: nonzero only when a G_DynProp is attached");
  const transformRef = c.one("hdr.transformRef", "transform");
  const slot2 = c.one("hdr.slot2Ref", "secondary");
  const flags = r.u16("hdr.flags", "CANDIDATE", "bit 0x10 set when object names are present");
  const name = r.cstr("hdr.name");
  const name2 = r.cstr("hdr.name2");
  const slot3 = r.u32("hdr.slot3", "UNRESOLVED");
  return { dynPropRef, transformRef, slot2, flags, name, name2, slot3 };
}

function style(r: FieldReader) {
  return {
    lineColor: r.u32("style.lineColor", "CANDIDATE", "palette index"),
    lineStyle: r.u16("style.lineStyle", "CANDIDATE"),
    lineWidth: r.f32("style.lineWidth", "CANDIDATE", "stroke width"),
    fillColor: r.u32("style.fillColor", "CANDIDATE", "palette index"),
    fillStyle: r.u16("style.fillStyle", "CANDIDATE"),
    fillPattern: r.u32("style.fillPattern", "CANDIDATE"),
    k10000: r.u16("style.k10000", "UNRESOLVED", "0x2710 in every observed record"),
    filled: r.u16("style.filled", "CANDIDATE", "0 = hollow, 1 = filled"),
  };
}

function primitive(r: FieldReader, c: RefCollector) {
  const hdr = base(r, c);
  const geometry = c.list("geom.count", "geom.ref", "geometry");
  const st = style(r);
  return { ...hdr, geometry, style: st };
}

function textBlock(r: FieldReader) {
  const text = r.lstr("text");
  return { text };
}

const decoders: Record<string, Decoder> = {
  Model(r) {
    const c = new RefCollector(r);
    const hdr = base(r, c);
    const children = c.list("children.count", "children.ref", "child");
    if (r.remaining() < 4) return { decoded: { ...hdr, versionString: hdr.name, modelName: hdr.name2, children, templates: [] as string[] }, refs: c.refs };
    const nT = r.u32("templates.count", "KNOWN", "number of template registry entries");
    const templates: string[] = [];
    for (let i = 0; i < nT; i++) {
      r.u32(`templates[${i}].slot`, "UNRESOLVED");
      templates.push(r.cstr(`templates[${i}].name`));
    }
    r.u32("tail", "UNRESOLVED");
    return {
      decoded: { ...hdr, versionString: hdr.name, modelName: hdr.name2, children, templates },
      refs: c.refs,
    };
  },

  Group(r) {
    const c = new RefCollector(r);
    const hdr = base(r, c);
    const children = c.list("children.count", "children.ref", "child");
    if (r.remaining() >= 4) r.u32("tail", "UNRESOLVED");
    return { decoded: { ...hdr, children }, refs: c.refs };
  },

  FillGroup(r) {
    const c = new RefCollector(r);
    const hdr = base(r, c);
    const children = c.list("children.count", "children.ref", "child");
    const fill = {
      lineColor: r.u32("fill.lineColor", "CANDIDATE", "palette index"),
      fillColor: r.u32("fill.fillColor", "CANDIDATE", "palette index"),
      fillStyle: r.u16("fill.fillStyle", "CANDIDATE"),
      fillPattern: r.u32("fill.fillPattern", "CANDIDATE"),
      k10000: r.u16("fill.k10000", "UNRESOLVED"),
      filled: r.u16("fill.filled", "CANDIDATE"),
      extra0: r.u32("fill.extra0", "UNRESOLVED"),
      extra1: r.u32("fill.extra1", "UNRESOLVED"),
    };
    return { decoded: { ...hdr, children, style: fill }, refs: c.refs };
  },

  Marker(r) {
    const c = new RefCollector(r);
    const hdr = base(r, c);
    const geometry = c.list("geom.count", "geom.ref", "geometry");
    const color = r.u16("marker.color", "CANDIDATE", "palette index");
    const markerStyle = r.u16("marker.style", "UNRESOLVED");
    const size = r.f32("marker.size", "CANDIDATE");
    const extra = r.u32("marker.extra", "UNRESOLVED");
    const symbolNames = hdr.name.startsWith("_FP$SN_ ")
      ? hdr.name.slice("_FP$SN_ ".length).split(" ").filter(Boolean)
      : [];
    return {
      decoded: { ...hdr, geometry, color, markerStyle, size, extra, symbolNames },
      refs: c.refs,
    };
  },

  ModInst(r) {
    const c = new RefCollector(r);
    const hdr = base(r, c);
    const templateName = r.cstr("template");
    const n = r.u32("props.count", "KNOWN", "number of property entries");
    const props: { key: string; valueRef: number }[] = [];
    for (let i = 0; i < n; i++) {
      const valueRef = c.one(`props[${i}].valueRef`, "property");
      const key = r.cstr(`props[${i}].key`);
      props.push({ key, valueRef });
    }
    return {
      decoded: { ...hdr, instanceExpression: hdr.name, templateName, props },
      refs: c.refs,
    };
  },

  Text(r) {
    const c = new RefCollector(r);
    const hdr = base(r, c);
    const anchor = c.list("anchor.count", "anchor.ref", "anchor");
    const pre = r.u32("text.pre", "UNRESOLVED");
    const { text } = textBlock(r);
    const t = {
      a: r.u16("text.a", "UNRESOLVED"),
      font: r.u32("text.font", "CANDIDATE", "font selector"),
      hAlign: r.u16("text.hAlign", "CANDIDATE"),
      vAlign: r.u16("text.vAlign", "CANDIDATE"),
      height: r.f32("text.height", "CANDIDATE", "glyph height in 16.16 units"),
      b: r.u32("text.b", "UNRESOLVED"),
      c: r.u32("text.c", "UNRESOLVED"),
      color: r.u32("text.color", "CANDIDATE", "palette index"),
    };
    return { decoded: { ...hdr, anchor, pre, text, ...t }, refs: c.refs };
  },

  G_TRect_30(r) {
    const c = new RefCollector(r);
    const p = primitive(r, c);
    const pre = r.u32("text.pre", "UNRESOLVED");
    const { text } = textBlock(r);
    const t = {
      height: r.f32("text.height", "CANDIDATE", "glyph height in 16.16 units"),
      d: r.i32("text.d", "UNRESOLVED"),
      a: r.u16("text.a", "UNRESOLVED"),
      font: r.u32("text.font", "CANDIDATE", "font selector"),
      hAlign: r.u16("text.hAlign", "CANDIDATE"),
      vAlign: r.u16("text.vAlign", "CANDIDATE"),
      b: r.u32("text.b", "UNRESOLVED"),
      color: r.u32("text.color", "CANDIDATE", "palette index"),
      e: r.remaining() >= 4 ? r.u32("text.e", "UNRESOLVED") : 0,
    };
    return { decoded: { ...p, pre, text, ...t }, refs: c.refs };
  },

  G_Rect_30(r) {
    const c = new RefCollector(r);
    return { decoded: primitive(r, c), refs: c.refs };
  },

  G_Line_30(r) {
    const c = new RefCollector(r);
    const p = primitive(r, c);
    const lineEnd = r.u16("line.endStyle", "UNRESOLVED");
    return { decoded: { ...p, lineEnd }, refs: c.refs };
  },

  G_Circ_30(r) {
    const c = new RefCollector(r);
    const p = primitive(r, c);
    const extra = r.u32("circ.extra", "UNRESOLVED");
    return { decoded: { ...p, extra }, refs: c.refs };
  },

  G_Sect_30(r) {
    const c = new RefCollector(r);
    const p = primitive(r, c);
    const extra = r.u32("sect.extra", "UNRESOLVED");
    const startAngle = r.f64("sect.startAngle", "CANDIDATE", "degrees");
    const sweepAngle = r.f64("sect.sweepAngle", "CANDIDATE", "degrees");
    const tail = r.u16("sect.tail", "UNRESOLVED");
    return { decoded: { ...p, extra, startAngle, sweepAngle, tail }, refs: c.refs };
  },

  G_Spline_30(r) {
    const c = new RefCollector(r);
    const p = primitive(r, c);
    const closed = r.u16("spline.closed", "CANDIDATE");
    const kind = r.u16("spline.kind", "UNRESOLVED");
    const segments = c.list("spline.count", "spline.ref", "spline-part");
    return { decoded: { ...p, closed, kind, segments }, refs: c.refs };
  },

  Point(r) {
    const x = r.fx("x");
    const y = r.fx("y");
    return { decoded: { x, y }, refs: [] };
  },

  PtArray(r, ctx) {
    const count = r.u16("count", "KNOWN", "number of points");
    if (ctx.preamble !== count * 2) {
      throw new Error(`PtArray preamble ${ctx.preamble} != 2*count ${count * 2}`);
    }
    const points: [number, number][] = [];
    for (let i = 0; i < count; i++) points.push([r.fx(`p[${i}].x`), r.fx(`p[${i}].y`)]);
    return { decoded: { count, points }, refs: [] };
  },

  Scal2d(r) {
    const tx = r.f64("tx", "CANDIDATE", "translation x, 16.16 raw units");
    const ty = r.f64("ty", "CANDIDATE", "translation y, 16.16 raw units");
    const sx = r.f64("sx", "CANDIDATE", "scale x");
    const sy = r.f64("sy", "CANDIDATE", "scale y");
    return { decoded: { tx, ty, sx, sy }, refs: [] };
  },

  Mat2x3(r) {
    const a = r.f64("a", "CANDIDATE", "x' = a*x + b*y + tx");
    const b = r.f64("b", "CANDIDATE");
    const tx = r.f64("tx", "CANDIDATE", "16.16 raw units");
    const cc = r.f64("c", "CANDIDATE", "y' = c*x + d*y + ty");
    const d = r.f64("d", "CANDIDATE");
    const ty = r.f64("ty", "CANDIDATE", "16.16 raw units");
    return { decoded: { a, b, tx, c: cc, d, ty }, refs: [] };
  },

  LinkRef(r) {
    const c = new RefCollector(r);
    const first = c.one("first", "link-first");
    const second = c.one("second", "link-second");
    return { decoded: { first, second }, refs: c.refs };
  },

  G_StrConst_30(r) {
    return { decoded: { value: r.cstr("value") }, refs: [] };
  },

  G_IntConst_30(r) {
    return { decoded: { value: r.i32("value", "KNOWN") }, refs: [] };
  },

  G_VarRef_30(r) {
    return { decoded: { name: r.cstr("name") }, refs: [] };
  },

  G_DynProp_30(r) {
    const c = new RefCollector(r);
    const a = r.u32("dyn.a", "UNRESOLVED");
    const targets = c.list("dyn.count", "dyn.ref", "dynprop-target");
    const b = r.remaining() >= 4 ? r.u32("dyn.b", "UNRESOLVED") : 0;
    return { decoded: { a, targets, b }, refs: c.refs };
  },

  G_EVap_30(r) {
    const c = new RefCollector(r);
    const head = c.one("evap.head", "evap-head");
    const items = c.list("evap.count", "evap.ref", "evap-item");
    return { decoded: { head, items }, refs: c.refs };
  },

  G_Svap_30(r) {
    const c = new RefCollector(r);
    const op = r.u32("svap.op", "UNRESOLVED");
    const target = c.one("svap.target", "svap-target");
    const value = c.one("svap.value", "svap-value");
    return { decoded: { op, target, value }, refs: c.refs };
  },

  G_Cvap_30(r) {
    const c = new RefCollector(r);
    const op = r.u32("cvap.op", "UNRESOLVED");
    const target = c.one("cvap.target", "cvap-target");
    const value = c.one("cvap.value", "cvap-value");
    const code = r.u16("cvap.code", "UNRESOLVED");
    return { decoded: { op, target, value, code }, refs: c.refs };
  },

  G_Action_30X(r) {
    const c = new RefCollector(r);
    const actionCode = r.u32("action.code", "UNRESOLVED");
    const args = c.list("action.count", "action.ref", "action-arg");
    return { decoded: { actionCode, args }, refs: c.refs };
  },

  G_FctnCall_30(r) {
    const c = new RefCollector(r);
    const fn = r.cstr("function");
    const args = c.list("args.count", "args.ref", "function-arg");
    return { decoded: { function: fn, args }, refs: c.refs };
  },

  G_UnExpr_30(r) {
    const c = new RefCollector(r);
    const operand = c.one("operand", "expr-operand");
    const op = r.u16("op", "UNRESOLVED");
    return { decoded: { operand, op }, refs: c.refs };
  },

  G_RelExpr_30(r) {
    const c = new RefCollector(r);
    const left = c.one("left", "expr-operand");
    const right = c.one("right", "expr-operand");
    const op = r.u16("op", "UNRESOLVED");
    return { decoded: { left, right, op }, refs: c.refs };
  },
};

export function getDecoder(className: string): Decoder | undefined {
  return decoders[className];
}
