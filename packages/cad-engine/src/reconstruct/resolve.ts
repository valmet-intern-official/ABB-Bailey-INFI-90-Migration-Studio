/**
 * Cross-sheet IREF/OREF resolution.
 *
 * A reference address is `<modulePrefix:2><sheet:2>-<row:2>.<col:2>`: the
 * zone of the drawing grid on the target sheet where the partner connector
 * sits. Resolution therefore needs no text proximity: the target connector
 * must be of the opposite kind, carry the same signal tag, and occupy that
 * zone. I90XREF.OUT (the vendor's own cross-reference report) and
 * I90XREF.ERR are used as independent confirmation, never as a substitute.
 */
import { zoneOf, type ZoneGrid } from "./build";
import type { XrefErrRow, XrefOutRow } from "./support";
import type * as T from "./types";

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toUpperCase();
const REF_RE = /^([A-Z0-9]{2})([A-Z0-9]{2})-(\d{2}\.\d{2})$/;

export interface ResolveInput {
  modulePrefix: string;
  /** Leading digits shared by this module's sheet names, e.g. `32605`. */
  moduleStem: string;
  out: XrefOutRow[];
  err: XrefErrRow[];
  registry: Set<string>;
}

export interface ZoneCalibration {
  grid: ZoneGrid;
  compared: number;
  agreeing: number;
  searched: string;
}

/** Choose the grid origin that best reproduces the vendor's source zones. */
export function calibrateZoneGrid(sheets: T.DrawingSheet[], out: XrefOutRow[], pitch = 100): ZoneCalibration {
  const bySheetDesc = new Map<string, string>();
  for (const r of out) if (r.source) bySheetDesc.set(`${r.sheet}|${r.direction}|${norm(r.description)}`, r.source.slice(5));
  const samples: Array<{ p: T.Pt; ins: T.Pt; zone: string }> = [];
  for (const s of sheets) {
    if (!s.frame.insertion) continue;
    for (const c of s.connectors) {
      if (!c.connectionPoint || !c.tag) continue;
      const z = bySheetDesc.get(`${s.id}|${c.kind === "OREF" ? "output" : "input"}|${norm(c.tag)}`);
      if (z) samples.push({ p: c.connectionPoint, ins: s.frame.insertion, zone: z });
    }
  }
  let best: ZoneCalibration = { grid: { dx: 0, dy: 0, pitch }, compared: samples.length, agreeing: -1, searched: "" };
  for (let dx = -100; dx <= 100; dx += 5) {
    for (let dy = 2000; dy <= 2300; dy += 5) {
      const grid = { dx, dy, pitch };
      let ok = 0;
      for (const s of samples) if (zoneOf(grid, s.ins, s.p) === s.zone) ok++;
      if (ok > best.agreeing) best = { grid, compared: samples.length, agreeing: ok, searched: "dx -100..100, dy 2000..2300, step 5" };
    }
  }
  return best;
}

export function resolveReferences(sheets: T.DrawingSheet[], input: ResolveInput): void {
  const byStem = new Map<string, T.DrawingSheet>();
  for (const s of sheets) byStem.set(s.id.slice(0, 7), s);
  const outBy = new Map<string, XrefOutRow[]>();
  for (const r of input.out) {
    const k = `${r.sheet}|${r.direction}|${norm(r.description)}`;
    outBy.set(k, [...(outBy.get(k) ?? []), r]);
  }
  // ERR quotes the unresolved connector's own address, not its target.
  const errBy = new Map<string, XrefErrRow[]>();
  for (const e of input.err) {
    const k = `${e.sheet}|${e.direction}|${norm(e.description)}`;
    errBy.set(k, [...(errBy.get(k) ?? []), e]);
  }

  for (const s of sheets) {
    for (const c of s.connectors) {
      const res: T.ReferenceResolution = { status: "UNRESOLVED", relation: "UNRESOLVED", targetSheet: null, targetZone: null, targetConnectorId: null, candidates: [], evidence: [] };
      const dir = c.kind === "OREF" ? "output" : "input";
      const outRows = outBy.get(`${s.id}|${dir}|${norm(c.tag)}`) ?? [];
      const ownAddress = c.zone ? `${input.modulePrefix}${s.id.slice(5, 7)}-${c.zone}` : null;
      const errRows = errBy.get(`${s.id}|${dir}|${norm(c.tag)}`) ?? [];
      const errListed = errRows.length > 0;
      const outConfirmed = outRows.some((r) => r.destinations.some((d) => d.reference === c.reference));
      if (errListed) {
        res.evidence.push(`I90XREF.ERR line ${errRows.map((e) => e.line).join(",")} quotes address ${errRows.map((e) => e.reference).join("/")}${errRows.some((e) => e.reference === ownAddress) ? " = decoded own address" : ` (decoded own address ${ownAddress})`}`);
      }
      if (outRows.length) {
        const srcZones = [...new Set(outRows.map((r) => r.source?.slice(5)).filter(Boolean))];
        res.evidence.push(`I90XREF.OUT ${dir} row(s) at line ${outRows.map((r) => r.line).join(",")}; source zone ${srcZones.join("/")}${c.zone && srcZones.includes(c.zone) ? " = decoded zone" : ` vs decoded zone ${c.zone}`}`);
      }

      const m = c.reference ? REF_RE.exec(c.reference) : null;
      if (!c.reference) {
        if (input.registry.has(norm(c.tag)) || outRows.length) {
          res.status = "BOUNDARY_SIGNAL";
          res.relation = "DERIVED";
          res.evidence.push("blank reference address in source; signal tag registered in module REF/BND/OUT");
        } else {
          res.evidence.push("blank reference address in source and tag not registered");
        }
      } else if (!m) {
        res.evidence.push(`reference '${c.reference}' does not parse as <prefix><sheet>-<row>.<col>`);
      } else if (m[1] !== input.modulePrefix) {
        res.status = "RESOLVED_EXTERNAL";
        res.relation = outConfirmed ? "EXPLICIT" : "DERIVED";
        res.targetZone = m[3];
        res.evidence.push(`module prefix ${m[1]} differs from this module's ${input.modulePrefix}: target outside supplied archive`);
      } else {
        const target = byStem.get(`${input.moduleStem}${m[2]}`);
        res.targetZone = m[3];
        if (!target) {
          res.evidence.push(`target sheet ${input.moduleStem}${m[2]}? absent from archive`);
        } else {
          res.targetSheet = target.file;
          const want = c.kind === "OREF" ? "IREF" : "OREF";
          const sameTag = target.connectors.filter((x) => x.kind === want && norm(x.tag) === norm(c.tag));
          const inZone = sameTag.filter((x) => x.zone === m[3]);
          const zoneOnly = target.connectors.filter((x) => x.kind === want && x.zone === m[3]);
          const internal = target.id === s.id;
          if (inZone.length === 1) {
            res.status = internal ? "RESOLVED_INTERNAL" : "RESOLVED_CROSS_SHEET";
            res.relation = "EXPLICIT";
            res.targetConnectorId = inZone[0].id;
            res.evidence.push(`partner ${want} '${inZone[0].tag}' found at zone ${m[3]} on ${target.file}`);
          } else if (inZone.length > 1) {
            res.status = "AMBIGUOUS";
            res.relation = "UNRESOLVED";
            res.candidates = inZone.map((x) => x.id);
            res.evidence.push(`${inZone.length} partners with the same tag in zone ${m[3]}`);
          } else if (sameTag.length === 1) {
            res.status = internal ? "RESOLVED_INTERNAL" : "RESOLVED_CROSS_SHEET";
            res.relation = "DERIVED";
            res.targetConnectorId = sameTag[0].id;
            res.evidence.push(`partner ${want} matched by tag on ${target.file} at zone ${sameTag[0].zone} (reference says ${m[3]})`);
          } else if (sameTag.length > 1) {
            res.status = "AMBIGUOUS";
            res.relation = "UNRESOLVED";
            res.candidates = sameTag.map((x) => x.id);
            res.evidence.push(`${sameTag.length} same-tag partners on ${target.file}, none in zone ${m[3]}`);
          } else if (zoneOnly.length) {
            res.status = "AMBIGUOUS";
            res.relation = "UNRESOLVED";
            res.candidates = zoneOnly.map((x) => x.id);
            res.evidence.push(`zone ${m[3]} holds ${want}(s) with different tag(s): ${zoneOnly.map((x) => `'${x.tag}'`).join(", ")}`);
          } else {
            res.evidence.push(`no ${want} with tag '${c.tag}' on ${target.file}`);
          }
        }
      }
      c.resolution = res;
      s.crossSheetReferences.push({
        id: `${c.id}.X`,
        connectorId: c.id,
        direction: c.kind,
        tag: c.tag,
        reference: c.reference,
        targetSheet: res.targetSheet,
        status: res.status,
        relation: res.relation,
        xrefOutConfirmed: outConfirmed,
        outSourceZone: outRows[0]?.source?.slice(5) ?? null,
        outSourceZoneAgrees: outRows.length ? outRows.some((r) => r.source?.slice(5) === c.zone) : null,
        errListed,
      });
      if (res.status === "RESOLVED_CROSS_SHEET" || res.status === "RESOLVED_EXTERNAL") {
        s.junctions.push({
          id: `${c.id}.OFF`,
          kind: "off-sheet-connector",
          at: c.connectionPoint ?? c.insertion,
          status: res.relation,
          source: c.source,
          connectionIds: [...c.connectionIds],
          note: `${c.kind} ${c.reference} -> ${res.targetSheet ?? "external"}`,
        });
      }
    }
  }
}

/** Re-zone every connector after calibration. */
export function applyZoneGrid(sheets: T.DrawingSheet[], grid: ZoneGrid): void {
  for (const s of sheets) {
    for (const c of s.connectors) c.zone = zoneOf(grid, s.frame.insertion, c.connectionPoint ?? c.insertion);
  }
}
