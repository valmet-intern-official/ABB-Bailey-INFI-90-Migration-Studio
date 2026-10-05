import fs from "node:fs";
import AdmZip from "adm-zip";
import { PDFDocument } from "pdf-lib";
import { loadM1Categories, loadM1Index, resolvePackagePath, type M1SessionIndex } from "@/lib/m1-session";

export const UNCATEGORIZED_ID = "__uncategorized__";

export type M1ExportVariant = "original" | "marking";

export interface M1ExportResult {
  filename: string;
  contentType: string;
  body: Uint8Array;
}

function pdfRel(file: string, variant: M1ExportVariant) {
  return `${file}/graphics/${variant === "marking" ? "with-marking-tag" : "original"}.pdf`;
}

function safeName(s: string) {
  const cleaned = s.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_").replace(/\s+/g, " ").trim();
  return cleaned.replace(/^\.+/, "") || "graphics";
}

/**
 * Two pages per graphic, in file order: the original screen, then the same
 * screen with the marking-tag overlay. That is the reference pairing.
 */
async function mergeGraphics(id: string, files: string[], title: string, index: M1SessionIndex) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer("infi90 m1-engine");
  const source = new Map(index.files.map((f) => [f.name, f.sourceFile]));
  for (const file of files) {
    for (const variant of ["original", "marking"] as const) {
      const p = resolvePackagePath(id, pdfRel(file, variant));
      if (!p) throw new Error(`rendered ${variant} PDF missing for ${source.get(file) ?? file}`);
      const src = await PDFDocument.load(fs.readFileSync(p));
      const pages = await doc.copyPages(src, src.getPageIndices());
      pages.forEach((pg) => doc.addPage(pg));
    }
  }
  return doc.save();
}

/**
 * No categories defined: one PDF, two pages per graphic (original, then marking tags).
 * Categories defined: a ZIP with one PDF per requested category, same pairing inside each PDF.
 */
export async function exportM1Graphics(
  id: string,
  opts: { categoryIds?: string[]; variant?: M1ExportVariant }
): Promise<M1ExportResult> {
  const index = loadM1Index(id);
  if (!index) throw new Error("session not found");
  const categories = loadM1Categories(id);
  const base = `M1-graphics-${id}`;

  if (!categories.length) {
    const all = index.files.map((f) => f.name);
    if (!all.length) throw new Error("no graphics in this session");
    const body = await mergeGraphics(id, all, "M1 graphics", index);
    return { filename: `${base}.pdf`, contentType: "application/pdf", body };
  }

  const wanted = opts.categoryIds ?? [];
  if (!wanted.length) throw new Error("select at least one category");
  const assigned = new Set(categories.flatMap((c) => c.files));
  const groups: { name: string; files: string[] }[] = [];
  for (const cid of wanted) {
    if (cid === UNCATEGORIZED_ID) {
      const files = index.files.map((f) => f.name).filter((f) => !assigned.has(f));
      groups.push({ name: "Uncategorized", files });
      continue;
    }
    const cat = categories.find((c) => c.id === cid);
    if (!cat) throw new Error(`unknown category ${cid}`);
    groups.push({ name: cat.name, files: cat.files });
  }

  const zip = new AdmZip();
  const used = new Set<string>();
  for (const g of groups) {
    if (!g.files.length) throw new Error(`category "${g.name}" has no graphics`);
    const body = await mergeGraphics(id, g.files, g.name, index);
    let name = `${safeName(g.name)}.pdf`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${safeName(g.name)} (${n}).pdf`;
    used.add(name.toLowerCase());
    zip.addFile(name, Buffer.from(body));
  }
  return { filename: `${base}.zip`, contentType: "application/zip", body: new Uint8Array(zip.toBuffer()) };
}
