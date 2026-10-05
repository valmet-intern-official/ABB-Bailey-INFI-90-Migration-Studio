import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loopListCells, loopListRows, type CorrelatedProject, type IoRecord } from "@infi90/core";
import { addDecimalText, buildLoopList, type CadLogicLike } from "./loop-list";

let seq = 0;
function io(p: Partial<IoRecord> & Pick<IoRecord, "ioType" | "rawIoTag">): IoRecord {
  return { id: `io${++seq}`, destinationPoints: [], destinationCads: [], mappingStatus: "mapped", ...p };
}

function project(ioRecords: IoRecord[]): CorrelatedProject {
  return {
    meta: { id: "p", name: "M10", module: "M10", createdAt: "", sourceZipName: "m10.zip", status: "ready" },
    ioRecords,
    cadSheets: [],
  } as unknown as CorrelatedProject;
}

const ft = io({ ioType: "AI", rawIoTag: "AI7-3/131FT0163", deviceTag: "131FT0163", channel: "7", slave: "3", loopTag: "131FC-163", description: "FLOW INPUT", cadFile: "2071003C.CAD" });
const fv = io({ ioType: "AO", rawIoTag: "AO2-15/131FV163", deviceTag: "131FV163", channel: "2", slave: "15", loopTag: "131FC-163", description: "VALVE OUTPUT", cadFile: "2071015C.CAD" });
const lt = io({ ioType: "AI", rawIoTag: "AI1-3/131LT103", deviceTag: "131LT103", channel: "1", slave: "3", loopTag: "131LI-103", description: "TANK LEVEL", cadFile: "2071003C.CAD" });
const zso = io({ ioType: "DI", rawIoTag: "DI2-5B/131ZSO153", deviceTag: "131ZSO153", loopTag: "131HS-153", description: "SHUTOFF", cadFile: "2071005C.CAD" });
const zsc = io({ ioType: "DI", rawIoTag: "DI3-5B/131ZSC153", deviceTag: "131ZSC153", loopTag: "131HS-153", description: "SHUTOFF", cadFile: "2071005C.CAD" });
const hv = io({ ioType: "DO", rawIoTag: "DO1-12/131HV153", deviceTag: "131HV153", loopTag: "131HS-153", description: "SHUTOFF", cadFile: "2071012C.CAD" });
const orphan = io({ ioType: "DI", rawIoTag: "DI7-5B/131XS107alrm", deviceTag: "131XS107alrm", loopTagNote: "no loop-tag label found in the CAD for 131XS107alrm", cadFile: "2071005C.CAD" });
const all = [ft, fv, lt, zso, zsc, hv, orphan];

const spec = (n: number, value: string) => ({ label: `S${n}`, value, status: "EXTRACTED" });
const logic: CadLogicLike = {
  "2071003C.CAD": [
    { block: 4050, functionCode: 132, specs: [spec(1, "3"), spec(5, "0"), spec(6, "100")] },
    { block: 4056, functionCode: 132, specs: [spec(1, "3"), spec(8, "0.50"), spec(9, "99.50")] },
  ],
  "2071015C.CAD": [{ block: 4260, functionCode: 149, specs: [spec(1, "15"), spec(20, "0"), spec(21, "105")] }],
};

describe("addDecimalText", () => {
  it("adds exactly, without float rounding", () => {
    assert.equal(addDecimalText("0", "100"), "100");
    assert.equal(addDecimalText("5", "45"), "50");
    assert.equal(addDecimalText("0.1", "0.2"), "0.3");
    assert.equal(addDecimalText("0.50", "99.50"), "100.00");
    assert.equal(addDecimalText("-2700", "5400"), "2700");
    assert.equal(addDecimalText("1.5E+03", "0"), "1500");
    assert.equal(addDecimalText("abc", "1"), null);
  });
});

describe("buildLoopList", () => {
  const list = buildLoopList(project(all), logic);
  const loop = (tag: string) => list.loops.find((l) => l.loopTag === tag)!;

  it("pairs by loop tag, independent of record order", () => {
    const shuffled = buildLoopList(project([orphan, hv, lt, fv, zsc, ft, zso]), logic);
    assert.deepEqual(shuffled, list);
    const fc = loop("131FC-163");
    assert.equal(fc.mappingStatus, "MAPPED");
    assert.equal(fc.input.deviceTag, "131FT0163");
    assert.equal(fc.output.deviceTag, "131FV163");
  });

  it("never loses a source record", () => {
    assert.equal(list.stats.sourceRecords, all.length);
    const ids = new Set(list.loops.flatMap((l) => l.sourceRecords));
    for (const r of all) assert.ok(ids.has(r.id), r.rawIoTag);
  });

  it("marks a missing output UNRESOLVED instead of borrowing another loop's", () => {
    const li = loop("131LI-103");
    assert.equal(li.mappingStatus, "UNRESOLVED");
    assert.equal(li.output.cardType, "UNRESOLVED");
    assert.equal(li.output.deviceTag, "UNRESOLVED");
  });

  it("keeps every candidate when the input is ambiguous", () => {
    const hs = loop("131HS-153");
    assert.equal(hs.mappingStatus, "AMBIGUOUS");
    assert.equal(hs.input.cardType, "AMBIGUOUS");
    assert.deepEqual(new Set(hs.input.candidates), new Set([zso.id, zsc.id]));
    assert.equal(hs.output.deviceTag, "131HV153");
    assert.equal(hs.relatedDevices.length, 3);
  });

  it("leaves a record without a loop tag out of the rows", () => {
    const l = list.loops.find((x) => x.sourceRecords.includes(orphan.id))!;
    assert.equal(l.loopTag, "");
    assert.deepEqual(loopListRows(l), []);
  });

  it("writes one row with NAME40_1 from Device Tag 1 and blank metadata/ranges", () => {
    const rows = loopListRows(loop("131FC-163")).map(loopListCells);
    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.deepEqual(row.slice(0, 5), ["", "", "", "", ""]);
    assert.equal(row[5], "FLOW INPUT");
    assert.deepEqual(row.slice(6, 9), ["131FC-163", "AI", "131FT0163"]);
    assert.deepEqual(row.slice(12, 14), ["AO", "131FV163"]);
    assert.deepEqual([row[9], row[10], row[11], row[14], row[15], row[16]], ["", "", "", "", "", ""]);
  });

  it("leaves a missing side blank", () => {
    const [row] = loopListRows(loop("131LI-103")).map(loopListCells);
    assert.deepEqual(row.slice(12, 14), ["", ""]);
  });

  it("puts each of several input devices on its own row", () => {
    const rows = loopListRows(loop("131HS-153")).map(loopListCells);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r[8]).sort(), ["131ZSC153", "131ZSO153"]);
    for (const r of rows) assert.equal(r[13], "131HV153");
  });

  it("reads ranges from the slave channel specs verbatim", () => {
    const fc = loop("131FC-163");
    // AI channel 7 on module address 3 → second FC132, input 2 (S8/S9).
    assert.equal(fc.input.min, "0.50");
    assert.equal(fc.input.max, "100.00");
    // AO channel 2 on module address 15 → first FC149, output N+1 (S20/S21).
    assert.equal(fc.output.min, "0");
    assert.equal(fc.output.max, "105");
    assert.equal(loop("131LI-103").input.max, "100");
    const hs = loop("131HS-153");
    assert.equal(hs.relatedDevices[0].min.status, "NOT_APPLICABLE");
  });

  it("leaves ranges unresolved without decoded specifications", () => {
    const bare = buildLoopList(project(all), null);
    const fc = bare.loops.find((l) => l.loopTag === "131FC-163")!;
    assert.equal(fc.input.min, "");
    assert.equal(fc.relatedDevices[0].min.status, "UNRESOLVED");
  });
});
