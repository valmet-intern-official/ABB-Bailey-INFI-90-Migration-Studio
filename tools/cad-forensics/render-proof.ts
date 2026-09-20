/**
 * Geometry proof renderer — NOT the production renderer.
 *
 * Draws every decoded record at its true decoded position using only
 * CONFIRMED fields (bounding box + symbol name + insertion point). No layout
 * is invented and no coordinate is guessed: if the decode were wrong, the
 * output would be visibly incoherent rather than a recognisable sheet.
 *
 * Authentic symbol outlines come later, from the .LBR primitives. Until then a
 * symbol is drawn as its real bounding box so placement can be judged against
 * the reference PDF.
 */
import fs from "node:fs";
import path from "node:path";

const HEADER_SIZE = 256;

interface Rec {
  offset: number;
  type: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  name?: string;
  insX?: number;
  insY?: number;
  strings: string[];
}

function findTrailer(buf: Buffer): number {
  const idx = buf.indexOf(Buffer.from("BCCo\xC5", "latin1"), HEADER_SIZE);
  return idx === -1 ? buf.length : idx;
}

function decode(file: string): Rec[] {
  const buf = fs.readFileSync(file);
  const limit = findTrailer(buf);
  const recs: Rec[] = [];
  let off = HEADER_SIZE;

  while (off + 4 <= limit) {
    if (buf.readUInt16LE(off) === 0) {
      off += 2;
      continue;
    }
    const type = buf.readUInt16LE(off);
    const lengthWords = buf.readUInt16LE(off + 2);
    const end = off + lengthWords * 2;
    if (lengthWords < 4 || end > limit) break;

    const rec: Rec = {
      offset: off,
      type,
      x1: buf.readUInt16LE(off + 6),
      y1: buf.readUInt16LE(off + 8),
      x2: buf.readUInt16LE(off + 10),
      y2: buf.readUInt16LE(off + 12),
      strings: [],
    };

    const nameSlot = off + 14;
    if (nameSlot + 12 <= end) {
      const raw = buf.subarray(nameSlot, nameSlot + 8).toString("latin1");
      if (/^[\x20-\x7E]{8}$/.test(raw) && /[A-Za-z0-9]/.test(raw.trim())) {
        rec.name = raw.trimEnd();
        rec.insX = buf.readUInt16LE(nameSlot + 8);
        rec.insY = buf.readUInt16LE(nameSlot + 10);
      }
    }

    // Payload text, for labelling only.
    let cur = "";
    for (let i = rec.name ? nameSlot + 8 : off + 4; i < end; i++) {
      const b = buf[i];
      if (b >= 32 && b <= 126) cur += String.fromCharCode(b);
      else {
        if (cur.trim().length >= 2) rec.strings.push(cur.trim());
        cur = "";
      }
    }
    if (cur.trim().length >= 2) rec.strings.push(cur.trim());

    recs.push(rec);
    off = end;
  }
  return recs;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function render(file: string): string {
  const recs = decode(file);
  const sheet = path.basename(file, path.extname(file));

  // Sheet extent comes from the decoded border symbol, else from all geometry.
  const border = recs.find((r) => r.name === "DBORDH");
  const pad = 60;
  const minX = border ? border.x1 - pad : Math.min(...recs.map((r) => r.x1)) - pad;
  const minY = border ? border.y1 - pad : Math.min(...recs.map((r) => r.y1)) - pad;
  const maxX = border ? border.x2 + pad : Math.max(...recs.map((r) => r.x2)) + pad;
  const maxY = border ? border.y2 + pad : Math.max(...recs.map((r) => r.y2)) + pad;
  const W = maxX - minX;
  const H = maxY - minY;

  // Source Y is mathematically upward; SVG Y grows downward.
  const fx = (x: number) => (x - minX).toFixed(1);
  const fy = (y: number) => (maxY - y).toFixed(1);

  // Keep viewBox in source units for fidelity; scale the presentation size so
  // the whole sheet is visible in one viewport.
  const DISPLAY_W = 1600;
  const scale = DISPLAY_W / W;

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${DISPLAY_W}" height="${Math.round(H * scale)}" font-family="Consolas,monospace">`
  );
  out.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  out.push(`<g stroke-width="2" fill="none">`);

  const STYLE: Record<string, { stroke: string; fill: string }> = {
    IREF: { stroke: "#1d4ed8", fill: "#eff6ff" },
    IREFO: { stroke: "#1d4ed8", fill: "#eff6ff" },
    OREF: { stroke: "#b45309", fill: "#fffbeb" },
    N90CNECT: { stroke: "#dc2626", fill: "#dc2626" },
    DBORDH: { stroke: "#111827", fill: "none" },
    LINE: { stroke: "#9ca3af", fill: "none" },
  };
  const LOGIC = new Set([
    "AND2", "AND4", "OR2", "OR4", "NOT", "SR", "TD-DIG", "QOR",
    "H/L", "SUM", "RCM", "T-DIG", "T-AN", "DIGRP",
  ]);

  // Only name-bearing records have CONFIRMED bounding-box semantics. Records
  // without a name use w3..w6 for something not yet decoded, so drawing them
  // as boxes would be fabrication.
  for (const r of recs.filter((r) => r.name)) {
    const w = r.x2 - r.x1;
    const h = r.y2 - r.y1;
    const name = r.name ?? "";
    const style =
      STYLE[name] ??
      (LOGIC.has(name)
        ? { stroke: "#047857", fill: "#ecfdf5" }
        : { stroke: "#6b7280", fill: "#f9fafb" });

    const attrs = [
      `data-entity-type="${r.name ? "symbol" : `record-type-${r.type}`}"`,
      `data-record-type="${r.type}"`,
      `data-source-file="${esc(path.basename(file))}"`,
      `data-source-offset="${r.offset}"`,
      r.name ? `data-symbol="${esc(r.name)}"` : "",
    ]
      .filter(Boolean)
      .join(" ");

    out.push(`<g ${attrs}>`);

    if (name === "N90CNECT") {
      // Connection nodes are 12x12 — draw as a true junction dot.
      out.push(
        `<circle cx="${fx((r.x1 + r.x2) / 2)}" cy="${fy((r.y1 + r.y2) / 2)}" r="5" fill="${style.fill}" stroke="none"/>`
      );
    } else if (w > 0 && h > 0) {
      out.push(
        `<rect x="${fx(r.x1)}" y="${fy(r.y2)}" width="${w}" height="${h}" fill="${style.fill}" stroke="${style.stroke}"/>`
      );
    } else {
      out.push(
        `<line x1="${fx(r.x1)}" y1="${fy(r.y1)}" x2="${fx(r.x2)}" y2="${fy(r.y2)}" stroke="${style.stroke}"/>`
      );
    }

    if (name && name !== "N90CNECT" && name !== "DBORDH" && h >= 30) {
      out.push(
        `<text x="${fx(r.x1 + 8)}" y="${fy(r.y2 - 30)}" font-size="26" fill="${style.stroke}" stroke="none">${esc(name)}</text>`
      );
    }
    const label = r.strings.find((s) => s.length > 2);
    if (label && h >= 60) {
      out.push(
        `<text x="${fx(r.x1 + 8)}" y="${fy(r.y2 - 62)}" font-size="22" fill="#374151" stroke="none">${esc(label.slice(0, 34))}</text>`
      );
    }
    out.push(`</g>`);
  }

  out.push(`</g>`);
  const named = recs.filter((r) => r.name).length;
  out.push(
    `<text x="20" y="34" font-size="30" fill="#111827">${esc(sheet)} — geometry proof · ${named} placed symbols of ${recs.length} records decoded</text>`
  );
  out.push(`</svg>`);
  return out.join("\n");
}

const outDir = path.join(process.cwd(), "tools", "cad-forensics", "out");
fs.mkdirSync(outDir, { recursive: true });

for (const file of process.argv.slice(2)) {
  const svg = render(file);
  const dest = path.join(outDir, `${path.basename(file, path.extname(file))}.svg`);
  fs.writeFileSync(dest, svg, "utf8");
  console.log(`wrote ${dest}  (${svg.length} bytes)`);
}
