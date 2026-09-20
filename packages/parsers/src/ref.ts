import { parseIoTag, type RefTag } from "@infi90/core";

/** Extract printable tags from binary .REF database */
export function parseRefFile(buf: Buffer): RefTag[] {
  const tags: RefTag[] = [];
  const seen = new Set<string>();
  let current = "";
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b >= 32 && b <= 126) {
      current += String.fromCharCode(b);
    } else {
      if (current.length >= 4) {
        const t = current.trim();
        // Prefer I/O-like or device-like tags
        if (
          /^(AI|AO|DI|DO|FB)\d/i.test(t) ||
          /^[AD]\d{2,}/.test(t) ||
          /^[A-Z]?\d{2,}[A-Z]/.test(t)
        ) {
          if (!seen.has(t)) {
            seen.add(t);
            tags.push({ raw: t, parsed: parseIoTag(t) });
          }
        }
      }
      current = "";
    }
  }
  if (current.length >= 4) {
    const t = current.trim();
    if (!seen.has(t) && /^(AI|AO|DI|DO)/i.test(t)) {
      tags.push({ raw: t, parsed: parseIoTag(t) });
    }
  }
  return tags;
}
