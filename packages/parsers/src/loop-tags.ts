/**
 * Loop-tag extraction from the CAD logic sheets.
 *
 * A loop tag is drawn as a text label directly under the bottom edge of the
 * function block that carries it (FC30/45/80/123/129 …), e.g. "131LI-104"
 * under the FC30 that the AI "AI15-SL3/131LT-104" is wired into. For each IO
 * device the candidates are the labelled blocks reachable from its IO tag
 * through the sheet wiring, plus every label in the module that carries the
 * same loop number; the candidate is then chosen by ISA naming agreement
 * (loop number, measured-variable letter, digital vs analog function) and
 * wiring distance.
 */
import type { CadSheetParse, CorrelatedProject, IoRecord } from "@infi90/core";

const LOOP_LABEL = /^(\d{3})([A-Z]{1,6})-([A-Z]?)(\d{1,4}[A-Z]?)(?:\.\d+)?(?:_[A-Z]+)?$/i;
/** Label position relative to its block: right of the left edge, just below the bottom edge. */
const LABEL_DX: [number, number] = [-20, 320];
const LABEL_DY: [number, number] = [-10, 70];
const MAX_HOPS = 6;
const NUMBER_MATCH_DEPTH = MAX_HOPS;

interface LoopLabel {
  tag: string;
  sheet: string;
  blockNumber?: string;
  functionCode?: number;
}

interface TagParts {
  area: string;
  letters: string;
  num: string;
  base: string;
}

/** "131LI-0103.0" → "131LI-103"; numbers keep at least three digits. */
export function canonicalLoopTag(text: string): string | null {
  const m = LOOP_LABEL.exec(text.trim());
  if (!m) return null;
  return `${m[1]}${m[2]}-${m[3]}${m[4].replace(/^0+(?=\d{3})/, "")}`.toUpperCase();
}

function loopParts(tag: string): TagParts | null {
  const m = /^(\d{3})([A-Z]+)-([A-Z]?)(\d{1,4})([A-Z]?)$/.exec(tag);
  return m ? { area: m[1], letters: m[2], num: `${m[3]}${m[4]}${m[5]}`, base: `${m[3]}${m[4]}` } : null;
}

/** Device tags carry a lowercase signal suffix ("131XS-M102rf"); uppercase letters belong to the tag. */
function deviceParts(tag: string): TagParts | null {
  const m = /^(\d{3})([A-Z]+)-?([A-Z]?)(\d{1,4})([A-Z]?)/.exec(tag.trim());
  if (!m) return null;
  const digits = m[4].replace(/^0+(?=\d{3})/, "");
  return { area: m[1], letters: m[2], num: `${m[3]}${digits}${m[5]}`, base: `${m[3]}${digits}` };
}

function deviceCanonical(tag: string): string | null {
  const p = deviceParts(tag);
  return p ? `${p.area}${p.letters}-${p.num}` : null;
}

const normalize = (t: string) => t.toUpperCase().replace(/[^A-Z0-9]/g, "");
const isDigital = (t: IoRecord["ioType"]) => t === "DI" || t === "DO";

interface SheetIndex {
  filename: string;
  labelsByBlock: Map<string, LoopLabel[]>;
  adjacency: Map<string, Set<string>>;
  tags: { device: string; nodes: string[] }[];
}

function indexSheet(sheet: CadSheetParse): SheetIndex | null {
  const m = sheet.engineeringModel;
  if (!m) return null;
  const blocks = m.blocks.filter((b) => b.functionCodeNumber != null);
  const labelsByBlock = new Map<string, LoopLabel[]>();
  for (const a of m.annotations) {
    if (a.kind === "title") continue;
    const tag = canonicalLoopTag(a.text);
    if (!tag) continue;
    let best: (typeof blocks)[number] | undefined;
    let bestScore = Infinity;
    for (const b of blocks) {
      const dx = a.x - b.x;
      const dy = a.y - (b.y + b.height);
      if (dx < LABEL_DX[0] || dx > LABEL_DX[1] || dy < LABEL_DY[0] || dy > LABEL_DY[1]) continue;
      const s = dy + dx * 0.1;
      if (s < bestScore) {
        bestScore = s;
        best = b;
      }
    }
    if (!best) continue;
    const list = labelsByBlock.get(best.id) ?? [];
    list.push({ tag, sheet: sheet.filename, blockNumber: best.blockNumber, functionCode: best.functionCodeNumber });
    labelsByBlock.set(best.id, list);
  }
  const adjacency = new Map<string, Set<string>>();
  const link = (a?: string, b?: string) => {
    if (!a || !b) return;
    for (const [x, y] of [[a, b], [b, a]]) {
      if (!adjacency.has(x)) adjacency.set(x, new Set());
      adjacency.get(x)!.add(y);
    }
  };
  for (const c of m.connections) link(c.sourceBlockId, c.targetBlockId);
  const tags = m.tags.map((t) => ({
    device: normalize(t.raw.split("/").pop()!.split(/\s+/)[0]),
    nodes: t.connectedBlockIds,
  }));
  return { filename: sheet.filename, labelsByBlock, adjacency, tags };
}

export interface LoopTagChoice {
  loopTag: string;
  label: LoopLabel;
  via: "wiring" | "same-sheet" | "loop-number";
  hops: number;
}

const VIA_RANK: Record<LoopTagChoice["via"], number> = { wiring: 0, "same-sheet": 1, "loop-number": 2 };

/** Loop tag for every device tag in the project, keyed by normalized device tag. */
export function extractLoopTags(project: CorrelatedProject): Map<string, LoopTagChoice> {
  const sheets = project.cadSheets.map(indexSheet).filter((s): s is SheetIndex => s !== null);
  const allLabels = sheets.flatMap((s) => [...s.labelsByBlock.values()].flat());
  const owners = new Map<string, Set<IoRecord["ioType"]>>();
  for (const r of project.ioRecords) {
    const c = r.deviceTag ? deviceCanonical(r.deviceTag) : null;
    if (!c) continue;
    if (!owners.has(c)) owners.set(c, new Set());
    owners.get(c)!.add(r.ioType);
  }

  const out = new Map<string, LoopTagChoice>();
  for (const r of project.ioRecords) {
    if (!r.deviceTag) continue;
    const key = normalize(r.deviceTag);
    if (out.has(key)) continue;
    const dev = deviceParts(r.deviceTag);
    const self = deviceCanonical(r.deviceTag);
    const hasSignalSuffix = /\d[A-Z]?[a-z]/.test(r.deviceTag);
    const digital = isDigital(r.ioType);

    const candidates = new Map<string, { label: LoopLabel; hops: number; via: LoopTagChoice["via"] }>();
    const tagSheets = new Set<string>();
    for (const s of sheets) {
      for (const t of s.tags) {
        if (t.device !== key) continue;
        tagSheets.add(s.filename);
        const seen = new Set(t.nodes);
        let frontier = [...t.nodes];
        for (let hops = 0; hops < MAX_HOPS && frontier.length; hops++) {
          for (const node of frontier) {
            for (const label of s.labelsByBlock.get(node) ?? []) {
              const prev = candidates.get(label.tag);
              if (!prev || prev.hops > hops) candidates.set(label.tag, { label, hops, via: "wiring" });
            }
          }
          const next: string[] = [];
          for (const node of frontier) {
            for (const n of s.adjacency.get(node) ?? []) {
              if (!seen.has(n)) {
                seen.add(n);
                next.push(n);
              }
            }
          }
          frontier = next;
        }
      }
    }
    for (const s of sheets) {
      if (!tagSheets.has(s.filename)) continue;
      for (const label of [...s.labelsByBlock.values()].flat()) {
        if (!candidates.has(label.tag)) candidates.set(label.tag, { label, hops: MAX_HOPS, via: "same-sheet" });
      }
    }
    if (dev) {
      for (const label of allLabels) {
        const l = loopParts(label.tag);
        if (l && l.area === dev.area && l.num === dev.num && !candidates.has(label.tag)) {
          candidates.set(label.tag, { label, hops: NUMBER_MATCH_DEPTH, via: "loop-number" });
        }
      }
    }
    if (!candidates.size) continue;
    const digitsOf = (base: string) => base.replace(/^\D/, "");

    const score = (tag: string, hops: number, sheet: string) => {
      const l = loopParts(tag);
      if (!dev || !l) return -hops;
      let s = 0;
      if (l.num === dev.num) s += 4;
      else if (l.base === dev.base) s += 2;
      else if (digitsOf(l.base) === digitsOf(dev.base)) s += 1.5;
      if (tagSheets.has(sheet)) s += 3;
      if (l.letters[0] === dev.letters[0] && dev.letters[0] !== "X") s += 2;
      const devLast = dev.letters.at(-1)!;
      const loopLast = l.letters.at(-1)!;
      if ((devLast === "H" || devLast === "L") && loopLast === devLast) s += 1;
      if (loopLast === "R") s -= 1;
      if (digital) {
        if (loopLast === "I") s -= 2;
        if (loopLast === "S") s += 0.5;
      } else {
        if (loopLast === "S") s -= 2;
        if (loopLast === "I" || loopLast === "C") s += 0.5;
        if (loopLast === "C") s += 0.2;
      }
      if (l.area === dev.area) s += 1;
      const tagOwners = owners.get(tag);
      if (tag !== self && tagOwners && (digital || tagOwners.has(r.ioType))) s -= 3;
      if (tag === self && hasSignalSuffix) s -= 3;
      s -= (l.letters.length - 2) * 0.3;
      return s - hops * 0.3;
    };

    const ranked = [...candidates].map(([tag, c]) => ({ tag, c, s: score(tag, c.hops, c.label.sheet) }));
    const top = Math.max(...ranked.map((x) => x.s));
    let winners = ranked.filter((x) => Math.abs(x.s - top) < 1e-9);
    if (winners.length > 1) {
      const closest = Math.min(...winners.map((x) => VIA_RANK[x.c.via]));
      winners = winners.filter((x) => VIA_RANK[x.c.via] === closest);
    }
    if (winners.length !== 1) continue;
    const w = winners[0];
    out.set(key, { loopTag: w.tag, label: w.c.label, via: w.c.via, hops: w.c.hops });
  }
  return out;
}

/**
 * Set `loopTag` on every IO record from the CAD labels, and `description` from
 * the title-block page description of the sheet that carries that label.
 */
export function applyCadLoopTags(project: CorrelatedProject): void {
  const choices = extractLoopTags(project);
  const sheetByName = new Map(project.cadSheets.map((s) => [s.filename.toUpperCase(), s]));
  for (const r of project.ioRecords) {
    const c = r.deviceTag ? choices.get(normalize(r.deviceTag)) : undefined;
    if (!c) {
      r.loopTag = undefined;
      r.loopTagSource = undefined;
      r.loopTagNote = `no loop-tag label found in the CAD for ${r.deviceTag ?? r.rawIoTag}`;
      r.loopTagBlock = undefined;
      r.description = undefined;
      r.descriptionNote = "no loop tag, so no loop page to take a description from";
      r.mappingStatus = "partial";
      continue;
    }
    const loopSheet = sheetByName.get(c.label.sheet.toUpperCase());
    const page = loopSheet?.pageDescription;
    r.description = page;
    r.descriptionNote = page
      ? `${c.label.sheet} title block DESCRIPTION`
      : loopSheet?.titleBlockNote ?? `${c.label.sheet} title block has no page description`;
    const block = c.label.blockNumber ? ` block ${c.label.blockNumber}` : "";
    const fc = c.label.functionCode != null ? ` (FC${c.label.functionCode})` : "";
    r.loopTag = c.loopTag;
    r.loopTagSource = "CAD_LABEL";
    r.loopTagBlock = {
      sheet: c.label.sheet,
      blockNumber: c.label.blockNumber,
      functionCode: c.label.functionCode,
      via: c.via,
      hops: c.hops,
    };
    r.loopTagNote =
      c.via === "wiring"
        ? `${c.label.sheet}${block}${fc}, ${c.hops} wiring hop${c.hops === 1 ? "" : "s"} from the IO tag`
        : c.via === "same-sheet"
          ? `${c.label.sheet}${block}${fc}, on the same logic sheet as the IO tag`
          : `${c.label.sheet}${block}${fc}, same loop number as the device tag`;
    r.mappingStatus = page ? "mapped" : "partial";
  }
}
