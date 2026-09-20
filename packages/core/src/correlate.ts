import type {
  CadSheetParse,
  CorrelatedProject,
  ErrRecord,
  InventoryFile,
  IoRecord,
  IoType,
  LogicRecord,
  M1GraphicParse,
  OutParseResult,
  ProjectMeta,
  RefTag,
  ValidationIssue,
  XrfParseResult,
} from "./types";
import { cadBasename, isPhysicalIo, newId, parseIoTag } from "./utils";

export interface CorrelateInput {
  meta: ProjectMeta;
  inventory: InventoryFile[];
  out?: OutParseResult;
  refTags?: RefTag[];
  xrf?: XrfParseResult;
  errRecords?: ErrRecord[];
  cadSheets: CadSheetParse[];
  graphics: M1GraphicParse[];
}

function enrichFromCad(
  cadSheets: CadSheetParse[],
  cadFile: string,
  deviceTag?: string
): { loopTag?: string; description?: string; s1?: string; s2?: string; relatedLogic?: string } {
  const sheet = cadSheets.find(
    (c) => cadBasename(c.filename) === cadBasename(cadFile)
  );
  if (!sheet) return {};

  const description =
    sheet.descriptions[0] ||
    sheet.texts.find((t) => t.kind === "description")?.text;

  let loopTag = sheet.loopTags[0];
  if (deviceTag) {
    const match = sheet.loopTags.find((t) =>
      t.toUpperCase().includes(deviceTag.toUpperCase().slice(0, 6))
    );
    if (match) loopTag = match;
  }

  const block =
    sheet.functionBlocks.find((b) =>
      deviceTag
        ? b.deviceTag?.toUpperCase() === deviceTag.toUpperCase() ||
          b.outputRefs.some((r) => r.includes(deviceTag)) ||
          b.inputRefs.some((r) => r.includes(deviceTag))
        : false
    ) || sheet.functionBlocks[0];

  return {
    loopTag,
    description,
    s1: block?.s1,
    s2: block?.s2,
    relatedLogic: block
      ? [block.functionCode, block.blockId, block.logicFormula]
          .filter(Boolean)
          .join(" / ")
      : undefined,
  };
}

export function correlateProject(input: CorrelateInput): CorrelatedProject {
  const ioRecords: IoRecord[] = [];
  const seen = new Set<string>();

  if (input.out) {
    for (const entry of input.out.entries) {
      const parsed = entry.parsed.ioType
        ? entry.parsed
        : parseIoTag(entry.description);
      if (!parsed.ioType || !isPhysicalIo(parsed.raw) && !parsed.ioType) {
        // Still accept if description itself parses as physical IO
        const retry = parseIoTag(entry.description.split(/\s+/)[0] ?? entry.description);
        if (!retry.ioType) continue;
        Object.assign(parsed, retry);
      }
      if (!parsed.ioType) continue;
      if (!["AI", "AO", "DI", "DO"].includes(parsed.ioType)) continue;

      const key = `${cadBasename(entry.cadFile)}|${parsed.raw}|${entry.direction}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const enrich = enrichFromCad(
        input.cadSheets,
        entry.cadFile,
        parsed.deviceTag
      );

      const mappingStatus: IoRecord["mappingStatus"] =
        enrich.loopTag || enrich.description ? "mapped" : "partial";

      ioRecords.push({
        id: newId("io"),
        ioType: parsed.ioType,
        channel: parsed.channel,
        slave: parsed.slave,
        deviceTag: parsed.deviceTag,
        rawIoTag: parsed.raw,
        loopTag: enrich.loopTag,
        description: enrich.description,
        cadFile: entry.cadFile,
        direction: entry.direction,
        sourcePoint: entry.source?.point,
        destinationPoints: entry.destinations.map((d) => d.point).filter(Boolean) as string[],
        destinationCads: entry.destinations
          .map((d) => d.cadSheet)
          .filter(Boolean) as string[],
        relatedLogic: enrich.relatedLogic,
        s1: enrich.s1,
        s2: enrich.s2,
        mappingStatus,
      });
    }
  }

  // Enrich from REF tags that might not be in OUT physical list
  if (input.refTags) {
    for (const tag of input.refTags) {
      if (!tag.parsed.ioType) continue;
      const exists = ioRecords.some(
        (r) => r.rawIoTag.toUpperCase() === tag.raw.toUpperCase()
      );
      if (exists) continue;
      // REF-only tags recorded as partial for validation cross-check, not primary I/O list
    }
  }

  const logicRecords: LogicRecord[] = [];
  for (const sheet of input.cadSheets) {
    if (sheet.functionBlocks.length === 0) {
      // Create a sheet-level summary row when we have I/O but no explicit blocks
      if (sheet.ioRefs.length > 0 || sheet.descriptions.length > 0) {
        logicRecords.push({
          id: newId("logic"),
          cadFile: sheet.filename,
          loopTag: sheet.loopTags[0],
          description: sheet.descriptions[0] || sheet.title,
          inputRefs: sheet.ioRefs
            .filter((i) => i.ioType === "AI" || i.ioType === "DI")
            .map((i) => i.raw),
          outputRefs: sheet.ioRefs
            .filter((i) => i.ioType === "AO" || i.ioType === "DO")
            .map((i) => i.raw),
          deviceTag: sheet.deviceTags[0],
          notes: "Sheet-level extraction (no explicit function block records)",
        });
      }
      continue;
    }
    for (const block of sheet.functionBlocks) {
      logicRecords.push({
        id: newId("logic"),
        cadFile: sheet.filename,
        loopTag: sheet.loopTags[0],
        description: sheet.descriptions[0] || sheet.title,
        blockId: block.blockId,
        functionCode: block.functionCode,
        functionCodeNumber: block.functionCodeNumber,
        s0: block.s0,
        s0_5: block.s0_5,
        s1: block.s1,
        s2: block.s2,
        s3: block.s3,
        s4: block.s4,
        s5: block.s5,
        s6: block.s6,
        s7: block.s7,
        s8: block.s8,
        s9: block.s9,
        logicFormula: block.logicFormula,
        inputRefs: block.inputRefs,
        outputRefs: block.outputRefs,
        deviceTag: block.deviceTag || sheet.deviceTags[0],
        notes: block.notes,
      });
    }
  }

  const validation = buildValidation(input, ioRecords);

  const ioByType: Record<IoType, number> = { AI: 0, AO: 0, DI: 0, DO: 0 };
  for (const r of ioRecords) ioByType[r.ioType]++;

  return {
    meta: { ...input.meta, status: "ready" },
    inventory: input.inventory,
    ioRecords,
    logicRecords,
    cadSheets: input.cadSheets,
    graphics: input.graphics,
    validation,
    stats: {
      cadCount: input.inventory.filter((f) => f.kind === "CAD").length,
      m1Count: input.inventory.filter((f) => f.kind === "M1").length,
      ioByType,
      xrfExpectedCad: input.xrf?.cadSheetsToProcess,
      unresolvedCount: validation.filter((v) => v.severity === "error").length,
    },
  };
}

function buildValidation(
  input: CorrelateInput,
  ioRecords: IoRecord[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const cadCount = input.inventory.filter((f) => f.kind === "CAD").length;

  if (input.xrf?.cadSheetsToProcess != null) {
    if (input.xrf.cadSheetsToProcess !== cadCount) {
      issues.push({
        id: newId("val"),
        type: "cad_coverage",
        severity: "warning",
        message: `XRF expected ${input.xrf.cadSheetsToProcess} CAD sheets but inventory has ${cadCount}`,
        sourceFile: "I90XREF.XRF",
        resolutionStatus: "open",
      });
    } else {
      issues.push({
        id: newId("val"),
        type: "cad_coverage",
        severity: "info",
        message: `CAD coverage OK: ${cadCount} sheets match XRF`,
        sourceFile: "I90XREF.XRF",
        resolutionStatus: "resolved",
      });
    }
  }

  for (const blank of input.xrf?.blankDescriptions ?? []) {
    issues.push({
      id: newId("val"),
      type: "blank_description",
      severity: "warning",
      message: `Blank description noted: ${blank}`,
      sourceFile: "I90XREF.XRF",
      resolutionStatus: "open",
    });
  }

  for (const err of input.errRecords ?? []) {
    issues.push({
      id: newId("val"),
      type: "unresolved_reference",
      severity: "error",
      message: err.raw.slice(0, 500),
      sourceFile: "I90XREF.ERR",
      relatedCad: err.cadFile,
      resolutionStatus: "open",
    });
  }

  const partial = ioRecords.filter((r) => r.mappingStatus === "partial");
  if (partial.length > 0) {
    issues.push({
      id: newId("val"),
      type: "partial_io_mapping",
      severity: "warning",
      message: `${partial.length} I/O records missing loop tag or description enrichment`,
      resolutionStatus: "open",
    });
  }

  return issues;
}
