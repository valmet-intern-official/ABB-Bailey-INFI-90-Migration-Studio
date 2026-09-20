import { parseIoTag, type OutIoEntry, type OutParseResult } from "@infi90/core";

/**
 * Parse I90XREF.OUT text format:
 *   path\file.CAD Outputs
 *   Description / Source / Destination(s)
 *   DI1-1A/tag   BA01-05.14   BAL6-08.07 30705L6A ...
 */
export function parseOutFile(content: string | Buffer): OutParseResult {
  const text =
    typeof content === "string" ? content : content.toString("latin1");
  const lines = text.split(/\r?\n/);
  const entries: OutIoEntry[] = [];
  const cadSections = new Set<string>();

  let currentCad = "";
  let currentDir: "input" | "output" | null = null;
  let pendingDesc = "";
  let pendingSource = "";
  let pendingDests: string[] = [];

  const flush = () => {
    if (!currentCad || !pendingDesc || !currentDir) {
      pendingDesc = "";
      pendingSource = "";
      pendingDests = [];
      return;
    }
    const destParts = pendingDests.join(" ").trim().split(/\s+/).filter(Boolean);
    const destinations: OutIoEntry["destinations"] = [];
    for (let i = 0; i < destParts.length; i++) {
      const part = destParts[i];
      if (/^[A-Z]{2}\d/i.test(part) || part.includes("-") && part.includes(".")) {
        const next = destParts[i + 1];
        if (next && /^[A-Z0-9]+$/i.test(next) && !next.includes(".")) {
          destinations.push({ point: part, cadSheet: next });
          i++;
        } else {
          destinations.push({ point: part });
        }
      } else if (/^[A-Z0-9]+$/i.test(part)) {
        destinations.push({ point: "", cadSheet: part });
      }
    }

    const parsed = parseIoTag(pendingDesc.trim());
    entries.push({
      direction: currentDir,
      cadFile: currentCad,
      description: pendingDesc.trim(),
      parsed: parsed.ioType ? parsed : parseIoTag(pendingDesc.trim().split(/\s+/)[0] ?? pendingDesc),
      source: pendingSource
        ? { point: pendingSource.trim() }
        : undefined,
      destinations: destinations.filter((d) => d.point || d.cadSheet),
    });

    pendingDesc = "";
    pendingSource = "";
    pendingDests = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\u0000/g, "");
    const header = line.match(
      /(?:^|\s)((?:[A-Za-z]:)?[^\s]*?([^\\\/\s]+\.CAD))\s+(Outputs|Inputs)\s*$/i
    );
    if (header) {
      flush();
      currentCad = header[2];
      currentDir = header[3].toLowerCase().startsWith("out")
        ? "output"
        : "input";
      cadSections.add(currentCad);
      continue;
    }

    if (/^-{5,}/.test(line.trim()) || /Description\s+Source/i.test(line)) {
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (!currentCad || !currentDir) continue;

    // Continuation lines (destinations only) are indented heavily with empty desc
    const cols = line.match(
      /^\s*(\S.*?)\s{2,}(\S+)\s{2,}(.*)$/
    );
    if (cols) {
      flush();
      pendingDesc = cols[1].trim();
      pendingSource = cols[2].trim();
      pendingDests = [cols[3].trim()];
      continue;
    }

    // Continuation of destinations
    if (/^\s{20,}\S/.test(line) && pendingDesc) {
      pendingDests.push(line.trim());
      continue;
    }

    // Single-column-ish fallback
    const loose = line.trim();
    if (loose && !pendingDesc) {
      const parts = loose.split(/\s{2,}/);
      if (parts.length >= 1) {
        flush();
        pendingDesc = parts[0];
        pendingSource = parts[1] ?? "";
        pendingDests = parts.slice(2);
      }
    }
  }
  flush();

  return { entries, cadSections: [...cadSections] };
}
