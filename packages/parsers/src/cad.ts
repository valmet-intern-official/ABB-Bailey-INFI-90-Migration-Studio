import {
  isPhysicalIo,
  parseIoTag,
  type CadDrawEntity,
  type CadFunctionBlock,
  type CadOref,
  type CadSheetParse,
  type CadTextItem,
} from "@infi90/core";
import {
  KNOWN_FUNCTION_CODES,
  buildEngineeringModel,
  decodeCadSheet,
  engineeringModelToDrawEntities,
} from "@infi90/cad-engine";

const FUNCTION_CODES = [...KNOWN_FUNCTION_CODES];

function extractStrings(buf: Buffer, minLen = 3): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b >= 32 && b <= 126) cur += String.fromCharCode(b);
    else {
      if (cur.length >= minLen) out.push(cur.trimEnd());
      cur = "";
    }
  }
  if (cur.length >= minLen) out.push(cur.trimEnd());
  return out;
}

function parseOrefBlob(s: string): CadOref | null {
  // Patterns like: OREF ... DI7-1A/322AUX-M122CBA58-04.07
  // or D322ST-M205BAO2-02.07
  const cleaned = s.replace(/^OREF\s*/i, "").trim();
  if (!cleaned) return null;

  const ioMatch = cleaned.match(
    /((?:AI|AO|DI|DO)\d[^/\s]*\/[A-Za-z0-9\-_]+)/i
  );
  const pointMatch = cleaned.match(/([A-Z]{2}\d{2}-\d{2}\.\d{2})/);
  const deviceOnly = cleaned.match(/\b(D?\d{2,}[A-Z][A-Z0-9\-_\/]*)/i);

  // Target CAD sometimes glued: ...30705L6A
  const targetCad = cleaned.match(/\b(\d{5}[A-Z0-9]{2,})\b/)?.[1];

  return {
    raw: cleaned,
    tag: ioMatch?.[1] || deviceOnly?.[1],
    point: pointMatch?.[1],
    targetCad,
  };
}

function detectFunctionBlocks(strings: string[]): CadFunctionBlock[] {
  const blocks: CadFunctionBlock[] = [];
  const joined = strings.join("\n");

  for (const fc of FUNCTION_CODES) {
    const re = new RegExp(`\\b${fc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (!re.test(joined)) continue;

    // Collect nearby S-specifications from strings
    const specs: Record<string, string> = {};
    for (const s of strings) {
      const sm = s.match(/\bS([0-9])(?:\.5)?\s*[:=]?\s*(.+)$/i);
      if (sm) {
        const key = s.includes("0.5") ? "s0_5" : `s${sm[1]}`;
        specs[key] = sm[2].trim();
      }
      // Compact forms like S1xxx without separator - keep whole token groups
      const compact = s.match(/\b(S[0-9])([A-Za-z0-9\.\-\+\/\*]+)/);
      if (compact && !specs[compact[1].toLowerCase()]) {
        specs[compact[1].toLowerCase()] = compact[2];
      }
    }

    const ioNear = strings.filter((s) => isPhysicalIo(s) || /\/\d{2,}/.test(s));
    blocks.push({
      functionCode: fc,
      blockId: `${fc}_${blocks.length + 1}`,
      s0: specs.s0,
      s0_5: specs.s0_5,
      s1: specs.s1,
      s2: specs.s2,
      s3: specs.s3,
      s4: specs.s4,
      s5: specs.s5,
      s6: specs.s6,
      s7: specs.s7,
      s8: specs.s8,
      s9: specs.s9,
      logicFormula: [specs.s1, specs.s2].filter(Boolean).join(" ; ") || undefined,
      inputRefs: ioNear.filter((s) => /^(AI|DI)/i.test(s)).slice(0, 20),
      outputRefs: ioNear.filter((s) => /^(AO|DO)/i.test(s)).slice(0, 20),
      notes: `Detected function code ${fc} in CAD sheet`,
    });
  }

  // RDI / slave group style blocks
  const rdi = strings.filter((s) => /^RDI\d/i.test(s));
  for (const r of rdi.slice(0, 16)) {
    blocks.push({
      functionCode: "RDI",
      blockId: r.trim(),
      inputRefs: [],
      outputRefs: [],
      notes: "Remote digital input block reference",
    });
  }

  return blocks;
}

function buildDrawEntities(
  strings: string[],
  oreffs: CadOref[],
  ioRefs: ReturnType<typeof parseIoTag>[]
): CadDrawEntity[] {
  const entities: CadDrawEntity[] = [];
  // Simple layout grid for reconstruction
  let y = 40;
  const leftX = 40;
  const midX = 280;
  const rightX = 520;

  entities.push({
    type: "text",
    x: leftX,
    y: 18,
    text: strings.find((s) => /^\d{5}/.test(s)) || "CAD SHEET",
    label: "title",
  });

  for (const io of ioRefs.slice(0, 40)) {
    entities.push({
      type: "box",
      x: leftX,
      y,
      w: 200,
      h: 28,
      text: io.raw,
      label: io.ioType,
    });
    entities.push({
      type: "line",
      x: leftX + 200,
      y: y + 14,
      x2: midX,
      y2: y + 14,
    });
    y += 36;
  }

  y = 40;
  for (const o of oreffs.slice(0, 40)) {
    entities.push({
      type: "oref",
      x: midX,
      y,
      w: 220,
      h: 28,
      text: o.tag || o.raw.slice(0, 40),
      label: o.point,
    });
    entities.push({
      type: "line",
      x: midX + 220,
      y: y + 14,
      x2: rightX,
      y2: y + 14,
    });
    if (o.targetCad) {
      entities.push({
        type: "text",
        x: rightX,
        y: y + 10,
        text: o.targetCad,
      });
    }
    y += 36;
  }

  // Description texts at bottom
  let dy = Math.max(y, 400) + 20;
  for (const s of strings.filter((t) => t.length > 8 && !isPhysicalIo(t)).slice(0, 12)) {
    if (/OREF|DIGRP|lib/i.test(s)) continue;
    entities.push({ type: "text", x: leftX, y: dy, text: s.slice(0, 80) });
    dy += 16;
  }

  return entities;
}

export function parseCadFile(
  buf: Buffer,
  filename: string
): CadSheetParse {
  const rawStrings = extractStrings(buf, 3);
  const texts: CadTextItem[] = [];
  const ioRefs = [];
  const deviceTags: string[] = [];
  const loopTags: string[] = [];
  const descriptions: string[] = [];
  const oreffs: CadOref[] = [];

  let captureOref = false;
  for (let i = 0; i < rawStrings.length; i++) {
    const s = rawStrings[i];

    if (/^OREF/i.test(s)) {
      captureOref = true;
      const combined = [s, rawStrings[i + 1] ?? ""].join(" ");
      const o = parseOrefBlob(combined);
      if (o) oreffs.push(o);
      continue;
    }
    if (captureOref && /^\s*(AI|AO|DI|DO|D\d)/i.test(s)) {
      const o = parseOrefBlob(s);
      if (o) oreffs.push(o);
      continue;
    }
    captureOref = false;

    if (isPhysicalIo(s) || /^(AI|AO|DI|DO)\d/i.test(s)) {
      const parsed = parseIoTag(s.split(/\s+/)[0]);
      if (parsed.ioType) {
        ioRefs.push(parsed);
        texts.push({ text: s, kind: "io" });
        if (parsed.deviceTag) deviceTags.push(parsed.deviceTag);
      }
      continue;
    }

    // Glued IO+point forms inside longer strings
    const embedded = s.match(
      /((?:AI|AO|DI|DO)\d[\w\-]*\/[A-Za-z0-9\-_]+)/gi
    );
    if (embedded) {
      for (const e of embedded) {
        const parsed = parseIoTag(e);
        if (parsed.ioType) ioRefs.push(parsed);
      }
    }

    if (
      /DIGITAL INPUT|ANALOG|SLAVE|WOODYARD|MILL|EXPANSION|INPUT|OUTPUT|STATUS/i.test(
        s
      ) &&
      s.length > 5
    ) {
      descriptions.push(s.trim());
      texts.push({ text: s, kind: "description" });
      continue;
    }

    if (/^\d{2,}-\d/.test(s) || /^322-/.test(s)) {
      loopTags.push(s.trim());
      texts.push({ text: s, kind: "label" });
      continue;
    }

    if (/^(PID|ETIMER|DSUM|SEQ|REMSET|DIGRP|TD-DIG)/i.test(s)) {
      texts.push({ text: s, kind: "block" });
      continue;
    }

    if (/\bS[0-9]\b/i.test(s)) {
      texts.push({ text: s, kind: "spec" });
      continue;
    }

    texts.push({ text: s, kind: "other" });
  }

  // Also pull OREF tags from oreffs into ioRefs
  for (const o of oreffs) {
    if (o.tag && isPhysicalIo(o.tag)) {
      ioRefs.push(parseIoTag(o.tag));
      if (parseIoTag(o.tag).deviceTag) {
        deviceTags.push(parseIoTag(o.tag).deviceTag!);
      }
    }
  }

  const functionBlocks = detectFunctionBlocks(rawStrings);
  const sheetId =
    rawStrings.find((s) => /^\d{5}[A-Z0-9]*$/i.test(s.trim())) ||
    filename.replace(/\.CAD$/i, "");
  const title =
    descriptions[0] ||
    rawStrings.find((s) => /SLAVE|INPUT|OUTPUT|MILL|STATUS/i.test(s));
  const date = rawStrings.find((s) =>
    /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(s)
  );

  const uniqIo = new Map(ioRefs.map((i) => [i.raw.toUpperCase(), i]));
  const sheet: CadSheetParse = {
    filename,
    sheetId,
    title,
    date,
    descriptions: [...new Set(descriptions)],
    loopTags: [...new Set(loopTags)],
    deviceTags: [...new Set(deviceTags)],
    ioRefs: [...uniqIo.values()],
    oreffs,
    texts,
    functionBlocks,
    drawEntities: [],
    rawStrings,
  };

  // Native SCAD 5.3 record decoding is the source of truth: it yields real
  // geometry and real wire topology. The legacy string-scrape model is kept
  // only as a fallback for buffers the decoder cannot read.
  let engineeringModel = decodeCadSheet(buf, filename);
  if (engineeringModel.blocks.length === 0) {
    engineeringModel = buildEngineeringModel(sheet);
  }

  // Carry decoded facts back onto the sheet record so the I/O list, exporters
  // and search index benefit from native extraction too.
  if (engineeringModel.blocks.length > 0) {
    // Junctions are wire hardware and do not belong in the block list.
    const placed = engineeringModel.blocks.filter(
      (b) => b.type !== "Junction" && b.functionCode
    );
    // Prefer the Bailey block address as the identifier; fall back to a
    // per-function-code ordinal only when the source carries no address.
    const seen = new Map<string, number>();
    const decodedBlocks: CadFunctionBlock[] = [];
    for (const block of placed) {
      const fc = block.functionCode!;
      const n = (seen.get(fc) ?? 0) + 1;
      seen.set(fc, n);
      const ordinal = `${fc}_${n}`;
      block.blockNumber = block.blockNumber ?? ordinal;

      // Specifications decoded from the SPC LIST trailer are carried on the
      // block's parameters as S1..Sn; surface them on the flat record the
      // tables, search index and exporters read.
      const specs: Record<string, string> = {};
      for (const [key, value] of Object.entries(block.parameters)) {
        const m = key.match(/^S(\d{1,2})$/i);
        if (m) specs[`s${Number(m[1])}`] = value;
      }

      decodedBlocks.push({
        functionCode: fc,
        functionCodeNumber: block.functionCodeNumber,
        blockId: block.blockNumber,
        blockNumber: block.blockNumber,
        ...specs,
        // Function code plus address is the engineer's shorthand for a block.
        logicFormula:
          block.functionCodeNumber != null
            ? `FC${block.functionCodeNumber} ${fc}`
            : fc,
        inputRefs: block.inputRefs,
        outputRefs: block.outputRefs,
        deviceTag: block.deviceTags[0],
        notes: block.label ?? block.notes,
      });
    }
    // Replace, not merge: the scraped list guessed blocks that the record
    // stream shows are not on the sheet.
    sheet.functionBlocks = decodedBlocks;
    for (const tag of engineeringModel.tags) {
      const parsed = parseIoTag(tag.raw);
      if (parsed.ioType && !uniqIo.has(parsed.raw.toUpperCase())) {
        uniqIo.set(parsed.raw.toUpperCase(), parsed);
        if (parsed.deviceTag) sheet.deviceTags.push(parsed.deviceTag);
      }
    }
    sheet.ioRefs = [...uniqIo.values()];
    sheet.deviceTags = [...new Set(sheet.deviceTags)];
    if (engineeringModel.sheetId) sheet.sheetId = engineeringModel.sheetId;
    if (engineeringModel.title && !sheet.title) sheet.title = engineeringModel.title;
  }

  sheet.engineeringModel = engineeringModel;
  sheet.drawEntities =
    engineeringModel.blocks.length > 0
      ? engineeringModelToDrawEntities(engineeringModel)
      : buildDrawEntities(rawStrings, oreffs, [...uniqIo.values()]);

  return sheet;
}
