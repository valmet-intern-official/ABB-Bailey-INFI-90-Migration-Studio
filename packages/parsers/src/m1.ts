import type { CadDrawEntity, M1GraphicParse, M1TagInstance } from "@infi90/core";

function extractStrings(buf: Buffer, minLen = 3): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b >= 32 && b <= 126) cur += String.fromCharCode(b);
    else {
      if (cur.length >= minLen) out.push(cur);
      cur = "";
    }
  }
  if (cur.length >= minLen) out.push(cur);
  return out;
}

export function parseM1File(buf: Buffer, filename: string): M1GraphicParse {
  const strings = extractStrings(buf, 3);
  const objectNames: string[] = [];
  const tags: M1TagInstance[] = [];
  const texts: string[] = [];

  // Header magic m1gms4u
  const magic = buf.slice(0, 8).toString("ascii");

  for (const s of strings) {
    const tagMatch = s.match(/TAG\s+"([^"]+)"/i);
    if (tagMatch) {
      tags.push({ tag: tagMatch[1] });
      continue;
    }
    if (
      /^(toba_|TOBA_|dupont_|G_|_FP|Marker|ModInst|Model)/.test(s) ||
      /_MSDD|_FB|_LR/.test(s)
    ) {
      objectNames.push(s.trim());
      continue;
    }
    if (s.length > 2 && s.length < 80 && !/m1gms/i.test(s)) {
      texts.push(s);
    }
  }

  // Associate recent object name with tags
  let lastObj: string | undefined;
  for (const s of strings) {
    if (/^(toba_|TOBA_|dupont_)/.test(s)) lastObj = s;
    const tagMatch = s.match(/TAG\s+"([^"]+)"/i);
    if (tagMatch) {
      const existing = tags.find((t) => t.tag === tagMatch[1] && !t.objectName);
      if (existing) existing.objectName = lastObj;
      else tags.push({ tag: tagMatch[1], objectName: lastObj });
    }
  }

  const graphicId =
    strings.find((s) => /^322[A-Z0-9]+$/i.test(s.trim())) ||
    filename.replace(/\.m1$/i, "");
  const title =
    strings.find((s) => /Title|Menu|P&ID|Overview/i.test(s)) || graphicId;

  const drawEntities: CadDrawEntity[] = [];
  drawEntities.push({
    type: "text",
    x: 40,
    y: 48,
    text: `${title} (${magic || "m1"})`,
    label: "title",
  });

  const colW = 180;
  const rowH = 64;
  const startX = 40;
  const startY = 80;
  const cols = 4;
  const allTags = dedupeTags(tags);

  let y = startY;
  let x = startX;
  let col = 0;
  for (const t of allTags) {
    drawEntities.push({
      type: "box",
      x,
      y,
      w: 160,
      h: 40,
      text: t.tag,
      label: t.objectName?.slice(0, 24),
    });
    // connector stub between adjacent tags in a row
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

  // Object name legend below the tag grid
  const ly = y + 36;
  drawEntities.push({
    type: "text",
    x: 40,
    y: ly,
    text: `Objects: ${[...new Set(objectNames)].slice(0, 40).join(", ")}`.slice(
      0,
      200
    ),
  });
  drawEntities.push({
    type: "text",
    x: 40,
    y: ly + 22,
    text: `tags:${allTags.length}  objects:${[...new Set(objectNames)].length}`,
  });

  return {
    filename,
    graphicId,
    title: String(title),
    objectNames: [...new Set(objectNames)],
    tags: allTags,
    texts: texts.slice(0, 200),
    drawEntities,
  };
}

function dedupeTags(tags: M1TagInstance[]): M1TagInstance[] {
  const map = new Map<string, M1TagInstance>();
  for (const t of tags) {
    const prev = map.get(t.tag);
    if (!prev) map.set(t.tag, t);
    else if (!prev.objectName && t.objectName) map.set(t.tag, t);
  }
  return [...map.values()];
}
