import type { CadDrawEntity, CadSheetParse, M1GraphicParse } from "@infi90/core";
import { renderEngineeringSvg } from "@infi90/cad-engine";

function entityBounds(entities: CadDrawEntity[]): {
  maxX: number;
  maxY: number;
} {
  let maxX = 0;
  let maxY = 0;
  for (const e of entities) {
    if (e.type === "box" || e.type === "oref" || e.type === "symbol") {
      maxX = Math.max(maxX, (e.x ?? 0) + (e.w ?? 120));
      maxY = Math.max(maxY, (e.y ?? 0) + (e.h ?? 28));
      // labels sit above boxes
      if (e.label) maxY = Math.max(maxY, (e.y ?? 0));
    } else if (e.type === "line") {
      maxX = Math.max(maxX, e.x ?? 0, e.x2 ?? 0);
      maxY = Math.max(maxY, e.y ?? 0, e.y2 ?? 0);
    } else if (e.type === "text") {
      maxX = Math.max(maxX, (e.x ?? 0) + ((e.text?.length ?? 0) * 7));
      maxY = Math.max(maxY, (e.y ?? 0) + 16);
    }
  }
  return { maxX, maxY };
}

export function entitiesToSvg(
  entities: CadDrawEntity[],
  opts: { width?: number; height?: number; title?: string } = {}
): string {
  const bounds = entityBounds(entities);
  const width = Math.max(
    opts.width ?? 800,
    Math.ceil(bounds.maxX + 48),
    800
  );
  const height = Math.max(
    opts.height ?? 600,
    Math.ceil(bounds.maxY + 56),
    600
  );
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="#f7f4ef"/>`,
    `<rect x="8" y="8" width="${width - 16}" height="${height - 16}" fill="none" stroke="#1f2a24" stroke-width="1.5"/>`,
  ];
  if (opts.title) {
    parts.push(
      `<text x="24" y="32" font-family="Consolas, monospace" font-size="14" fill="#1f2a24" font-weight="700">${escapeXml(opts.title)}</text>`
    );
  }

  for (const e of entities) {
    // Skip synthetic "frame" boxes — outer page border already drawn
    if (e.label === "frame") continue;

    if (e.type === "box" || e.type === "oref" || e.type === "symbol") {
      const x = e.x ?? 0;
      const y = e.y ?? 0;
      const w = e.w ?? 120;
      const h = e.h ?? 28;
      const fill = e.type === "oref" ? "#dde8df" : "#fff";
      const stroke = e.type === "oref" ? "#2f6b4f" : "#1f2a24";
      parts.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" rx="2"/>`
      );
      if (e.text) {
        parts.push(
          `<text x="${x + 6}" y="${y + 18}" font-family="Consolas, monospace" font-size="11" fill="#1f2a24">${escapeXml(e.text.slice(0, 28))}</text>`
        );
      }
      if (e.label) {
        parts.push(
          `<text x="${x + 6}" y="${y - 4}" font-family="Consolas, monospace" font-size="9" fill="#5a6b62">${escapeXml(e.label.slice(0, 24))}</text>`
        );
      }
    } else if (e.type === "line") {
      parts.push(
        `<line x1="${e.x ?? 0}" y1="${e.y ?? 0}" x2="${e.x2 ?? 0}" y2="${e.y2 ?? 0}" stroke="#3d4f45" stroke-width="1.2"/>`
      );
    } else if (e.type === "text") {
      parts.push(
        `<text x="${e.x ?? 0}" y="${e.y ?? 0}" font-family="Consolas, monospace" font-size="11" fill="#1f2a24">${escapeXml((e.text ?? "").slice(0, 90))}</text>`
      );
    }
  }

  parts.push("</svg>");
  return parts.join("\n");
}

export function cadSheetToSvg(sheet: CadSheetParse): string {
  if (sheet.engineeringModel && sheet.engineeringModel.blocks.length > 0) {
    return renderEngineeringSvg(sheet.engineeringModel);
  }
  return entitiesToSvg(sheet.drawEntities, {
    width: 900,
    title: `${sheet.filename} — ${sheet.title ?? sheet.sheetId ?? ""}`,
  });
}

export function m1GraphicToSvg(graphic: M1GraphicParse): string {
  // Rebuild layout from tags so older sessions (fixed 640px frame) are not clipped
  const entities = buildM1LayoutEntities(graphic);
  return entitiesToSvg(entities, {
    width: 900,
    title: `${graphic.filename} — ${graphic.title ?? graphic.graphicId ?? ""}`,
  });
}

/** Deterministic tag-grid layout sized to fit all tags. */
export function buildM1LayoutEntities(graphic: M1GraphicParse): CadDrawEntity[] {
  const drawEntities: CadDrawEntity[] = [];
  drawEntities.push({
    type: "text",
    x: 40,
    y: 48,
    text: `${graphic.title ?? graphic.graphicId ?? graphic.filename}`,
    label: "title",
  });

  const colW = 180;
  const rowH = 64;
  const startX = 40;
  const startY = 80;
  const cols = 4;

  let y = startY;
  let x = startX;
  let col = 0;
  for (const t of graphic.tags) {
    drawEntities.push({
      type: "box",
      x,
      y,
      w: 160,
      h: 40,
      text: t.tag,
      label: t.objectName?.slice(0, 24),
    });
    if (col < cols - 1) {
      drawEntities.push({
        type: "line",
        x: x + 160,
        y: y + 20,
        x2: x + colW,
        y2: y + 20,
      });
    }
    col += 1;
    x += colW;
    if (col >= cols) {
      col = 0;
      x = startX;
      y += rowH;
    }
  }
  if (col !== 0) y += rowH;

  const ly = y + 36;
  if (graphic.objectNames.length > 0) {
    drawEntities.push({
      type: "text",
      x: 40,
      y: ly,
      text: `Objects: ${graphic.objectNames.slice(0, 40).join(", ")}`.slice(0, 200),
    });
  }
  drawEntities.push({
    type: "text",
    x: 40,
    y: ly + 22,
    text: `tags:${graphic.tags.length}  objects:${graphic.objectNames.length}`,
  });

  return drawEntities;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
