/**
 * Cross-reference addresses.
 *
 * Type 8 records (IREF / OREF) and type 7 terminal entries carry a rigidly
 * formatted 10-character address. Column analysis over all 63,613 type 8
 * records shows byte 4 is always '-' and byte 7 is always '.':
 *
 *     B A Z 2 - 0 8 . 0 7
 *     | | | | | | | | | |
 *     +-+ | | | +-+ | +-+
 *      |  +-+ |  |  |  |
 *      |   |  |  |  |  +-- port
 *      |   |  |  |  +----- separator '.'
 *      |   |  |  +-------- block
 *      |   |  +----------- separator '-'
 *      |   +-------------- sheet suffix
 *      +------------------ module prefix
 *
 * The sheet suffix names the target drawing. The vendor's own `I90XREF.OUT`
 * report confirms it: on sheet `3070500A.CAD`, output `CAPTURE0705` has source
 * `BA00-14.26` (suffix `00`, matching `30705**00**A`) and destination
 * `BAZ2-08.07 30705Z2A` (suffix `Z2`, matching `30705**Z2**A`).
 */

export interface ParsedReference {
  /** The raw 10-character address. */
  raw: string;
  /** Characters 0..1 — identifies the module / loop. */
  modulePrefix: string;
  /** Characters 2..3 — identifies the target sheet within the module. */
  sheetSuffix: string;
  block: string;
  port: string;
}

const REF_RE = /^([A-Z0-9 ]{2})([A-Z0-9 ]{2})-([0-9 ]{2})\.([0-9 ]{2})$/i;

export function parseReference(raw: string | undefined): ParsedReference | undefined {
  if (!raw) return undefined;
  // Pad so a trimmed value still matches the fixed-width format.
  const s = raw.length === 10 ? raw : raw.padEnd(10, " ");
  const m = s.match(REF_RE);
  if (!m) return undefined;
  return {
    raw: s.trim(),
    modulePrefix: m[1].trim(),
    sheetSuffix: m[2].trim(),
    block: m[3].trim(),
    port: m[4].trim(),
  };
}

/**
 * Decompose a drawing filename into the parts needed to rebuild a sibling
 * name: `30705D6A.CAD` -> prefix `30705`, suffix `D6`, revision `A`.
 */
export function parseSheetName(filename: string): {
  stem: string;
  loopPrefix: string;
  sheetSuffix: string;
  revision: string;
} | undefined {
  const stem = filename.replace(/\.[A-Z0-9]+$/i, "").toUpperCase();
  if (stem.length < 8) return undefined;
  return {
    stem,
    loopPrefix: stem.slice(0, 5),
    sheetSuffix: stem.slice(5, 7),
    revision: stem.slice(7),
  };
}

/**
 * Resolve a reference to the drawing it points at, expressed in the naming
 * convention of the sheet that holds the reference. Returns undefined when the
 * reference or the host filename does not follow the convention, rather than
 * guessing a target.
 */
export function resolveReferenceTarget(
  ref: ParsedReference,
  hostFilename: string
): string | undefined {
  const host = parseSheetName(hostFilename);
  if (!host || ref.sheetSuffix.length !== 2) return undefined;
  return `${host.loopPrefix}${ref.sheetSuffix}${host.revision}.CAD`;
}

/** True when the reference points at the sheet that contains it. */
export function isSelfReference(ref: ParsedReference, hostFilename: string): boolean {
  const host = parseSheetName(hostFilename);
  return host ? host.sheetSuffix === ref.sheetSuffix : false;
}
