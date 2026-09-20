import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import type { CorrelatedProject } from "@infi90/core";

export async function exportIoListExcel(
  project: CorrelatedProject,
  outPath: string
): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ABB Bailey INFI 90 Migration Studio";
  const ws = wb.addWorksheet("IO List");
  ws.columns = [
    { header: "I/O Type", key: "ioType", width: 10 },
    { header: "Channel", key: "channel", width: 10 },
    { header: "Slave", key: "slave", width: 10 },
    { header: "Device Tag", key: "deviceTag", width: 22 },
    { header: "Raw I/O Tag", key: "rawIoTag", width: 28 },
    { header: "Loop Tag", key: "loopTag", width: 18 },
    { header: "Description", key: "description", width: 32 },
    { header: "CAD File", key: "cadFile", width: 16 },
    { header: "Direction", key: "direction", width: 10 },
    { header: "Source Point", key: "sourcePoint", width: 14 },
    { header: "Dest Points", key: "destPoints", width: 24 },
    { header: "Dest CADs", key: "destCads", width: 20 },
    { header: "Related Logic", key: "relatedLogic", width: 24 },
    { header: "S1", key: "s1", width: 16 },
    { header: "S2", key: "s2", width: 16 },
    { header: "Loop", key: "loop", width: 8 },
    { header: "CPU", key: "cpu", width: 8 },
    { header: "Module", key: "module", width: 10 },
    { header: "Mapping Status", key: "mappingStatus", width: 14 },
  ];
  styleHeader(ws);

  for (const r of project.ioRecords) {
    ws.addRow({
      ioType: r.ioType,
      channel: r.channel,
      slave: r.slave,
      deviceTag: r.deviceTag,
      rawIoTag: r.rawIoTag,
      loopTag: r.loopTag,
      description: r.description,
      cadFile: r.cadFile,
      direction: r.direction,
      sourcePoint: r.sourcePoint,
      destPoints: r.destinationPoints.join(" "),
      destCads: r.destinationCads.join(" "),
      relatedLogic: r.relatedLogic,
      s1: r.s1,
      s2: r.s2,
      loop: project.meta.loop,
      cpu: project.meta.cpu,
      module: project.meta.module,
      mappingStatus: r.mappingStatus,
    });
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await wb.xlsx.writeFile(outPath);
  return outPath;
}

export async function exportLogicExcel(
  project: CorrelatedProject,
  outPath: string
): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ABB Bailey INFI 90 Migration Studio";
  const ws = wb.addWorksheet("Logic Specification");
  ws.columns = [
    { header: "CAD File", key: "cadFile", width: 16 },
    { header: "Loop Tag", key: "loopTag", width: 16 },
    { header: "Description", key: "description", width: 28 },
    { header: "Block ID", key: "blockId", width: 14 },
    { header: "Function Code", key: "functionCode", width: 14 },
    { header: "FC No.", key: "functionCodeNumber", width: 9 },
    { header: "S0", key: "s0", width: 12 },
    { header: "S0.5", key: "s0_5", width: 12 },
    { header: "S1", key: "s1", width: 14 },
    { header: "S2", key: "s2", width: 14 },
    { header: "S3", key: "s3", width: 12 },
    { header: "S4", key: "s4", width: 12 },
    { header: "S5", key: "s5", width: 12 },
    { header: "S6", key: "s6", width: 12 },
    { header: "S7", key: "s7", width: 12 },
    { header: "S8", key: "s8", width: 12 },
    { header: "S9", key: "s9", width: 12 },
    { header: "Logic / Formula", key: "logicFormula", width: 24 },
    { header: "Input Refs", key: "inputRefs", width: 28 },
    { header: "Output Refs", key: "outputRefs", width: 28 },
    { header: "Device Tag", key: "deviceTag", width: 18 },
    { header: "Notes", key: "notes", width: 28 },
  ];
  styleHeader(ws);

  for (const r of project.logicRecords) {
    ws.addRow({
      ...r,
      inputRefs: r.inputRefs.join("; "),
      outputRefs: r.outputRefs.join("; "),
    });
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await wb.xlsx.writeFile(outPath);
  return outPath;
}

function styleHeader(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F2A24" },
  };
}
