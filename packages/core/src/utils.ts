import type { IoType, ParsedIoTag } from "./types";

const IO_PATTERN =
  /^(AI|AO|DI|DO)(\d+)?(?:-([A-Za-z0-9]+))?(?:\/(.+))?$/i;

/** Parse Bailey I/O strings like DO5-40B/282MCR-M360 or DI1-1A/322AUX-M107A */
export function parseIoTag(raw: string): ParsedIoTag {
  const trimmed = raw.trim();
  const match = trimmed.match(IO_PATTERN);
  if (!match) {
    return { raw: trimmed };
  }
  const ioType = match[1].toUpperCase() as IoType;
  return {
    raw: trimmed,
    ioType,
    channel: match[2],
    slave: match[3],
    deviceTag: match[4]?.trim() || undefined,
  };
}

export function isPhysicalIo(raw: string): boolean {
  return /^(AI|AO|DI|DO)\d/i.test(raw.trim());
}

export function classifyExtension(ext: string): import("./types.js").FileKind {
  const e = ext.replace(/^\./, "").toUpperCase();
  const map: Record<string, import("./types.js").FileKind> = {
    CAD: "CAD",
    M1: "M1",
    OUT: "OUT",
    REF: "REF",
    XRF: "XRF",
    ERR: "ERR",
    CFG: "CFG",
    VFY: "VFY",
    LST: "LST",
    LOG: "LOG",
    MHD: "MHD",
    MDC: "MDC",
    BND: "BND",
    GES: "GES",
    BAT: "BAT",
  };
  return map[e] ?? "OTHER";
}

/** Extract Loop / CPU / Module from paths like L2/P12/M5/file.CAD or D:\PROJECT\L3\P7\M5\... */
export function parseProvenanceFromPath(pathStr: string): {
  loop?: string;
  cpu?: string;
  module?: string;
} {
  const normalized = pathStr.replace(/\\/g, "/");
  const loop = normalized.match(/(?:^|\/)(L\d+)(?:\/|$)/i)?.[1]?.toUpperCase();
  const cpu = normalized.match(/(?:^|\/)(P\d+)(?:\/|$)/i)?.[1]?.toUpperCase();
  const module = normalized.match(/(?:^|\/)(M\d+)(?:\/|$)/i)?.[1]?.toUpperCase();
  return { loop, cpu, module };
}

export function cadBasename(pathOrName: string): string {
  const base = pathOrName.replace(/\\/g, "/").split("/").pop() ?? pathOrName;
  return base.replace(/\.CAD$/i, "").toUpperCase();
}

export function newId(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}
