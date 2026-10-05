/**
 * Vector PDF writer for display lists. Pages are drawn with PDF path and
 * text operators only (no raster images), using the standard Courier font so
 * no font program is embedded. Content streams are Flate-compressed.
 * Output is byte-deterministic for identical input.
 *
 * Optional features, used only when supplied: optional content groups
 * (items carrying `layer`), RGB colour (items carrying `rgb`), internal
 * link annotations, and a document outline.
 */
import zlib from "node:zlib";
import { PAGE_H, PAGE_W, type Item } from "./render";

const n = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
};
const pdfString = (s: string) => `(${s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, "?")})`;

/** Courier advance width as a fraction of the font size. */
export const COURIER_ADVANCE = 0.6;

export interface PdfLink {
  /** Page-space rectangle [x1, y1, x2, y2]. */
  rect: [number, number, number, number];
  /** 0-based target page index. */
  page: number;
  /** Target y on that page (top of view); page top when omitted. */
  y?: number;
}

export interface PdfPage {
  items: Item[];
  label: string;
  links?: PdfLink[];
  /** Page size in points; defaults to the drawing page. */
  width?: number;
  height?: number;
}

export interface PdfLayer {
  id: string;
  name: string;
  /** Initially visible (default true). */
  on?: boolean;
}

export interface PdfOptions {
  layers?: PdfLayer[];
  /** Outline (bookmark) entries, flat, in document order. */
  outline?: Array<{ title: string; page: number }>;
}

function arcToBeziers(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const segs = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2)));
  const step = (a1 - a0) / segs;
  const k = (4 / 3) * Math.tan(step / 4);
  let out = `${n(cx + r * Math.cos(a0))} ${n(cy + r * Math.sin(a0))} m\n`;
  for (let i = 0; i < segs; i++) {
    const s = a0 + i * step, e = s + step;
    const p1x = cx + r * (Math.cos(s) - k * Math.sin(s)), p1y = cy + r * (Math.sin(s) + k * Math.cos(s));
    const p2x = cx + r * (Math.cos(e) + k * Math.sin(e)), p2y = cy + r * (Math.sin(e) - k * Math.cos(e));
    out += `${n(p1x)} ${n(p1y)} ${n(p2x)} ${n(p2y)} ${n(cx + r * Math.cos(e))} ${n(cy + r * Math.sin(e))} c\n`;
  }
  return out + "S\n";
}

function pageContent(items: Item[], layerTag: Map<string, string>): string {
  const out: string[] = ["0.35 w 1 J 1 j 0 G 0 g"];
  let dash = "";
  let colour = "0 0 0";
  let width = 0.35;
  let layer: string | undefined;
  for (const it of items) {
    if (it.invisible) continue;
    if (it.layer !== layer) {
      if (layer && layerTag.has(layer)) out.push("EMC");
      layer = it.layer;
      if (layer && layerTag.has(layer)) out.push(`/OC /${layerTag.get(layer)} BDC`);
    }
    const c = (it.rgb ?? [0, 0, 0]).map(n).join(" ");
    if (c !== colour) {
      out.push(`${c} RG ${c} rg`);
      colour = c;
    }
    if (it.t !== "text") {
      const w = it.w ?? 0.35;
      if (w !== width) {
        out.push(`${n(w)} w`);
        width = w;
      }
    }
    if (it.t === "path") {
      const d = it.dash ? `[${it.dash.map(n).join(" ")}] 0 d` : "[] 0 d";
      if (d !== dash) { out.push(d); dash = d; }
      const body = it.pts.map(([x, y], i) => `${n(x)} ${n(y)} ${i ? "l" : "m"}`).join("\n");
      out.push(`${body}\n${it.closed ? "h " : ""}${it.fill ? "B" : "S"}`);
    } else if (it.t === "arc") {
      if (dash !== "[] 0 d") { out.push("[] 0 d"); dash = "[] 0 d"; }
      out.push(arcToBeziers(it.cx, it.cy, it.r, it.a0, it.a1).trimEnd());
    } else {
      const a = (it.angle * Math.PI) / 180;
      const c = Math.cos(a), s = Math.sin(a);
      const w = COURIER_ADVANCE * it.size * it.text.length;
      const shift = it.anchor === "end" ? w : it.anchor === "middle" ? w / 2 : 0;
      const x = it.x - shift * c, y = it.y - shift * s;
      out.push(`BT /F1 ${n(it.size)} Tf ${n(c)} ${n(s)} ${n(-s)} ${n(c)} ${n(x)} ${n(y)} Tm ${pdfString(it.text)} Tj ET`);
    }
  }
  if (layer && layerTag.has(layer)) out.push("EMC");
  return out.join("\n");
}

export function writePdf(pages: PdfPage[], title: string, opts: PdfOptions = {}): Buffer {
  const objs: Buffer[] = [];
  const add = (body: Buffer | string) => {
    objs.push(typeof body === "string" ? Buffer.from(body, "latin1") : body);
    return objs.length;
  };
  const set = (id: number, body: string) => {
    objs[id - 1] = Buffer.from(body, "latin1");
  };
  const catalog = add("");
  const pagesObj = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");

  const layers = opts.layers ?? [];
  const layerTag = new Map<string, string>();
  const ocgs: number[] = [];
  layers.forEach((l, i) => {
    layerTag.set(l.id, `OC${i}`);
    ocgs.push(add(`<< /Type /OCG /Name ${pdfString(l.name)} >>`));
  });
  const properties = layers.length ? ` /Properties << ${layers.map((l, i) => `/OC${i} ${ocgs[i]} 0 R`).join(" ")} >>` : "";

  // Page objects are reserved first so links can point forward.
  const kids = pages.map(() => add(""));
  pages.forEach((p, pi) => {
    const W = p.width ?? PAGE_W;
    const H = p.height ?? PAGE_H;
    const raw = Buffer.from(pageContent(p.items, layerTag), "latin1");
    const z = zlib.deflateSync(raw, { level: 9 });
    const content = add(Buffer.concat([Buffer.from(`<< /Length ${z.length} /Filter /FlateDecode >>\nstream\n`, "latin1"), z, Buffer.from("\nendstream", "latin1")]));
    const annots = (p.links ?? []).filter((l) => l.page >= 0 && l.page < kids.length).map((l) => {
      const th = pages[l.page].height ?? PAGE_H;
      return add(`<< /Type /Annot /Subtype /Link /Rect [${l.rect.map(n).join(" ")}] /Border [0 0 0] /Dest [${kids[l.page]} 0 R /XYZ 0 ${n(l.y ?? th)} 0] >>`);
    });
    set(
      kids[pi],
      `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${n(W)} ${n(H)}] /Resources << /Font << /F1 ${font} 0 R >>${properties} >> /Contents ${content} 0 R` +
        (annots.length ? ` /Annots [${annots.map((a) => `${a} 0 R`).join(" ")}]` : "") +
        ` /PieceInfo << /INFI90 << /Sheet ${pdfString(p.label)} >> >> >>`
    );
  });

  let outlineRef = "";
  const outline = (opts.outline ?? []).filter((o) => o.page >= 0 && o.page < kids.length);
  if (outline.length) {
    const root = add("");
    const ids = outline.map(() => add(""));
    outline.forEach((o, i) => {
      set(
        ids[i],
        `<< /Title ${pdfString(o.title)} /Parent ${root} 0 R` +
          (i > 0 ? ` /Prev ${ids[i - 1]} 0 R` : "") +
          (i < ids.length - 1 ? ` /Next ${ids[i + 1]} 0 R` : "") +
          ` /Dest [${kids[o.page]} 0 R /Fit] >>`
      );
    });
    set(root, `<< /Type /Outlines /First ${ids[0]} 0 R /Last ${ids[ids.length - 1]} 0 R /Count ${ids.length} >>`);
    outlineRef = ` /Outlines ${root} 0 R /PageMode /UseOutlines`;
  }

  const ocProps = layers.length
    ? ` /OCProperties << /OCGs [${ocgs.map((o) => `${o} 0 R`).join(" ")}] /D << /Order [${ocgs.map((o) => `${o} 0 R`).join(" ")}] /ON [${ocgs.filter((_, i) => layers[i].on !== false).map((o) => `${o} 0 R`).join(" ")}] /OFF [${ocgs.filter((_, i) => layers[i].on === false).map((o) => `${o} 0 R`).join(" ")}] >> >>`
    : "";
  set(catalog, `<< /Type /Catalog /Pages ${pagesObj} 0 R${ocProps}${outlineRef} >>`);
  set(pagesObj, `<< /Type /Pages /Count ${kids.length} /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] >>`);
  const info = add(`<< /Title ${pdfString(title)} /Producer (INFI 90 Migration Studio source-faithful CAD renderer) >>`);

  const version = layers.length ? "1.5" : "1.4";
  const chunks: Buffer[] = [Buffer.from(`%PDF-${version}\n%\xE2\xE3\xCF\xD3\n`, "latin1")];
  const offsets: number[] = [];
  let pos = chunks[0].length;
  objs.forEach((body, i) => {
    offsets.push(pos);
    const head = Buffer.from(`${i + 1} 0 obj\n`, "latin1");
    const tail = Buffer.from("\nendobj\n", "latin1");
    chunks.push(head, body, tail);
    pos += head.length + body.length + tail.length;
  });
  const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
  chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${pos}\n%%EOF\n`, "latin1"));
  return Buffer.concat(chunks);
}
