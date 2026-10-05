import type { DecodedM1 } from "../decoder/types";
import type { M1Analysis } from "../pipeline/analyze";

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6)) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header.join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n") + "\n";
}

export function recordsCsv(d: DecodedM1): string {
  return toCsv(
    ["id", "index", "offset", "end_offset", "length", "class", "record_type", "known", "fields", "refs", "unresolved_bytes", "decode_error"],
    d.records.map((r) => [r.id, r.index, r.offset, r.endOffset, r.length, r.className, r.recordType, r.known, r.fields.length, r.refs.length, r.unresolvedBytes, r.decodeError ?? ""])
  );
}

export function recordIndexCsv(d: DecodedM1): string {
  return toCsv(
    ["id", "offset_hex", "offset", "length", "class", "first_bytes_hex"],
    d.records.map((r) => [r.id, "0x" + r.offset.toString(16).padStart(6, "0"), r.offset, r.length, r.className, r.fields[0]?.rawHex.slice(0, 48) ?? ""])
  );
}

export function fieldsCsv(d: DecodedM1): string {
  const rows: unknown[][] = [];
  for (const f of d.header.fields) rows.push([0, "HEADER", f.name, f.type, f.offset, f.length, f.status, f.value, f.rawHex, f.note ?? ""]);
  for (const r of d.records) for (const f of r.fields) rows.push([r.id, r.className, f.name, f.type, f.offset, f.length, f.status, f.value, f.rawHex, f.note ?? ""]);
  return toCsv(["object_id", "class", "field", "type", "offset", "length", "status", "value", "raw_hex", "note"], rows);
}

export function stringsCsv(d: DecodedM1): string {
  const rows: unknown[][] = [];
  for (const r of d.records) for (const f of r.fields) if ((f.type === "cstr" || f.type === "lstr") && f.value !== "") rows.push([r.id, r.className, f.name, f.offset, f.length, f.value]);
  return toCsv(["object_id", "class", "field", "offset", "length", "value"], rows);
}

export function tagsCsv(a: M1Analysis): string {
  return toCsv(
    ["tag", "atoms", "instance_ids", "templates"],
    a.tagIndex.map((t) => [t.tag, t.atoms.join(" "), t.instances.join(" "), t.templates.join(" ")])
  );
}

export function propertiesCsv(a: M1Analysis): string {
  const rows: unknown[][] = [];
  for (const inst of a.bindings)
    for (const b of inst.bindings) {
      const p = inst.properties.find((x) => x.key === b.key && x.valueRef === b.valueRef);
      rows.push([inst.instanceId, inst.templateName, b.key, b.valueRef, p?.valueClass ?? "", b.rawValue, b.kind, b.expandedKey ?? "", b.tag ?? "", b.atom ?? "", b.status, b.note ?? ""]);
    }
  return toCsv(["instance_id", "template", "key", "value_ref", "value_class", "value", "kind", "expanded_key", "tag", "atom", "status", "note"], rows);
}

export function transformsCsv(a: M1Analysis): string {
  const users = new Map<number, number[]>();
  for (const e of a.graph.edges) if (e.role === "transform") users.set(e.to, [...(users.get(e.to) ?? []), e.from]);
  const rows: unknown[][] = [];
  for (const r of a.decoded.records) {
    if (r.className !== "Scal2d" && r.className !== "Mat2x3") continue;
    const d = r.decoded as Record<string, number>;
    const isS = r.className === "Scal2d";
    rows.push([r.id, r.className, isS ? d.sx : d.a, isS ? 0 : d.b, isS ? 0 : d.c, isS ? d.sy : d.d, d.tx / 65536, d.ty / 65536, d.tx, d.ty, (users.get(r.id) ?? []).join(" ")]);
  }
  return toCsv(["id", "class", "a", "b", "c", "d", "tx_units", "ty_units", "tx_raw", "ty_raw", "used_by"], rows);
}

export function geometryCsv(a: M1Analysis): string {
  const owner = new Map<number, number>();
  for (const e of a.graph.edges) if (e.role === "geometry" || e.role === "anchor" || e.role === "secondary" || e.role === "link-second") owner.set(e.to, e.from);
  const rows: unknown[][] = [];
  for (const r of a.decoded.records) {
    if (r.className === "PtArray") {
      const pts = (r.decoded as { points: [number, number][] }).points;
      pts.forEach(([x, y], i) => rows.push([r.id, r.className, owner.get(r.id) ?? "", i, x, y]));
    } else if (r.className === "Point") {
      const p = r.decoded as { x: number; y: number };
      rows.push([r.id, r.className, owner.get(r.id) ?? "", 0, p.x, p.y]);
    }
  }
  return toCsv(["id", "class", "owner_id", "point_index", "x", "y"], rows);
}

export function groupsCsv(a: M1Analysis): string {
  const depth = new Map<number, number>([[a.graph.rootId, 0]]);
  const rows: unknown[][] = [];
  for (const r of a.decoded.records) {
    if (!["Model", "Group", "FillGroup"].includes(r.className)) continue;
    const children = (r.decoded as { children?: number[] }).children ?? [];
    const dp = depth.get(r.id) ?? 0;
    for (const c of children) depth.set(c, dp + 1);
    rows.push([r.id, r.className, dp, children.length, children.join(" "), children.map((c) => a.graph.byId.get(c)?.className ?? "?").join(" ")]);
  }
  return toCsv(["id", "class", "depth", "child_count", "child_ids", "child_classes"], rows);
}

export function linksCsv(a: M1Analysis): string {
  return toCsv(
    ["from_id", "from_class", "field", "role", "to_id", "to_class"],
    a.graph.edges.map((e) => [e.from, a.graph.byId.get(e.from)?.className, e.field, e.role, e.to, a.graph.byId.get(e.to)?.className ?? "(missing)"])
  );
}

/** Classic 16-byte hexdump with the owning record annotated at record starts. */
export function hexdump(data: Buffer, d: DecodedM1): string {
  const starts = new Map<number, string>();
  starts.set(0, "HEADER");
  for (const r of d.records) starts.set(r.offset, `#${r.id} ${r.className}`);
  const lines: string[] = [];
  for (let off = 0; off < data.length; off += 16) {
    const chunk = data.subarray(off, Math.min(off + 16, data.length));
    const hexs = [...chunk].map((b) => b.toString(16).padStart(2, "0"));
    const hexPart = (hexs.slice(0, 8).join(" ") + "  " + hexs.slice(8).join(" ")).padEnd(49);
    const ascii = [...chunk].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("");
    const marks: string[] = [];
    for (let i = off; i < off + chunk.length; i++) if (starts.has(i)) marks.push(`@${(i - off).toString(16)}:${starts.get(i)}`);
    lines.push(`${off.toString(16).padStart(8, "0")}  ${hexPart} |${ascii.padEnd(16)}|${marks.length ? "  " + marks.join(" ") : ""}`);
  }
  return lines.join("\n") + "\n";
}
