/**
 * Forensic inventory of the raw archive: every file, and for every CAD sheet
 * every record with its offset, length, raw bytes and decoded fields.
 * Uninterpreted values are listed, never dropped.
 */
import crypto from "node:crypto";
import { decodeRecordStream, decodeTrailer, readLibraryName } from "../../../packages/cad-engine/src/index";
import { cadFileBounds } from "../../../packages/cad-engine/src/binary/reader";
import type { ArchiveFile } from "./context";

const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

export function categorize(name: string): string {
  const ext = name.split(".").pop()!.toUpperCase();
  if (/^I90XREF\.(OUT|XRF|ERR)$/i.test(name)) return `XREF_${ext}`;
  return ({ CAD: "CAD", CFG: "CFG", REF: "REF", BND: "BND", VFY: "VFY", MHD: "MHD", LST: "LST", LOG: "LOG", GES: "GES", MDC: "MDC", BAT: "BAT" } as Record<string, string>)[ext] ?? "OTHER";
}

function recordClass(r: ReturnType<typeof decodeRecordStream>["records"][number]): string {
  if (r.kind === "polyline") return "connection-or-line";
  if (r.kind === "text") return r.layer === 8 && /^[A-Z0-9]{4}-\d{2}\.\d{2}$/.test((r.text ?? "").trim()) ? "xref-annotation-text" : "text";
  if (r.kind === "primitive3") return "arc";
  if (r.kind === "primitive2") return r.type === 3 ? "rectangle" : "two-point-unresolved";
  if (r.kind === "symbol") {
    const n = r.symbolName ?? "";
    if (n === "IREF" || n === "IREFO") return "IREF";
    if (n === "OREF") return "OREF";
    if (n === "N90CNECT") return "junction-marker";
    if (n === "DBORDH" || n === "LINE") return "frame-symbol";
    return "function-or-symbol";
  }
  return "unknown";
}

export function forensicInventory(files: ArchiveFile[]) {
  const out = files.map((f) => {
    const category = categorize(f.name);
    const base: Record<string, unknown> = { name: f.name, archivePath: f.entry, byteSize: f.data.length, sha256: sha(f.data), category };
    if (category === "BAT") {
      const text = f.data.toString("latin1");
      base.security = /copy\s+%0/i.test(text) && /for\s+\/r/i.test(text)
        ? { flag: "SELF_REPLICATING_BATCH", detail: "copies itself into every directory under D:\\ ; never executed by this tool", content: text.trim() }
        : { flag: "BATCH_FILE", content: text.trim() };
    }
    if (category !== "CAD") {
      if (/^(LST|LOG|XREF_OUT|XREF_XRF|XREF_ERR|VFY|MDC)$/.test(category)) {
        const text = f.data.toString("latin1");
        base.lineCount = text.split(/\r?\n/).length;
        base.head = text.split(/\r?\n/).slice(0, 5).map((l) => l.trimEnd());
      }
      return base;
    }
    const { records, clean, coverage, diagnostics } = decodeRecordStream(f.data);
    const trailer = decodeTrailer(f.data);
    const bounds = cadFileBounds(f.data);
    const classCounts: Record<string, number> = {};
    const recs = records.map((r) => {
      const cls = recordClass(r);
      classCounts[cls] = (classCounts[cls] ?? 0) + 1;
      const rec: Record<string, unknown> = {
        offset: r.offset,
        lengthBytes: r.lengthBytes,
        type: r.type,
        layer: r.layer,
        class: cls,
        rawHex: f.data.subarray(r.offset, r.offset + r.lengthBytes).toString("hex"),
      };
      if (r.kind === "polyline") Object.assign(rec, { style: r.style, points: r.points });
      else if (r.kind === "primitive2" || r.kind === "primitive3") rec.points = r.points;
      else if (r.kind === "text") Object.assign(rec, { text: r.text, bbox: [r.x1, r.y1, r.x2, r.y2], height: r.textHeight, heightFlagBit15: r.textHeightFlag, rotation: r.rotation });
      else if (r.kind === "symbol")
        Object.assign(rec, {
          symbolName: r.symbolName,
          bbox: [r.x1, r.y1, r.x2, r.y2],
          insertion: [r.insertionX, r.insertionY],
          rotation: r.rotation,
          flags: r.flags,
          blockNumber: r.blockNumber,
          tag: r.tag,
          reference: r.reference,
          terminals: r.entries,
        });
      if (r.reserved?.length) rec.unknownFields = r.reserved;
      if (r.unresolved.length) rec.unresolvedFieldNames = r.unresolved;
      if (r.residualHex) rec.residualHex = r.residualHex;
      return rec;
    });
    return {
      ...base,
      library: readLibraryName(f.data),
      header: { bytes: 256, rawHex: f.data.subarray(0, 256).toString("hex") },
      recordStream: { start: bounds.recordsStart, end: bounds.recordsEnd, clean, diagnostics, coverage },
      recordCount: records.length,
      classCounts,
      functionLabels: [...new Set(records.filter((r) => r.kind === "symbol" && r.symbolName).map((r) => r.symbolName!))].sort(),
      textPayloads: records.filter((r) => r.kind === "text" && r.text).length,
      trailer: {
        present: trailer.present,
        spcOffset: trailer.spcOffset,
        atrOffset: trailer.atrOffset,
        endOffset: trailer.endOffset,
        atrRawHex: trailer.atrOffset != null && trailer.endOffset != null ? f.data.subarray(trailer.atrOffset, trailer.endOffset).toString("hex") : null,
        entries: trailer.specifications.map((s) => ({
          offset: s.offset,
          lengthBytes: s.lengthBytes,
          blockNumber: s.blockNumber,
          functionCode: s.functionCode,
          rawHex: f.data.subarray(s.offset, s.offset + s.lengthBytes).toString("hex"),
        })),
        diagnostics: trailer.diagnostics,
      },
      records: recs,
    };
  });
  const byCategory: Record<string, number> = {};
  for (const f of out) byCategory[f.category as string] = (byCategory[f.category as string] ?? 0) + 1;
  return { files: out, byCategory };
}
