import fs from "node:fs";
import path from "node:path";
import type { CadSheetParse, M1GraphicParse } from "@infi90/core";
import { cadSheetToSvg, m1GraphicToSvg } from "./svg";

function assemblePdf(objects: string[], catalogId: number): Buffer {
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\n`;
  pdf += `startxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

// ---------------------------------------------------------------------------
// Vector CAD PDF — one diagram page per sheet (same geometry as CAD Viewer)
// ---------------------------------------------------------------------------

type Rgb = [number, number, number];

function parseColor(raw: string | undefined, fallback: Rgb): Rgb {
  if (!raw || raw === "none") return fallback;
  const hex = raw.trim();
  if (hex.startsWith("#") && (hex.length === 7 || hex.length === 4)) {
    if (hex.length === 4) {
      const r = parseInt(hex[1] + hex[1], 16) / 255;
      const g = parseInt(hex[2] + hex[2], 16) / 255;
      const b = parseInt(hex[3] + hex[3], 16) / 255;
      return [r, g, b];
    }
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return [r, g, b];
  }
  return fallback;
}

function attr(tag: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}="([^"]*)"`, "i");
  const m = tag.match(re);
  return m?.[1];
}

function num(tag: string, name: string, fallback = 0): number {
  const v = attr(tag, name);
  if (v == null || v === "") return fallback;
  if (v.endsWith("%")) return fallback; // handled by caller for full-page rects
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pdfEsc(text: string): string {
  // PDF Type1 fonts are Latin-1; drop unsupported glyphs cleanly.
  const latin = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[^\x20-\x7E]/g, "?");
  return latin.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function rgbOp(c: Rgb, kind: "rg" | "RG"): string {
  return `${c[0].toFixed(4)} ${c[1].toFixed(4)} ${c[2].toFixed(4)} ${kind}`;
}

function svgSize(svg: string): { width: number; height: number } {
  const open = svg.match(/<svg\b[^>]*>/i)?.[0] ?? "";
  const vb = attr(open, "viewBox");
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] };
    }
  }
  return {
    width: Math.max(1, num(open, "width", 1200)),
    height: Math.max(1, num(open, "height", 800)),
  };
}

/**
 * Translate CAD SVG primitives (rect / line / polyline / circle / text)
 * into PDF content-stream operators drawn in SVG coordinates.
 */
function svgToPdfContent(svg: string, pageW: number, pageH: number): string {
  const { width: svgW, height: svgH } = svgSize(svg);
  const margin = 18;
  const scale = Math.min(
    (pageW - margin * 2) / svgW,
    (pageH - margin * 2) / svgH
  );
  const drawW = svgW * scale;
  const drawH = svgH * scale;
  const ox = (pageW - drawW) / 2;
  const oy = (pageH - drawH) / 2;

  // Map SVG (y-down) → PDF (y-up): [scale 0 0 -scale ox oy+drawH]
  const ops: string[] = [
    "q",
    `${scale.toFixed(6)} 0 0 ${(-scale).toFixed(6)} ${ox.toFixed(4)} ${(oy + drawH).toFixed(4)} cm`,
    "0.5 w 1 J 1 j",
  ];

  // Strip group wrappers; keep leaf drawing tags.
  const body = svg
    .replace(/<\?xml[\s\S]*?\?>/g, "")
    .replace(/<\/?g\b[^>]*>/gi, "\n");

  const tagRe =
    /<(rect|line|polyline|circle|text)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(body))) {
    const kind = m[1].toLowerCase();
    const a = m[2];
    const textBody = (m[3] ?? "").trim();

    if (kind === "rect") {
      const fillRaw = attr(a, "fill") ?? "#000000";
      const strokeRaw = attr(a, "stroke");
      const sw = num(a, "stroke-width", 1);
      let x = num(a, "x", 0);
      let y = num(a, "y", 0);
      let w = num(a, "width", 0);
      let h = num(a, "height", 0);
      // Full-bleed background: width/height="100%"
      if (attr(a, "width")?.endsWith("%")) {
        x = 0;
        w = svgW;
      }
      if (attr(a, "height")?.endsWith("%")) {
        y = 0;
        h = svgH;
      }
      if (w <= 0 || h <= 0) continue;

      ops.push(`${sw.toFixed(3)} w`);
      if (fillRaw !== "none") {
        ops.push(rgbOp(parseColor(fillRaw, [0.97, 0.96, 0.94]), "rg"));
        ops.push(`${x.toFixed(3)} ${y.toFixed(3)} ${w.toFixed(3)} ${h.toFixed(3)} re f`);
      }
      if (strokeRaw && strokeRaw !== "none") {
        ops.push(rgbOp(parseColor(strokeRaw, [0.12, 0.16, 0.14]), "RG"));
        ops.push(`${x.toFixed(3)} ${y.toFixed(3)} ${w.toFixed(3)} ${h.toFixed(3)} re S`);
      }
    } else if (kind === "line") {
      const x1 = num(a, "x1");
      const y1 = num(a, "y1");
      const x2 = num(a, "x2");
      const y2 = num(a, "y2");
      const sw = num(a, "stroke-width", 1.2);
      const stroke = parseColor(attr(a, "stroke"), [0.24, 0.31, 0.27]);
      ops.push(`${sw.toFixed(3)} w`);
      ops.push(rgbOp(stroke, "RG"));
      ops.push(
        `${x1.toFixed(3)} ${y1.toFixed(3)} m ${x2.toFixed(3)} ${y2.toFixed(3)} l S`
      );
    } else if (kind === "polyline") {
      const pts = (attr(a, "points") ?? "")
        .trim()
        .split(/[\s,]+/)
        .map(Number)
        .filter((n) => Number.isFinite(n));
      if (pts.length < 4) continue;
      const sw = num(a, "stroke-width", 1.2);
      const stroke = parseColor(attr(a, "stroke"), [0.24, 0.31, 0.27]);
      const fillRaw = attr(a, "fill") ?? "none";
      ops.push(`${sw.toFixed(3)} w`);
      ops.push(rgbOp(stroke, "RG"));
      const path: string[] = [
        `${pts[0].toFixed(3)} ${pts[1].toFixed(3)} m`,
      ];
      for (let i = 2; i + 1 < pts.length; i += 2) {
        path.push(`${pts[i].toFixed(3)} ${pts[i + 1].toFixed(3)} l`);
      }
      if (fillRaw !== "none") {
        ops.push(rgbOp(parseColor(fillRaw, [1, 1, 1]), "rg"));
        ops.push(path.join(" ") + " B");
      } else {
        ops.push(path.join(" ") + " S");
      }
    } else if (kind === "circle") {
      const cx = num(a, "cx");
      const cy = num(a, "cy");
      const r = num(a, "r");
      if (r <= 0) continue;
      const fill = parseColor(attr(a, "fill"), [0.76, 0.25, 0.05]);
      // Bézier circle approximation
      const k = 0.5522847498 * r;
      ops.push(rgbOp(fill, "rg"));
      ops.push(
        [
          `${(cx + r).toFixed(3)} ${cy.toFixed(3)} m`,
          `${(cx + r).toFixed(3)} ${(cy + k).toFixed(3)} ${(cx + k).toFixed(3)} ${(cy + r).toFixed(3)} ${cx.toFixed(3)} ${(cy + r).toFixed(3)} c`,
          `${(cx - k).toFixed(3)} ${(cy + r).toFixed(3)} ${(cx - r).toFixed(3)} ${(cy + k).toFixed(3)} ${(cx - r).toFixed(3)} ${cy.toFixed(3)} c`,
          `${(cx - r).toFixed(3)} ${(cy - k).toFixed(3)} ${(cx - k).toFixed(3)} ${(cy - r).toFixed(3)} ${cx.toFixed(3)} ${(cy - r).toFixed(3)} c`,
          `${(cx + k).toFixed(3)} ${(cy - r).toFixed(3)} ${(cx + r).toFixed(3)} ${(cy - k).toFixed(3)} ${(cx + r).toFixed(3)} ${cy.toFixed(3)} c`,
          "f",
        ].join(" ")
      );
    } else if (kind === "text") {
      const x = num(a, "x");
      const y = num(a, "y");
      const size = num(a, "font-size", 10);
      const fill = parseColor(attr(a, "fill"), [0.12, 0.16, 0.14]);
      const label = pdfEsc(textBody);
      if (!label) continue;
      // Text matrix: scale Y by -1 so glyphs are upright after parent Y-flip.
      ops.push("BT");
      ops.push(rgbOp(fill, "rg"));
      ops.push(`/F1 ${size.toFixed(2)} Tf`);
      ops.push(
        `1 0 0 -1 ${x.toFixed(3)} ${y.toFixed(3)} Tm (${label}) Tj`
      );
      ops.push("ET");
    }
  }

  ops.push("Q");
  return ops.join("\n");
}

/**
 * Build a multi-page PDF where each page is a vector CAD diagram
 * (same structure shown in the interactive CAD Viewer).
 */
function buildDiagramPdf(svgs: string[]): Buffer {
  const objects: string[] = [];
  const add = (s: string) => {
    objects.push(s);
    return objects.length;
  };

  // Landscape US Letter — fits typical engineering sheet aspect ratios.
  const pageW = 792;
  const pageH = 612;

  const contentIds: number[] = [];
  const pages = svgs.length > 0 ? svgs : [emptySheetSvg()];
  for (const svg of pages) {
    const stream = svgToPdfContent(svg, pageW, pageH);
    const id = add(
      `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`
    );
    contentIds.push(id);
  }

  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");

  const pageObjectIds: number[] = [];
  const kids: number[] = [];
  for (let i = 0; i < contentIds.length; i++) {
    const id = add(
      `<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents ${contentIds[i]} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`
    );
    pageObjectIds.push(id);
    kids.push(id);
  }

  const pagesId = add(
    `<< /Type /Pages /Count ${kids.length} /Kids [${kids
      .map((k) => `${k} 0 R`)
      .join(" ")}] >>`
  );

  for (let i = 0; i < pageObjectIds.length; i++) {
    const idx = pageObjectIds[i] - 1;
    objects[idx] = objects[idx].replace("/Parent 0 0 R", `/Parent ${pagesId} 0 R`);
  }

  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  return assemblePdf(objects, catalogId);
}

function emptySheetSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
<rect width="100%" height="100%" fill="#f7f4ef"/>
<text x="40" y="60" font-family="Consolas, monospace" font-size="16" fill="#1f2a24">No CAD sheets</text>
</svg>`;
}

export async function renderCadSheetsPdf(
  sheets: CadSheetParse[],
  outPath: string
): Promise<string> {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const svgs =
    sheets.length === 0
      ? [emptySheetSvg()]
      : sheets.map((s) => cadSheetToSvg(s));
  fs.writeFileSync(outPath, buildDiagramPdf(svgs));
  return outPath;
}

export async function renderM1GraphicsPdf(
  graphics: M1GraphicParse[],
  outPath: string
): Promise<string> {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  // M1 graphics also export as diagram pages (same SVG the viewer uses).
  const svgs =
    graphics.length === 0
      ? [
          `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
<rect width="100%" height="100%" fill="#f7f4ef"/>
<text x="40" y="60" font-family="Consolas, monospace" font-size="16" fill="#1f2a24">No M1 graphics</text>
</svg>`,
        ]
      : graphics.map((g) => m1GraphicToSvg(g));
  fs.writeFileSync(outPath, buildDiagramPdf(svgs));
  return outPath;
}

export async function writeCadSvgs(
  sheets: CadSheetParse[],
  dir: string
): Promise<string[]> {
  fs.mkdirSync(dir, { recursive: true });
  const modelDir = path.join(dir, "..", "cad-models");
  fs.mkdirSync(modelDir, { recursive: true });
  const paths: string[] = [];
  for (const sheet of sheets) {
    const base = sheet.filename.replace(/\.CAD$/i, "");
    const p = path.join(dir, `${base}.svg`);
    fs.writeFileSync(p, cadSheetToSvg(sheet), "utf8");
    paths.push(p);
    if (sheet.engineeringModel) {
      fs.writeFileSync(
        path.join(modelDir, `${base}_model.json`),
        JSON.stringify(sheet.engineeringModel, null, 2),
        "utf8"
      );
      fs.writeFileSync(
        path.join(modelDir, `${base}_connections.json`),
        JSON.stringify(sheet.engineeringModel.connections, null, 2),
        "utf8"
      );
      fs.writeFileSync(
        path.join(modelDir, `${base}_metadata.json`),
        JSON.stringify(
          {
            filename: sheet.filename,
            sheetId: sheet.sheetId,
            title: sheet.title,
            stats: sheet.engineeringModel.stats,
            validation: sheet.engineeringModel.validation,
            provenance: sheet.engineeringModel.provenance,
          },
          null,
          2
        ),
        "utf8"
      );
    }
  }
  return paths;
}

export async function writeM1Svgs(
  graphics: M1GraphicParse[],
  dir: string
): Promise<string[]> {
  fs.mkdirSync(dir, { recursive: true });
  const paths: string[] = [];
  for (const g of graphics) {
    const p = path.join(dir, g.filename.replace(/\.m1$/i, ".svg"));
    fs.writeFileSync(p, m1GraphicToSvg(g), "utf8");
    paths.push(p);
  }
  return paths;
}
