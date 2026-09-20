import type { ErrRecord } from "@infi90/core";

export function parseErrFile(content: string | Buffer): ErrRecord[] {
  const text =
    typeof content === "string" ? content : content.toString("latin1");
  const records: ErrRecord[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cad = trimmed.match(/([A-Za-z0-9_]+\.CAD)/i)?.[1];
    const point = trimmed.match(/\b([A-Z]{2}\d{2}-\d{2}\.\d{2})\b/)?.[1];
    records.push({ raw: trimmed, cadFile: cad, point });
  }
  return records;
}
