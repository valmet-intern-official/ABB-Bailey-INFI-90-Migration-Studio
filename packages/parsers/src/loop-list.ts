/**
 * Loop List: source I/O records grouped by the loop tag they are wired to.
 *
 * Membership comes from the CAD loop-tag assignment (labelled loop block
 * reachable from the IO tag); Device Tag 1 is the loop's input member
 * (AI/DI) and Device Tag 2 its output member (AO/DO), by the source I/O
 * category. Nothing is paired by row order: a side with no member is
 * UNRESOLVED, a side with several members is AMBIGUOUS and keeps them all,
 * and every source record stays in `relatedDevices`.
 *
 * Ranges are the engineering-unit zero/span of the slave block channel the IO
 * tag is drawn on (FC132 for AI, FC149 for AO), read verbatim from the decoded
 * specifications; MAX is zero + span in exact decimal arithmetic.
 */
import type {
  CadSheetParse,
  CorrelatedProject,
  IoRecord,
  LoopDevice,
  LoopEndpoint,
  LoopField,
  LoopList,
  LoopRecord,
  LoopTagBlock,
} from "@infi90/core";

export interface LogicSpecLike {
  label: string;
  value: string | null;
  status: string;
}

export interface LogicBlockLike {
  block: number;
  functionCode: number | null;
  specs: LogicSpecLike[];
}

/** Decoded function-block specifications per sheet (the session `cad-logic.json`). */
export type CadLogicLike = Record<string, LogicBlockLike[]>;

interface BlockSpecs {
  block: number;
  functionCode: number | null;
  sheet: string;
  specs: Map<number, LogicSpecLike>;
}

const AI_FC = 132;
const AO_FC = 149;
const AI_PER_BLOCK = 5;
const AO_PER_BLOCK = 7;
const EXECUTIVE_FC = 81;
const VIA_RANK: Record<LoopTagBlock["via"], number> = { wiring: 0, "same-sheet": 1, "loop-number": 2 };

// ---------------------------------------------------------------- decimals

interface Dec {
  n: bigint;
  scale: number;
}

const DEC = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;
const pow10 = (k: number) => BigInt(`1${"0".repeat(k)}`);

function parseDec(text: string): Dec | null {
  const m = DEC.exec(text.trim());
  if (!m || (!m[2] && !m[3])) return null;
  const frac = m[3] ?? "";
  let scale = frac.length - Number(m[4] ?? 0);
  let n = BigInt(`${m[2]}${frac}` || "0");
  if (scale < 0) {
    n *= pow10(-scale);
    scale = 0;
  }
  return { n: m[1] === "-" ? -n : n, scale };
}

/** Exact a + b of two decimal strings, keeping the larger number of decimals. */
export function addDecimalText(a: string, b: string): string | null {
  const x = parseDec(a);
  const y = parseDec(b);
  if (!x || !y) return null;
  const scale = Math.max(x.scale, y.scale);
  const sum = x.n * pow10(scale - x.scale) + y.n * pow10(scale - y.scale);
  const negative = sum < BigInt(0);
  const digits = (negative ? -sum : sum).toString().padStart(scale + 1, "0");
  const int = digits.slice(0, digits.length - scale);
  const frac = digits.slice(digits.length - scale);
  return `${negative ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}

// ---------------------------------------------------------------- spec index

function indexSpecs(logic: CadLogicLike | null) {
  const blocks = new Map<number, BlockSpecs>();
  const duplicates = new Set<number>();
  for (const [sheet, list] of Object.entries(logic ?? {})) {
    for (const b of list) {
      if (blocks.has(b.block)) duplicates.add(b.block);
      const specs = new Map<number, LogicSpecLike>();
      for (const s of b.specs) {
        const n = /^S(\d+)$/.exec(s.label);
        if (n) specs.set(Number(n[1]), s);
      }
      blocks.set(b.block, { block: b.block, functionCode: b.functionCode, sheet, specs });
    }
  }
  for (const d of duplicates) blocks.delete(d);
  return { blocks, duplicates };
}

type SpecIndex = ReturnType<typeof indexSpecs>;

const specText = (b: BlockSpecs, n: number) => {
  const s = b.specs.get(n);
  return s && s.status === "EXTRACTED" && s.value != null ? s.value : null;
};

/** Slave blocks of one function code driving the same I/O module (same S1), in address order. */
function linkedSlaveBlocks(idx: SpecIndex, fc: number, moduleAddress: string): BlockSpecs[] {
  return [...idx.blocks.values()]
    .filter((b) => b.functionCode === fc && specText(b, 1) === moduleAddress)
    .sort((a, b) => a.block - b.block);
}

// ---------------------------------------------------------------- wiring

interface SlaveWire {
  block: number;
  pin: string | null;
  sheet: string;
}

/** Slave blocks (of `fc`) the IO tag is drawn connected to, with the block pin. */
function slaveWires(sheets: Map<string, CadSheetParse>, r: IoRecord, fc: number): SlaveWire[] {
  const sheet = r.cadFile ? sheets.get(r.cadFile.toUpperCase()) : undefined;
  const m = sheet?.engineeringModel;
  if (!sheet || !m) return [];
  const blocks = new Map(m.blocks.map((b) => [b.id, b]));
  const out = new Map<string, SlaveWire>();
  const add = (blockId: string | undefined, portId: string | undefined) => {
    const b = blockId ? blocks.get(blockId) : undefined;
    if (!b || b.functionCodeNumber !== fc || !b.blockNumber || !/^\d+$/.test(b.blockNumber)) return;
    const pin = portId ? (b.ports.find((p) => p.id === portId)?.name ?? portId.split(".").pop() ?? null) : null;
    out.set(`${b.blockNumber}:${pin}`, { block: Number(b.blockNumber), pin, sheet: sheet.filename });
  };
  for (const t of m.tags) {
    if (t.raw.trim() !== r.rawIoTag.trim()) continue;
    for (const node of t.connectedBlockIds) {
      add(node, undefined);
      for (const c of m.connections) {
        if (c.sourceBlockId === node) add(c.targetBlockId, c.targetPortId);
        else if (c.targetBlockId === node) add(c.sourceBlockId, c.sourcePortId);
      }
    }
  }
  const wires = [...out.values()];
  return wires.some((w) => w.pin) ? wires.filter((w) => w.pin) : wires;
}

// ---------------------------------------------------------------- ranges

const field = (value: string, status: LoopField["status"], evidence: string): LoopField => ({
  value,
  status,
  evidence,
});

interface Range {
  min: LoopField;
  max: LoopField;
}

const unresolvedRange = (why: string): Range => ({
  min: field("", "UNRESOLVED", why),
  max: field("", "UNRESOLVED", why),
});

/**
 * Zero/span of the slave channel an analog IO record is drawn on.
 * FC132 input k: zero S(2+3k), span S(3+3k); drawn outputs R1…R5 are inputs 1…5.
 * FC149 output N+i: zero S(18+2i), span S(19+2i).
 * The wired block must be the one the IO channel number selects among the
 * slave blocks linked to the same module address (5 or 7 channels each).
 */
function analogRange(idx: SpecIndex, sheets: Map<string, CadSheetParse>, r: IoRecord): Range {
  const ai = r.ioType === "AI";
  const fc = ai ? AI_FC : AO_FC;
  const perBlock = ai ? AI_PER_BLOCK : AO_PER_BLOCK;
  const channel = r.channel && /^\d+$/.test(r.channel) ? Number(r.channel) : null;
  const wires = slaveWires(sheets, r, fc);
  if (wires.length > 1) {
    return unresolvedRange(
      `${r.rawIoTag} is drawn on more than one FC${fc} pin (${wires.map((w) => `${w.block} ${w.pin ?? "?"}`).join(", ")})`
    );
  }

  let block: BlockSpecs | undefined;
  let position: number | null = null;
  const basis: string[] = [];
  let corroborated = false;

  if (wires.length === 1) {
    const w = wires[0];
    if (idx.duplicates.has(w.block)) return unresolvedRange(`block ${w.block} appears more than once in the module`);
    block = idx.blocks.get(w.block);
    if (!block) return unresolvedRange(`FC${fc} block ${w.block} has no decoded specifications`);
    basis.push(`${w.sheet} wire from ${r.rawIoTag} to FC${fc} block ${w.block} pin ${w.pin ?? "?"}`);
    // Only FC132's drawn outputs follow the manual order; FC149 symbols vary per drawing.
    const pinNo = ai && w.pin ? /^R(\d+)$/.exec(w.pin) : null;
    const pinPos = pinNo && Number(pinNo[1]) >= 1 && Number(pinNo[1]) <= perBlock ? Number(pinNo[1]) : null;
    const moduleAddress = specText(block, 1);
    const linked = moduleAddress != null ? linkedSlaveBlocks(idx, fc, moduleAddress) : [];
    const rank = linked.findIndex((b) => b.block === block!.block);
    if (rank >= 0) {
      basis.push(
        `block ${block.block} is FC${fc} ${rank + 1} of ${linked.length} on module address S1=${moduleAddress} (${linked.map((b) => b.block).join(", ")})`
      );
    }
    if (channel != null && rank >= 0) {
      const chanRank = Math.floor((channel - 1) / perBlock);
      if (chanRank !== rank) {
        return unresolvedRange(
          `${basis.join("; ")}; channel ${channel} belongs to FC${fc} ${chanRank + 1} of the module, not ${rank + 1}`
        );
      }
      const chanPos = channel - rank * perBlock;
      if (pinPos != null && pinPos !== chanPos) {
        return unresolvedRange(`${basis.join("; ")}; pin gives input ${pinPos} but channel ${channel} gives ${chanPos}`);
      }
      position = chanPos;
      corroborated = true;
    } else if (pinPos != null) {
      position = pinPos;
    }
  } else {
    const moduleAddress = r.slave ? /\d+/.exec(r.slave)?.[0]?.replace(/^0+(?=\d)/, "") : undefined;
    if (moduleAddress == null || channel == null) {
      return unresolvedRange(`${r.rawIoTag} is not drawn on an FC${fc} block and has no channel/module address to place it`);
    }
    const linked = linkedSlaveBlocks(idx, fc, moduleAddress);
    const rank = Math.floor((channel - 1) / perBlock);
    block = linked[rank];
    if (!block) {
      return unresolvedRange(
        `${r.rawIoTag} is not drawn on an FC${fc} block; module address ${moduleAddress} has ${linked.length} FC${fc} block(s), channel ${channel} needs ${rank + 1}`
      );
    }
    position = channel - rank * perBlock;
    basis.push(
      `no drawn wire; channel ${channel} on module address S1=${moduleAddress} is FC${fc} block ${block.block} (${rank + 1} of ${linked.length} in address order)`
    );
  }

  if (!block || position == null || position < 1 || position > perBlock) {
    return unresolvedRange(`${basis.join("; ")}; channel position within the block is not established`);
  }
  const zeroSpec = ai ? 2 + 3 * position : 16 + 2 * position;
  const spanSpec = zeroSpec + 1;
  const zero = specText(block, zeroSpec);
  const span = specText(block, spanSpec);
  const which = ai ? `input ${position}` : `output N+${position - 1}`;
  const where = `${basis.join("; ")}; ${which}`;
  if (zero == null || span == null) {
    return unresolvedRange(`${where}; S${zeroSpec}/S${spanSpec} of block ${block.block} not extracted`);
  }
  const max = addDecimalText(zero, span);
  const status = corroborated ? "EXTRACTED" : "DERIVED";
  return {
    min: field(zero, status, `${where}; zero S${zeroSpec} of block ${block.block}`),
    max:
      max == null
        ? field("", "UNRESOLVED", `${where}; zero "${zero}" / span "${span}" are not decimal numbers`)
        : field(max, "DERIVED", `${where}; zero S${zeroSpec} "${zero}" + span S${spanSpec} "${span}" of block ${block.block}`),
  };
}

/** Engineering-unit identifier of the loop block the input is wired to (FC30 S2, FC80 S12). */
function inputUnit(idx: SpecIndex, loopBlock: LoopTagBlock | undefined): LoopField {
  const NO_TEXT = "the unit text is held in the console engineering-unit table, which is not part of the CAD package";
  if (!loopBlock?.blockNumber || !/^\d+$/.test(loopBlock.blockNumber)) {
    return field("", "UNRESOLVED", "no loop block to read an engineering-unit identifier from");
  }
  const spec = loopBlock.functionCode === 30 ? 2 : loopBlock.functionCode === 80 ? 12 : null;
  if (spec == null) {
    return field("", "UNRESOLVED", `loop block ${loopBlock.blockNumber} is FC${loopBlock.functionCode ?? "?"}, which carries no engineering-unit identifier`);
  }
  const b = idx.blocks.get(Number(loopBlock.blockNumber));
  const v = b ? specText(b, spec) : null;
  if (v == null) return field("", "UNRESOLVED", `S${spec} of loop block ${loopBlock.blockNumber} not extracted`);
  return field(`EU id ${v}`, "EXTRACTED", `engineering-unit identifier S${spec} of FC${loopBlock.functionCode} block ${loopBlock.blockNumber} (${loopBlock.sheet}); ${NO_TEXT}`);
}

/** Loop block from the record, or from the note written by older sessions. */
function loopBlockOf(r: IoRecord): LoopTagBlock | undefined {
  if (r.loopTagBlock) return r.loopTagBlock;
  const m = /^(\S+?\.CAD)(?: block (\d+))?(?: \(FC(\d+)\))?,/i.exec(r.loopTagNote ?? "");
  if (!m || !r.loopTag) return undefined;
  const via = /wiring hop/.test(r.loopTagNote!) ? "wiring" : /same logic sheet/.test(r.loopTagNote!) ? "same-sheet" : "loop-number";
  const hops = Number(/(\d+) wiring hop/.exec(r.loopTagNote!)?.[1] ?? 0);
  return { sheet: m[1], blockNumber: m[2], functionCode: m[3] ? Number(m[3]) : undefined, via, hops };
}

// ---------------------------------------------------------------- members

const isInput = (t: IoRecord["ioType"]) => t === "AI" || t === "DI";
const isAnalog = (t: IoRecord["ioType"]) => t === "AI" || t === "AO";

function toDevice(idx: SpecIndex, sheets: Map<string, CadSheetParse>, r: IoRecord): LoopDevice {
  const role = isInput(r.ioType) ? "input" : "output";
  let range: Range;
  let unit: LoopField;
  if (isAnalog(r.ioType)) {
    range = analogRange(idx, sheets, r);
    unit =
      role === "input"
        ? inputUnit(idx, loopBlockOf(r))
        : field("", "UNRESOLVED", "the CAD package carries no engineering-unit identifier for analog outputs");
  } else {
    const na = field("", "NOT_APPLICABLE", `${r.ioType} point has no engineering range`);
    range = { min: na, max: na };
    unit = na;
  }
  return {
    ioRecordId: r.id,
    role,
    cardType: r.ioType,
    deviceTag: r.deviceTag ?? "",
    rawIoTag: r.rawIoTag,
    description: r.description ?? "",
    cadFile: r.cadFile,
    min: range.min,
    max: range.max,
    unit,
    loopEvidence: r.loopTag ? (r.loopTagNote ?? "CAD loop-tag label") : (r.loopTagNote ?? "no loop tag"),
  };
}

function endpoint(members: LoopDevice[]): LoopEndpoint {
  const distinct = new Map<string, LoopDevice[]>();
  for (const d of members) {
    const k = `${d.cardType}\u0000${d.deviceTag}`;
    if (!distinct.has(k)) distinct.set(k, []);
    distinct.get(k)!.push(d);
  }
  const candidates = members.map((d) => d.ioRecordId);
  if (distinct.size === 0) {
    return { status: "UNRESOLVED", cardType: "UNRESOLVED", deviceTag: "UNRESOLVED", min: "", max: "", unit: "", candidates };
  }
  if (distinct.size > 1) {
    const tags = [...distinct.values()].map((g) => g[0].deviceTag || g[0].rawIoTag);
    return { status: "AMBIGUOUS", cardType: "AMBIGUOUS", deviceTag: tags.join(" | "), min: "", max: "", unit: "", candidates };
  }
  const group = [...distinct.values()][0];
  const d = group[0];
  const same = (f: (x: LoopDevice) => string) => group.every((x) => f(x) === f(d));
  return {
    status: "RESOLVED",
    cardType: d.cardType,
    deviceTag: d.deviceTag,
    min: same((x) => x.min.value) ? d.min.value : "",
    max: same((x) => x.max.value) ? d.max.value : "",
    unit: same((x) => x.unit.value) ? d.unit.value : "",
    ioRecordId: d.ioRecordId,
    candidates,
  };
}

const memberOrder = (a: LoopDevice, b: LoopDevice) =>
  a.role.localeCompare(b.role) ||
  a.deviceTag.localeCompare(b.deviceTag) ||
  a.rawIoTag.localeCompare(b.rawIoTag) ||
  a.ioRecordId.localeCompare(b.ioRecordId);

// ---------------------------------------------------------------- loops

/** "2071003C.CAD" → loop 2, PCU 07, module 10. */
function exeOf(devices: LoopDevice[], executive: BlockSpecs | undefined): LoopField {
  const stems = new Set(devices.map((d) => /^(\d)(\d{2})(\d{2})/.exec(d.cadFile ?? "")?.slice(1, 4).join("-") ?? ""));
  stems.delete("");
  const exec = executive ? `; executive block ${executive.block} (FC${EXECUTIVE_FC})` : "";
  if (stems.size === 1) {
    const exe = [...stems][0];
    const [l, p, m] = exe.split("-");
    return field(exe, "DERIVED", `CAD file stem ${l}${p}${m}: loop ${l}, PCU ${p}, module ${m}${exec}`);
  }
  if (stems.size > 1) return field("", "UNRESOLVED", `members come from different modules (${[...stems].join(", ")})`);
  return field("", "UNRESOLVED", "no member CAD file names a loop/PCU/module");
}

function descriptionOf(input: LoopEndpoint, devices: LoopDevice[]): LoopField {
  if (input.status === "UNRESOLVED") return field("", "UNRESOLVED", "no input device, so no Device Tag 1 description");
  const members = devices.filter((d) => input.candidates.includes(d.ioRecordId));
  const texts = new Set(members.map((d) => d.description));
  if (texts.size !== 1) {
    return field("", "UNRESOLVED", `Device Tag 1 is ambiguous and its candidates carry different descriptions`);
  }
  const text = [...texts][0];
  if (!text) return field("", "UNRESOLVED", `${members[0].deviceTag || members[0].rawIoTag} has no source description`);
  const note = input.status === "AMBIGUOUS" ? "; every Device Tag 1 candidate carries this same description" : "";
  return field(text, "EXTRACTED", `source description of ${members.map((d) => d.deviceTag || d.rawIoTag).join(" / ")}${note}`);
}

/**
 * Build the Loop List. The result depends only on the records' content, never
 * on their order in `project.ioRecords`.
 */
export function buildLoopList(project: CorrelatedProject, logic: CadLogicLike | null): LoopList {
  const idx = indexSpecs(logic);
  const sheets = new Map(project.cadSheets.map((s) => [s.filename.toUpperCase(), s]));
  const executives = [...idx.blocks.values()].filter((b) => b.functionCode === EXECUTIVE_FC);
  const executive = executives.length === 1 ? executives[0] : undefined;
  const pkg = project.meta.module || project.meta.name;

  const groups = new Map<string, IoRecord[]>();
  for (const r of project.ioRecords) {
    const key = r.loopTag ? `loop:${r.loopTag}` : `io:${r.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const loops: LoopRecord[] = [];
  for (const [key, records] of groups) {
    const loopTag = records[0].loopTag ?? "";
    const devices = records.map((r) => toDevice(idx, sheets, r)).sort(memberOrder);
    const input = endpoint(devices.filter((d) => d.role === "input"));
    const output = endpoint(devices.filter((d) => d.role === "output"));
    const notes: string[] = [];
    if (!loopTag) notes.push(records[0].loopTagNote ?? "no loop tag assigned in the CAD");
    for (const [side, e] of [["input", input], ["output", output]] as const) {
      if (e.status === "UNRESOLVED") notes.push(`no ${side} member in this loop`);
      if (e.status === "AMBIGUOUS") notes.push(`${e.candidates.length} ${side} members, none proven as the loop's ${side}: ${e.deviceTag}`);
      if (e.status === "RESOLVED" && e.candidates.length > 1) notes.push(`${e.candidates.length} source records share ${side} device ${e.deviceTag}`);
    }
    const blocks = new Map<string, LoopTagBlock>();
    for (const r of records) {
      const b = loopBlockOf(r);
      if (!b) continue;
      const k = `${b.sheet}:${b.blockNumber}`;
      const prev = blocks.get(k);
      if (!prev || VIA_RANK[b.via] < VIA_RANK[prev.via] || (b.via === prev.via && b.hops < prev.hops)) blocks.set(k, b);
    }
    const area = /^(\d{3})/.exec(loopTag)?.[1];
    loops.push({
      id: key,
      package: pkg ? field(pkg, "EXTRACTED", "session module name") : field("", "UNRESOLVED", "session has no module name"),
      processAreaId: area
        ? field(area, "DERIVED", `area digits of loop tag ${loopTag}`)
        : field("", "UNRESOLVED", "no loop tag to take the process area from"),
      exe: exeOf(devices, executive),
      controlRoom: field("", "UNRESOLVED", "control room is not recorded in the CAD package"),
      alarmGroup: field("", "UNRESOLVED", "alarm group is not recorded in the CAD package"),
      description: descriptionOf(input, devices),
      loopTag,
      loopTagBlock: blocks.size === 1 ? [...blocks.values()][0] : undefined,
      input,
      output,
      relatedDevices: devices,
      sourceRecords: devices.map((d) => d.ioRecordId),
      mappingStatus:
        input.status === "AMBIGUOUS" || output.status === "AMBIGUOUS"
          ? "AMBIGUOUS"
          : input.status === "RESOLVED" && output.status === "RESOLVED"
            ? "MAPPED"
            : "UNRESOLVED",
      notes,
    });
  }

  loops.sort(
    (a, b) =>
      Number(!a.loopTag) - Number(!b.loopTag) ||
      a.loopTag.localeCompare(b.loopTag) ||
      (a.relatedDevices[0]?.deviceTag ?? "").localeCompare(b.relatedDevices[0]?.deviceTag ?? "") ||
      a.id.localeCompare(b.id)
  );

  return {
    loops,
    stats: {
      loops: loops.length,
      sourceRecords: loops.reduce((n, l) => n + l.sourceRecords.length, 0),
      mapped: loops.filter((l) => l.mappingStatus === "MAPPED").length,
      unresolved: loops.filter((l) => l.mappingStatus === "UNRESOLVED").length,
      ambiguous: loops.filter((l) => l.mappingStatus === "AMBIGUOUS").length,
      withoutLoopTag: loops.filter((l) => !l.loopTag).length,
    },
  };
}