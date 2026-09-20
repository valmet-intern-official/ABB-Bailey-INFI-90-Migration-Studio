import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseOutFile } from "./out";
import { parseCadFile } from "./cad";
import { parseIoTag } from "@infi90/core";

test("parseIoTag DO5-40B/282MCR-M360", () => {
  const p = parseIoTag("DO5-40B/282MCR-M360");
  assert.equal(p.ioType, "DO");
  assert.equal(p.channel, "5");
  assert.equal(p.slave, "40B");
  assert.equal(p.deviceTag, "282MCR-M360");
});

test("parse OUT sample excerpt", () => {
  const sample = `
D:\\PROJECT\\L3\\P7\\M5\\3070501A.CAD Outputs
------------------------------
     Description                Source               Destination(s)
DI1-1A/322AUX-M107A             BA01-05.14      BAL6-08.07 30705L6A  BA69-09.07 3070569A  

D:\\PROJECT\\L3\\P7\\M5\\3070501A.CAD Inputs
------------------------------
`;
  const result = parseOutFile(sample);
  assert.ok(result.entries.length >= 1);
  assert.equal(result.entries[0].parsed.ioType, "DI");
  assert.equal(result.entries[0].cadFile, "3070501A.CAD");
});

test("parse CAD fixture if present", () => {
  const cadPath = path.resolve(
    process.cwd(),
    "../../Input/M5/3070501A.CAD"
  );
  if (!fs.existsSync(cadPath)) {
    return;
  }
  const sheet = parseCadFile(fs.readFileSync(cadPath), "3070501A.CAD");
  assert.equal(sheet.filename, "3070501A.CAD");
  assert.ok(sheet.rawStrings.length > 10);
  assert.ok(sheet.drawEntities.length > 0);
});
