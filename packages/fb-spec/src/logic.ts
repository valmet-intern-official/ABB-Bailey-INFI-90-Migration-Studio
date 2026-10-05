/**
 * Logic connections from the drawn topology.
 *
 * A net joins wires that meet exactly (reconstruct model). Its output-side
 * pins and IREF connectors drive it; input-side pins and OREF connectors are
 * driven. Pin direction comes from the side of the symbol (INFERRED), so a
 * connection is never stronger than INFERRED unless a block-address spec on
 * the driven pin names the same source block.
 */
import type { ReconstructModel } from "@infi90/cad-engine";
import { getFunctionCode } from "@infi90/function-codes";
import type { ExtractionResult, LogicConnection } from "./types";

type DrawingSheet = ReconstructModel.DrawingSheet;

interface Terminal {
  kind: "pin" | "connector";
  file: string;
  page: number;
  block: number | null;
  terminal: string | null;
  /** Number of outputs the manual lists for the block's function code. */
  outputs?: number;
  connector?: ReconstructModel.Connector;
  /** Drawn symbol name when the pin belongs to a symbol. */
  symbol?: string;
  entity: string;
}

/**
 * Block address an output pin drives: the manual labels outputs `N`, `N+1`,
 * …, where N is the block's own address. Null when the pin's label is not
 * established and the block has more than one output.
 */
export function outputAddress(t: { kind: string; block: number | null; terminal: string | null; outputs?: number }): number | null {
  if (t.kind !== "pin" || t.block == null) return null;
  const label = t.terminal?.split("/")[1];
  const m = label ? /^N(?:\+(\d+))?$/.exec(label) : null;
  if (m) return t.block + (m[1] ? Number(m[1]) : 0);
  return t.outputs === 1 ? t.block : null;
}

const weakest = (...xs: Array<"EXPLICIT" | "DERIVED" | "INFERRED" | "UNRESOLVED">) => {
  const order = ["UNRESOLVED", "INFERRED", "DERIVED", "EXPLICIT"] as const;
  return order[Math.min(...xs.map((x) => order.indexOf(x)))];
};

export function buildConnections(sheets: DrawingSheet[], result: ExtractionResult): LogicConnection[] {
  const out: LogicConnection[] = [];
  const pageOf = new Map(sheets.map((s, i) => [s.file, i + 1]));
  const blockByKey = new Map(result.blocks.map((b) => [`${b.file}#${b.block_address}`, b]));
  const specById = new Map(result.specifications.map((s) => [s.id, s]));

  const terminalsOf = (sheet: DrawingSheet) => {
    const page = pageOf.get(sheet.file)!;
    const blockOf = new Map(sheet.functionBlocks.map((b) => [b.id, b]));
    const pinT = new Map<string, Terminal>();
    for (const p of sheet.pins) {
      const b = blockOf.get(p.blockId);
      const rec = b?.blockNumber != null ? blockByKey.get(`${sheet.file}#${b.blockNumber}`) : undefined;
      const label = rec?.pins.find((x) => x.pin === p.pinName)?.label ?? null;
      const schema = rec?.function_code != null ? getFunctionCode(rec.function_code) : undefined;
      pinT.set(p.id, {
        kind: "pin",
        file: sheet.file,
        page,
        block: b?.blockNumber ?? null,
        terminal: label ? `${p.pinName}/${label}` : p.pinName,
        outputs: schema ? schema.outputs.length || schema.symbol.outputs.length : undefined,
        symbol: b?.symbolName,
        entity: b ? `${sheet.file}@${b.source.offset}:${p.pinName}` : `${sheet.file}:${p.id}`,
      });
    }
    const conT = new Map<string, Terminal>();
    for (const c of sheet.connectors) {
      conT.set(c.id, { kind: "connector", file: sheet.file, page, block: null, terminal: c.tag, connector: c, entity: `${sheet.file}@${c.source.offset}` });
    }
    return { pinT, conT };
  };

  const perSheet = new Map(sheets.map((s) => [s.file, { sheet: s, ...terminalsOf(s) }]));
  let seq = 0;
  // A pin on a symbol without a block number (constant, hardware, termination
  // graphics) is a drawn endpoint but not a function block the connection can name.
  const push = (c: Omit<LogicConnection, "id">, ends: Array<Terminal | null | undefined> = []) => {
    const unnumbered = ends.filter((t): t is Terminal => !!t && t.kind === "pin" && t.block == null);
    if (unnumbered.length && c.status !== "UNRESOLVED") {
      const what = unnumbered.map((t) => `${t.symbol ?? "?"} (${t.entity})`).join(", ");
      c = { ...c, status: "UNRESOLVED", note: [c.note, `ENDPOINT_NOT_A_FUNCTION_BLOCK: ${what}`].filter(Boolean).join("; ") };
    }
    out.push({ id: `C${++seq}`, ...c });
  };

  const specCheck = (target: Terminal, source: Terminal | null) => {
    if (target.kind !== "pin" || target.block == null || !target.terminal?.includes("/")) return undefined;
    const address = source ? outputAddress(source) : null;
    if (address == null) return undefined;
    const label = target.terminal.split("/")[1];
    const spec = specById.get(`${target.file}#${target.block}.${label}`);
    if (!spec || !spec.is_block_address || spec.actual_value == null) return undefined;
    return { spec: label, value: spec.actual_value, agrees: spec.actual_value === address };
  };

  // Driven pins reachable from a connector on its own sheet.
  const sinksOnNetOf = (file: string, connectorId: string): Terminal[] => {
    const s = perSheet.get(file);
    if (!s) return [];
    const net = s.sheet.nets.find((n) => n.connectorIds.includes(connectorId));
    if (!net) return [];
    return net.sinks.map((id) => s.pinT.get(id)).filter((t): t is Terminal => !!t);
  };

  for (const { sheet, pinT, conT } of perSheet.values()) {
    const page = pageOf.get(sheet.file)!;
    for (const net of sheet.nets) {
      const wires = net.connectionIds.map((id) => sheet.connections.find((c) => c.id === id)).filter(Boolean) as ReconstructModel.Connection[];
      const wireStatus = wires.length ? weakest(...wires.map((w) => w.relationStatus)) : "UNRESOLVED";
      const wireIds = wires.map((w) => `${sheet.file}@${w.source.offset}`);
      const drivers = net.drivers.map((id) => pinT.get(id) ?? conT.get(id)).filter((t): t is Terminal => !!t);
      const sinks = net.sinks.map((id) => pinT.get(id) ?? conT.get(id)).filter((t): t is Terminal => !!t);
      const pinDrivers = drivers.filter((d) => d.kind === "pin");
      const irefs = drivers.filter((d) => d.kind === "connector");

      if (pinDrivers.length > 1) {
        result.diagnostics.push({ code: "BROKEN_CONNECTION", severity: "warning", message: `net ${net.id} has ${pinDrivers.length} output pins: ${pinDrivers.map((d) => `${d.block}:${d.terminal}`).join(", ")}`, file: sheet.file, page, entity_ids: wireIds });
      }
      if (!drivers.length && sinks.some((s) => s.kind === "pin")) {
        result.diagnostics.push({ code: "BROKEN_CONNECTION", severity: "warning", message: `net ${net.id} drives ${sinks.filter((s) => s.kind === "pin").map((s) => `${s.block}:${s.terminal}`).join(", ")} but has no output pin or incoming reference`, file: sheet.file, page, entity_ids: wireIds });
      }

      // Local block-to-block wiring.
      for (const d of pinDrivers) {
        for (const s of sinks) {
          if (s.kind !== "pin") continue;
          const check = specCheck(s, d);
          push({
            source_block: d.block,
            source_terminal: d.terminal,
            source_address: outputAddress(d),
            target_block: s.block,
            target_terminal: s.terminal,
            signal: null,
            page,
            file: sheet.file,
            target_page: null,
            target_file: null,
            kind: "WIRE_NET",
            source_entity_ids: [d.entity, ...wireIds, s.entity],
            status: check?.agrees ? "EXPLICIT" : weakest(wireStatus, "INFERRED"),
            spec_check: check,
          }, [d, s]);
        }
      }

      // Outgoing references: driver pin → OREF → partner IREF → driven pins there.
      for (const s of sinks) {
        if (s.kind !== "connector" || !s.connector || s.connector.kind !== "OREF") continue;
        const r = s.connector.resolution;
        const targetFile = r.targetSheet;
        const partner = r.targetConnectorId;
        const remote = targetFile && partner ? sinksOnNetOf(targetFile, partner) : [];
        const srcs = pinDrivers.length ? pinDrivers : [null];
        for (const d of srcs) {
          if (!remote.length) {
            push({
              source_block: d?.block ?? null,
              source_terminal: d?.terminal ?? null,
              source_address: d ? outputAddress(d) : null,
              target_block: null,
              target_terminal: null,
              signal: s.connector.tag,
              page,
              file: sheet.file,
              target_page: targetFile ? pageOf.get(targetFile) ?? null : null,
              target_file: targetFile,
              kind: "CROSS_SHEET_REFERENCE",
              source_entity_ids: [...(d ? [d.entity] : []), ...wireIds, s.entity],
              status: "UNRESOLVED",
              note: `${r.status}: ${r.evidence.join("; ") || "no partner"}`,
            });
            continue;
          }
          for (const t of remote) {
            const check = specCheck(t, d);
            push({
              source_block: d?.block ?? null,
              source_terminal: d?.terminal ?? null,
              source_address: d ? outputAddress(d) : null,
              target_block: t.block,
              target_terminal: t.terminal,
              signal: s.connector.tag,
              page,
              file: sheet.file,
              target_page: t.page,
              target_file: t.file,
              kind: "CROSS_SHEET_REFERENCE",
              source_entity_ids: [...(d ? [d.entity] : []), ...wireIds, s.entity, `${t.file}:${partner}`, t.entity],
              status: check?.agrees ? "EXPLICIT" : weakest(wireStatus, r.relation, d ? "INFERRED" : "UNRESOLVED"),
              spec_check: check,
              note: r.status,
            }, [d, t]);
          }
        }
      }

      // Incoming references whose partner is not resolved: keep the boundary.
      for (const i of irefs) {
        const r = i.connector!.resolution;
        if (r.targetConnectorId && r.targetSheet) continue;
        for (const s of sinks) {
          if (s.kind !== "pin") continue;
          push({
            source_block: null,
            source_terminal: null,
            source_address: null,
            target_block: s.block,
            target_terminal: s.terminal,
            signal: i.connector!.tag,
            page,
            file: sheet.file,
            target_page: null,
            target_file: r.targetSheet,
            kind: "CROSS_SHEET_REFERENCE",
            source_entity_ids: [i.entity, ...wireIds, s.entity],
            status: "UNRESOLVED",
            note: `${r.status}${i.connector!.reference ? ` ${i.connector!.reference}` : ""}: ${r.evidence.join("; ")}`,
          });
        }
      }
    }
  }

  return out;
}

/**
 * Configured references: every extracted local block-address spec that
 * resolves to a block in the module (and whose pin is not wired) is a signal
 * from that block's output into this block's spec.
 */
export function specConnections(result: ExtractionResult): LogicConnection[] {
  const out: LogicConnection[] = [];
  const blockById = new Map(result.blocks.map((b) => [b.id, b]));
  let seq = 0;
  for (const s of result.specifications) {
    const r = s.address_resolution;
    if (!r || r.status !== "RESOLVED_BLOCK" || s.status !== "EXTRACTED") continue;
    const blk = blockById.get(s.block_id)!;
    out.push({
      id: `A${++seq}`,
      source_block: r.target_block,
      source_terminal: r.target_output,
      source_address: r.address,
      target_block: s.block_address,
      target_terminal: s.label,
      signal: null,
      page: blk.page,
      file: blk.file,
      target_page: r.target_page,
      target_file: r.target_file,
      kind: "SPEC_BLOCK_ADDRESS",
      source_entity_ids: [`${s.source.file}@${s.source.byte_offset}`],
      status: r.evidence,
      note: `${s.label} = ${s.raw_value_text} (${s.manual_description})`,
    });
  }
  return out;
}
