import type { XrfParseResult } from "@infi90/core";

export function parseXrfFile(content: string | Buffer): XrfParseResult {
  const text =
    typeof content === "string" ? content : content.toString("latin1");
  const cadSheetsSeen: string[] = [];
  const blankDescriptions: string[] = [];
  const rawWarnings: string[] = [];
  let cadSheetsToProcess: number | undefined;

  for (const line of text.split(/\r?\n/)) {
    const count = line.match(
      /No\.\s*of\s*CAD\s*Sheets\s*to\s*Process\s*=\s*(\d+)/i
    );
    if (count) cadSheetsToProcess = Number(count[1]);

    const reading = line.match(/Reading\s+([^\s]+\.CAD)/i);
    if (reading) cadSheetsSeen.push(reading[1]);

    const open = line.match(/Opening\s+([^\s]+\.CAD)/i);
    if (open) cadSheetsSeen.push(open[1]);

    if (/blank\s+desc/i.test(line) || /no\s+description/i.test(line)) {
      blankDescriptions.push(line.trim());
    }
    if (/warning|error|unresolved/i.test(line)) {
      rawWarnings.push(line.trim());
    }
  }

  return {
    cadSheetsToProcess,
    cadSheetsSeen: [...new Set(cadSheetsSeen)],
    blankDescriptions,
    rawWarnings,
  };
}
