import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { LOOP_LIST_COLUMNS, loopListCells, loopListRows, type CorrelatedProject, type LoopList } from "@infi90/core";

/**
 * I/O Excel mirrors the workspace I/O List table exactly — same columns and
 * sort order, no extra correlation/metadata fields.
 *
 * UI columns: CAD | Type | Ch | Slave | Device | Loop tag | Description
 */
export async function exportIoListExcel(
  project: CorrelatedProject,
  outPath: string
): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ABB Bailey INFI 90 Migration Studio";
  const ws = wb.addWorksheet("IO List");
  ws.columns = [
    { header: "CAD", key: "cadFile", width: 16 },
    { header: "Type", key: "ioType", width: 10 },
    { header: "Ch", key: "channel", width: 8 },
    { header: "Slave", key: "slave", width: 10 },
    { header: "Device", key: "deviceTag", width: 22 },
    { header: "Loop tag", key: "loopTag", width: 18 },
    { header: "Description", key: "description", width: 40 },
  ];
  styleHeader(ws);

  // Same ordering as the workspace I/O List: CAD file, then raw I/O tag.
  const sorted = [...project.ioRecords].sort((a, b) => {
    const cadA = (a.cadFile || "—").toUpperCase();
    const cadB = (b.cadFile || "—").toUpperCase();
    if (cadA !== cadB) return cadA.localeCompare(cadB);
    return (a.rawIoTag || "").localeCompare(b.rawIoTag || "");
  });

  for (const r of sorted) {
    ws.addRow({
      cadFile: r.cadFile || "—",
      ioType: r.ioType,
      channel: r.channel ?? "",
      slave: r.slave ?? "",
      deviceTag: r.deviceTag ?? "",
      loopTag: r.loopTag ?? "",
      description: r.description || "—",
    });
  }

  // Merge consecutive CAD cells the same way the UI groups by sheet.
  mergeCadColumn(ws, sorted.length);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await wb.xlsx.writeFile(outPath);
  return outPath;
}

/**
 * Loop List Excel: the workspace Loop List in the template columns, one row
 * per device. Cells are written as text so Excel cannot reformat tags.
 */
export async function exportLoopListExcel(list: LoopList, outPath: string): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ABB Bailey INFI 90 Migration Studio";
  const ws = wb.addWorksheet("Loop List");
  ws.columns = LOOP_LIST_COLUMNS.map((header, i) => ({
    header,
    width: i === 5 ? 40 : header.includes("DEVICETAG") && !header.includes(":") ? 24 : 16,
    style: { numFmt: "@" },
  }));
  styleHeader(ws);
  for (const l of list.loops) for (const r of loopListRows(l)) ws.addRow(loopListCells(r));

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await wb.xlsx.writeFile(outPath);
  return outPath;
}

export type BlockSummaryRow = {
  functionCode: number | null;
  name: string;
  symbol: string | null;
  count: number;
  sheets: { file: string; blocks: number[] }[];
};

export type BlockSummary = { totalBlocks: number; sheetCount: number; rows: BlockSummaryRow[] };

/**
 * Block Summary Excel: the CAD viewer summary (one row per function code) and,
 * on a second sheet, where each function code is used.
 */
export async function exportBlockSummaryExcel(summary: BlockSummary, outPath: string): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ABB Bailey INFI 90 Migration Studio";

  const ws = wb.addWorksheet("Block Summary");
  ws.columns = [
    { header: "FC", key: "fc", width: 10 },
    { header: "Block name", key: "name", width: 40 },
    { header: "Symbol", key: "symbol", width: 14 },
    { header: "Blocks", key: "count", width: 10 },
    { header: "CAD files", key: "files", width: 12 },
  ];
  styleHeader(ws);
  for (const r of summary.rows) {
    ws.addRow({ fc: r.functionCode ?? "—", name: r.name, symbol: r.symbol ?? "—", count: r.count, files: r.sheets.length });
  }
  const total = ws.addRow({ fc: "Total", count: summary.totalBlocks, files: summary.sheetCount });
  total.font = { bold: true };

  const where = wb.addWorksheet("Block Locations");
  where.columns = [
    { header: "FC", key: "fc", width: 10 },
    { header: "Block name", key: "name", width: 40 },
    { header: "CAD file", key: "file", width: 16 },
    { header: "Count", key: "count", width: 10 },
    { header: "Block numbers", key: "blocks", width: 60 },
  ];
  styleHeader(where);
  for (const r of summary.rows) {
    for (const s of r.sheets) {
      where.addRow({ fc: r.functionCode ?? "—", name: r.name, file: s.file, count: s.blocks.length, blocks: s.blocks.join(", ") });
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await wb.xlsx.writeFile(outPath);
  return outPath;
}

/** Merge vertical runs of identical CAD values (column A, rows 2..n). */
function mergeCadColumn(ws: ExcelJS.Worksheet, rowCount: number) {
  if (rowCount < 2) return;
  let start = 2; // first data row
  for (let row = 3; row <= rowCount + 1; row++) {
    const prev = String(ws.getCell(start, 1).value ?? "");
    const current =
      row <= rowCount ? String(ws.getCell(row, 1).value ?? "") : null;
    if (current === prev) continue;
    if (row - 1 > start) {
      ws.mergeCells(start, 1, row - 1, 1);
      ws.getCell(start, 1).alignment = { vertical: "top", wrapText: true };
    }
    start = row;
  }
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
