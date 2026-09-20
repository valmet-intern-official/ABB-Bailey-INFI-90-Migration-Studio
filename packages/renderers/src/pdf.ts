import fs from "node:fs";
import path from "node:path";
import type { CadDrawEntity, CadSheetParse, M1GraphicParse } from "@infi90/core";
import { cadSheetToSvg, m1GraphicToSvg } from "./svg";

/**
 * Minimal PDF writer that embeds page content as text operators.
 * Avoids PDFKit AFM font path issues under Next.js bundling.
 */
function buildSimplePdf(pages: { title: string; lines: string[] }[]): Buffer {
  const objects: string[] = [];
  const add = (s: string) => {
    objects.push(s);
    return objects.length;
  };

  const kids: number[] = [];
  const pageObjectIds: number[] = [];

  // We'll build pages in two passes: content streams first, then page dicts
  const contentIds: number[] = [];
  for (const page of pages) {
    const escape = (t: string) =>
      t.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    const textOps: string[] = [];
    textOps.push("BT /F1 10 Tf 40 750 Td 14 TL");
    textOps.push(`(${escape(page.title.slice(0, 90))}) Tj`);
    for (const line of page.lines.slice(0, 60)) {
      textOps.push("T*");
      textOps.push(`(${escape(line.slice(0, 95))}) Tj`);
    }
    textOps.push("ET");
    // Border rectangle
    const stream =
      "0.12 0.16 0.14 RG 1.5 w 30 40 550 720 re S\n" + textOps.join("\n");
    const id = add(
      `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`
    );
    contentIds.push(id);
  }

  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");

  for (let i = 0; i < pages.length; i++) {
    const id = add(
      `<< /Type /Page /Parent 0 0 R /MediaBox [0 0 612 792] /Contents ${contentIds[i]} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`
    );
    pageObjectIds.push(id);
    kids.push(id);
  }

  const pagesId = add(
    `<< /Type /Pages /Count ${kids.length} /Kids [${kids
      .map((k) => `${k} 0 R`)
      .join(" ")}] >>`
  );

  // Patch parent references in page objects
  for (let i = 0; i < pageObjectIds.length; i++) {
    const idx = pageObjectIds[i] - 1;
    objects[idx] = objects[idx].replace("/Parent 0 0 R", `/Parent ${pagesId} 0 R`);
  }

  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

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

function entitiesToLines(entities: CadDrawEntity[]): string[] {
  const lines: string[] = [];
  for (const e of entities) {
    if (e.type === "text" || e.type === "box" || e.type === "oref" || e.type === "symbol") {
      const label = e.label ? `[${e.label}] ` : "";
      const text = e.text ?? "";
      if (text || label) lines.push(`${label}${text}`.trim());
    }
  }
  return lines;
}

export async function renderCadSheetsPdf(
  sheets: CadSheetParse[],
  outPath: string
): Promise<string> {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const pages =
    sheets.length === 0
      ? [{ title: "No CAD sheets", lines: [] }]
      : sheets.map((s) => ({
          title: `${s.filename} | ${s.title ?? s.sheetId ?? ""}`,
          lines: [
            ...s.descriptions.slice(0, 5),
            ...s.ioRefs.slice(0, 30).map((i) => `IO ${i.raw}`),
            ...s.functionBlocks
              .slice(0, 20)
              .map(
                (b) =>
                  `FC ${b.functionCode ?? ""} ${b.blockId ?? ""} S1=${b.s1 ?? ""} S2=${b.s2 ?? ""}`
              ),
            ...entitiesToLines(s.drawEntities).slice(0, 20),
          ],
        }));
  fs.writeFileSync(outPath, buildSimplePdf(pages));
  return outPath;
}

export async function renderM1GraphicsPdf(
  graphics: M1GraphicParse[],
  outPath: string
): Promise<string> {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const pages =
    graphics.length === 0
      ? [{ title: "No M1 graphics", lines: [] }]
      : graphics.map((g) => ({
          title: `${g.filename} | ${g.title ?? g.graphicId ?? ""}`,
          lines: [
            `Objects: ${g.objectNames.slice(0, 15).join(", ")}`,
            ...g.tags.slice(0, 50).map((t) => `TAG ${t.tag} (${t.objectName ?? "-"})`),
            ...entitiesToLines(g.drawEntities).slice(0, 20),
          ],
        }));
  fs.writeFileSync(outPath, buildSimplePdf(pages));
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
