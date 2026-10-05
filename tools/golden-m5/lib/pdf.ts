/**
 * Minimal PDF reader for golden-master comparison.
 *
 * Recovers, per page and in page coordinates (origin bottom-left, points):
 *   - every stroked line segment (curves flattened into their chord count)
 *   - every painted path (stroke / fill), which is the "vector primitive"
 *   - every text run with its position, effective size and rotation
 *
 * Scope is deliberately narrow: both oracle PDFs use only the standard
 * Courier font with simple encoding, no images and no nested XObjects.
 * Anything outside that scope is counted in `unsupported`, never guessed.
 */
import fs from "node:fs";
import zlib from "node:zlib";

export interface PdfSegment { x1: number; y1: number; x2: number; y2: number; dashed: boolean; w: number }
export interface PdfText { x: number; y: number; size: number; angle: number; text: string }
export interface PdfPage {
  index: number; // 1-based
  width: number;
  height: number;
  segments: PdfSegment[];
  curves: number;
  /** Painted paths: one per stroke, fill or fill-and-stroke operator. */
  paintedPaths: number;
  fills: number;
  rects: number;
  texts: PdfText[];
  unsupported: string[];
}

type Obj = { num: number; start: number; end: number };

function inflate(raw: Buffer): Buffer {
  try {
    return zlib.inflateSync(raw);
  } catch {
    return zlib.inflateSync(raw, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
  }
}

export function readPdf(file: string): PdfPage[] {
  const buf = fs.readFileSync(file);
  const s = buf.toString("latin1");
  const objs = new Map<number, Obj>();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const end = s.indexOf("endobj", re.lastIndex);
    objs.set(Number(m[1]), { num: Number(m[1]), start: re.lastIndex, end: end < 0 ? s.length : end });
  }
  const text = (n: number) => {
    const o = objs.get(n);
    return o ? s.slice(o.start, o.end) : "";
  };
  const dictOf = (n: number) => {
    const t = text(n);
    const si = t.indexOf("stream");
    return si >= 0 ? t.slice(0, si) : t;
  };
  const streamOf = (n: number): Buffer => {
    const o = objs.get(n)!;
    const t = s.slice(o.start, o.end);
    const sm = /stream\r?\n/.exec(t);
    if (!sm) return Buffer.alloc(0);
    const from = o.start + sm.index + sm[0].length;
    const dict = t.slice(0, sm.index);
    let len: number | undefined;
    const lm = /\/Length\s+(\d+)(\s+\d+\s+R)?/.exec(dict);
    if (lm) len = lm[2] ? Number(/\d+/.exec(dictOf(Number(lm[1])))![0]) : Number(lm[1]);
    const to = len != null ? from + len : s.indexOf("endstream", from);
    const raw = buf.subarray(from, to);
    return /FlateDecode/.test(dict) ? inflate(raw) : raw;
  };
  const refs = (t: string, key: string): number[] => {
    const mm = new RegExp(`/${key}\\s*(\\[[^\\]]*\\]|\\d+\\s+\\d+\\s+R)`).exec(t);
    if (!mm) return [];
    return [...mm[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((g) => Number(g[1]));
  };

  // ---- page order from the page tree
  const rootNum = Number(/\/Root\s+(\d+)\s+\d+\s+R/.exec(s)?.[1]);
  const pagesNum = refs(dictOf(rootNum), "Pages")[0];
  const pageNums: number[] = [];
  const inherited = new Map<number, string>();
  const visit = (n: number, mediaBox?: string) => {
    const d = dictOf(n);
    const mb = /\/MediaBox\s*\[([^\]]*)\]/.exec(d)?.[1] ?? mediaBox;
    if (/\/Type\s*\/Pages\b/.test(d)) {
      for (const k of refs(d, "Kids")) visit(k, mb);
    } else {
      pageNums.push(n);
      if (mb) inherited.set(n, mb);
    }
  };
  visit(pagesNum);

  return pageNums.map((pn, i) => {
    const d = dictOf(pn);
    const mb = (inherited.get(pn) ?? "0 0 612 792").trim().split(/\s+/).map(Number);
    let rotate = Number(/\/Rotate\s+(-?\d+)/.exec(d)?.[1] ?? 0);
    const content = Buffer.concat(refs(d, "Contents").map(streamOf)).toString("latin1");
    const page = interpret(content, i + 1, mb[2] - mb[0], mb[3] - mb[1]);
    if (rotate) page.unsupported.push(`Rotate ${rotate}`);
    return page;
  });
}

type M = [number, number, number, number, number, number];
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];
const apply = (m: M, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

function* tokens(c: string): Generator<string | number | { str: string } | { arr: Array<number | { str: string }> } | { name: string }> {
  let i = 0;
  const n = c.length;
  const ws = (ch: string) => ch === " " || ch === "\n" || ch === "\r" || ch === "\t" || ch === "\f" || ch === "\0";
  const readString = (): string => {
    // at '('
    let depth = 1;
    let out = "";
    i++;
    while (i < n && depth > 0) {
      const ch = c[i];
      if (ch === "\\") {
        const nx = c[i + 1];
        if (/[0-7]/.test(nx)) {
          const oct = /^[0-7]{1,3}/.exec(c.slice(i + 1, i + 4))![0];
          out += String.fromCharCode(parseInt(oct, 8));
          i += 1 + oct.length;
          continue;
        }
        const map: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
        out += map[nx] ?? nx;
        i += 2;
        continue;
      }
      if (ch === "(") depth++;
      if (ch === ")") { depth--; if (depth === 0) { i++; break; } }
      out += ch;
      i++;
    }
    return out;
  };
  const readHex = (): string => {
    const end = c.indexOf(">", i);
    const hex = c.slice(i + 1, end).replace(/\s+/g, "");
    i = end + 1;
    let out = "";
    for (let k = 0; k < hex.length; k += 2) out += String.fromCharCode(parseInt((hex.slice(k, k + 2) + "0").slice(0, 2), 16));
    return out;
  };
  while (i < n) {
    const ch = c[i];
    if (ws(ch)) { i++; continue; }
    if (ch === "%") { while (i < n && c[i] !== "\n" && c[i] !== "\r") i++; continue; }
    if (ch === "(") { yield { str: readString() }; continue; }
    if (ch === "<" && c[i + 1] === "<") { // inline dict: skip
      let depth = 0;
      while (i < n) {
        if (c[i] === "<" && c[i + 1] === "<") { depth++; i += 2; continue; }
        if (c[i] === ">" && c[i + 1] === ">") { depth--; i += 2; if (depth === 0) break; continue; }
        i++;
      }
      continue;
    }
    if (ch === "<") { yield { str: readHex() }; continue; }
    if (ch === "[") {
      i++;
      const arr: Array<number | { str: string }> = [];
      while (i < n && c[i] !== "]") {
        const cc = c[i];
        if (ws(cc)) { i++; continue; }
        if (cc === "(") { arr.push({ str: readString() }); continue; }
        if (cc === "<") { arr.push({ str: readHex() }); continue; }
        const mm = /^[+-]?(\d+\.?\d*|\.\d+)/.exec(c.slice(i, i + 32));
        if (mm) { arr.push(Number(mm[0])); i += mm[0].length; continue; }
        i++;
      }
      i++;
      yield { arr };
      continue;
    }
    if (ch === "/") {
      let j = i + 1;
      while (j < n && !ws(c[j]) && !"/[]()<>{}%".includes(c[j])) j++;
      yield { name: c.slice(i + 1, j) };
      i = j;
      continue;
    }
    let j = i;
    while (j < n && !ws(c[j]) && !"/[]()<>{}%".includes(c[j])) j++;
    if (j === i) { i++; continue; }
    const tok = c.slice(i, j);
    i = j;
    const num = Number(tok);
    yield Number.isFinite(num) && /^[+-]?(\d|\.)/.test(tok) ? num : tok;
  }
}

function interpret(content: string, index: number, width: number, height: number): PdfPage {
  const page: PdfPage = { index, width, height, segments: [], curves: 0, paintedPaths: 0, fills: 0, rects: 0, texts: [], unsupported: [] };
  let ctm: M = [1, 0, 0, 1, 0, 0];
  let lw = 1;
  let dashed = false;
  const stack: Array<{ ctm: M; lw: number; dashed: boolean }> = [];
  let path: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  let cur = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  // text state
  let tm: M = [1, 0, 0, 1, 0, 0];
  let tlm: M = [1, 0, 0, 1, 0, 0];
  let fontSize = 1;
  let leading = 0;
  let charSpace = 0;
  let wordSpace = 0;
  let hScale = 1;
  const ops: Array<unknown> = [];

  const show = (str: string) => {
    const trm = mul(tm, ctm);
    const o = apply(trm, 0, 0);
    const sx = Math.hypot(trm[0], trm[1]);
    const angle = Math.round((Math.atan2(trm[1], trm[0]) * 180) / Math.PI);
    if (str.length > 0) page.texts.push({ x: o.x, y: o.y, size: fontSize * Math.hypot(tm[2], tm[3]) * Math.hypot(ctm[2], ctm[3]), angle, text: str });
    // Courier: every glyph advances 0.6 em.
    let adv = 0;
    for (const ch of str) adv += (0.6 * fontSize + charSpace + (ch === " " ? wordSpace : 0)) * hScale;
    tm = mul([1, 0, 0, 1, adv, 0], tm);
    void sx;
  };
  const paint = (stroke: boolean, fill: boolean) => {
    page.paintedPaths++;
    if (fill) page.fills++;
    if (stroke) {
      const scale = Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]));
      for (const p of path) page.segments.push({ ...p, dashed, w: lw * scale });
    }
    path = [];
  };
  const lineTo = (x: number, y: number) => {
    const a = apply(ctm, cur.x, cur.y);
    const b = apply(ctm, x, y);
    path.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    cur = { x, y };
  };

  for (const t of tokens(content)) {
    if (typeof t !== "string") { ops.push(t); continue; }
    const num = (k: number) => ops[ops.length - k] as number;
    switch (t) {
      case "q": stack.push({ ctm, lw, dashed }); break;
      case "Q": { const st = stack.pop(); if (st) ({ ctm, lw, dashed } = st); break; }
      case "cm": ctm = mul([num(6), num(5), num(4), num(3), num(2), num(1)], ctm); break;
      case "w": lw = num(1); break;
      case "d": { const a = ops[ops.length - 2] as { arr?: unknown[] }; dashed = Boolean(a?.arr && a.arr.length > 0); break; }
      case "m": cur = { x: num(2), y: num(1) }; start = cur; break;
      case "l": lineTo(num(2), num(1)); break;
      case "c": page.curves++; lineTo(num(2), num(1)); break;
      case "v": case "y": page.curves++; lineTo(num(2), num(1)); break;
      case "h": if (cur.x !== start.x || cur.y !== start.y) lineTo(start.x, start.y); break;
      case "re": {
        page.rects++;
        const [x, y, w, h] = [num(4), num(3), num(2), num(1)];
        cur = { x, y }; start = cur;
        lineTo(x + w, y); lineTo(x + w, y + h); lineTo(x, y + h); lineTo(x, y);
        break;
      }
      case "S": case "s": paint(true, false); break;
      case "f": case "F": case "f*": paint(false, true); break;
      case "B": case "B*": case "b": case "b*": paint(true, true); break;
      case "n": path = []; break;
      case "BT": tm = [1, 0, 0, 1, 0, 0]; tlm = tm; break;
      case "ET": break;
      case "Tf": fontSize = num(1); break;
      case "TL": leading = num(1); break;
      case "Tc": charSpace = num(1); break;
      case "Tw": wordSpace = num(1); break;
      case "Tz": hScale = num(1) / 100; break;
      case "Tm": tm = [num(6), num(5), num(4), num(3), num(2), num(1)]; tlm = tm; break;
      case "Td": tlm = mul([1, 0, 0, 1, num(2), num(1)], tlm); tm = tlm; break;
      case "TD": leading = -num(1); tlm = mul([1, 0, 0, 1, num(2), num(1)], tlm); tm = tlm; break;
      case "T*": tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm; break;
      case "Tj": show((ops[ops.length - 1] as { str: string }).str); break;
      case "'": tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm; show((ops[ops.length - 1] as { str: string }).str); break;
      case "\"": wordSpace = num(3); charSpace = num(2); tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm; show((ops[ops.length - 1] as { str: string }).str); break;
      case "TJ": {
        const arr = (ops[ops.length - 1] as { arr: Array<number | { str: string }> }).arr;
        let acc = "";
        for (const el of arr) {
          if (typeof el === "number") {
            if (acc) { show(acc); acc = ""; }
            tm = mul([1, 0, 0, 1, (-el / 1000) * fontSize * hScale, 0], tm);
          } else acc += el.str;
        }
        if (acc) show(acc);
        break;
      }
      case "Do": page.unsupported.push("XObject"); break;
      case "BI": page.unsupported.push("InlineImage"); break;
      default: break;
    }
    ops.length = 0;
  }
  return page;
}
