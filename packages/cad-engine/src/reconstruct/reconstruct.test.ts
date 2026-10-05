import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseLbrLibrary, SymbolRegistry } from "../lbr/library";
import { decodeRecordRange, decodeRecordStream } from "../records/decode";
import { buildDrawingSheet } from "./build";
import { expandSymbol } from "./libexpand";
import { writePdf } from "./pdf";
import { renderSheet, toSvg } from "./render";
import { learnPinTemplates } from "./templates";

// ------------------------------------------------------------ synthetic binaries
const words = (...ws: number[]) => {
  const b = Buffer.alloc(ws.length * 2);
  ws.forEach((w, i) => b.writeUInt16LE(w, i * 2));
  return b;
};
const name8 = (s: string) => Buffer.from(s.padEnd(8, " "), "latin1");
const polyline = (layer: number, style: number, pts: Array<[number, number]>) =>
  words(1, 4 + pts.length * 2, layer, style, ...pts.flat());
/** Type 6 symbol instance with a block number. */
const symbol6 = (name: string, box: [number, number, number, number], ins: [number, number], block: number) =>
  Buffer.concat([words(6, 16, 1, ...box), name8(name), words(ins[0], ins[1], 0, 1, block)]);
/** Type 11 junction instance. */
const junction = (x: number, y: number) =>
  Buffer.concat([words(11, 15, 1, x - 5, y - 6, x + 7, y + 5), name8("N90CNECT"), words(x, y, 0, 1)]);
const cadFile = (...records: Buffer[]) => Buffer.concat([Buffer.alloc(256), ...records]);

test("record range decoder walks the same grammar for sheets and library bodies", () => {
  const body = Buffer.concat([polyline(2, 0, [[10, 20], [30, 20]]), words(4, 9, 2, 100, 100, 100, 106, 99, 94)]);
  const { records, clean } = decodeRecordRange(body, 0, body.length);
  assert.equal(clean, true);
  assert.deepEqual(records.map((r) => r.kind), ["polyline", "primitive3"]);
  assert.deepEqual(records[0].points, [{ x: 10, y: 20 }, { x: 30, y: 20 }]);
});

test("LBR directory uses 1-based (block, word) addressing and bodies chain exactly", () => {
  const lib = Buffer.alloc(3 * 512);
  words(0, 0, 0, 0, 0, 0, 1, 1).copy(lib, 512);
  name8("TSYM").copy(lib, 528);
  const body = Buffer.concat([
    words(9, 6, 17, 8),
    words(100, 200, 140, 240),
    name8("TSYM"),
    words(100, 200, 1, 0, 0),
    polyline(2, 2, [[100, 200], [140, 240]]),
  ]);
  const lengthWords = body.length / 2;
  // Body at block 3, word 1 -> byte (3-1)*512 + 0 = 1024.
  words(3, 1, 6, lengthWords).copy(lib, 536);
  body.copy(lib, 1024);
  const parsed = parseLbrLibrary(lib, "TEST.LBR");
  const sym = parsed.symbols.get("TSYM")!;
  assert.equal(sym.offset, 1024);
  assert.equal(sym.clean, true);
  assert.equal(parsed.uncleanBodies.length, 0);
  assert.deepEqual([sym.insertionX, sym.insertionY], [100, 200]);

  const reg = new SymbolRegistry();
  reg.add(parsed);
  const { primitives } = expandSymbol(reg, "TSYM", 1000, 1000, 0);
  // Placement is a pure translation: definition insertion -> instance insertion.
  assert.deepEqual(primitives[0].kind === "polyline" && primitives[0].points, [{ x: 1000, y: 1000 }, { x: 1040, y: 1040 }]);
});

test("topology: wires attach EXPLICITly, crossings are not connections, dangling stays UNRESOLVED", () => {
  const buf = cadFile(
    symbol6("AND2", [1000, 1000, 1137, 1101], [1045, 1080], 10),
    symbol6("NOT", [1400, 1060, 1537, 1105], [1445, 1080], 11),
    polyline(1, 1, [[1125, 1080], [1405, 1080]]),
    polyline(1, 0, [[1300, 900], [1300, 1200]]),
    polyline(1, 0, [[1250, 1300], [1250, 1400], [1600, 1400]]),
    polyline(1, 0, [[1200, 1500], [1500, 1500]]),
    polyline(1, 0, [[1350, 1400], [1350, 1500]]),
    junction(1350, 1400)
  );
  const recs = decodeRecordStream(buf).records;
  const templates = learnPinTemplates([recs]);
  const sheet = buildDrawingSheet(buf, "T0000001.CAD", { registry: new SymbolRegistry(), templates, zoneGrid: null });
  const [w1, w2] = sheet.connections;
  assert.equal(w1.from.kind, "pin");
  assert.equal(w1.to.kind, "pin");
  assert.equal(w1.relationStatus, "EXPLICIT");
  assert.equal(w1.lineType, "dashed");
  assert.equal(w2.relationStatus, "UNRESOLVED", "a free-standing line is kept, never attached");
  const crossing = sheet.junctions.find((j) => j.kind === "crossing-no-connection");
  assert.ok(crossing, "w1 x w2 crossing must be recorded as NOT connected");
  assert.deepEqual(crossing!.at, { x: 1300, y: 1080 });
  assert.notEqual(sheet.connections[0].netId, sheet.connections[1].netId);
  const tee = sheet.connections[4];
  assert.equal(tee.from.kind, "junction", "vertex on an N90CNECT is an explicit junction");
  assert.equal(tee.to.kind, "wire", "vertex on another wire interior is a branch");
  assert.equal(sheet.junctions.filter((j) => j.kind === "branch").length, 1);
  const pins = sheet.pins.filter((p) => p.blockId === sheet.functionBlocks[0].id);
  assert.deepEqual(pins.map((p) => [p.pinName, p.sourceX, p.sourceY, p.direction]), [["R1", 1125, 1080, "output"]]);
});

test("same input bytes produce byte-identical SVG and PDF", () => {
  const buf = cadFile(symbol6("AND2", [1000, 1000, 1137, 1101], [1045, 1080], 10), polyline(1, 0, [[1125, 1080], [1300, 1080]]));
  const make = () => {
    const recs = decodeRecordStream(buf).records;
    const s = buildDrawingSheet(buf, "T0000002.CAD", { registry: new SymbolRegistry(), templates: learnPinTemplates([recs]), zoneGrid: null });
    const { items } = renderSheet(s, new SymbolRegistry());
    return { svg: toSvg(items, s.file), pdf: writePdf([{ items, label: s.file }], "t") };
  };
  const a = make(), b = make();
  assert.equal(a.svg, b.svg);
  assert.ok(a.pdf.equals(b.pdf));
});

// ------------------------------------------------------------ real archive
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const M5 = path.join(ROOT, "Test", "work", "M5", "M5");
test("M5 3260501A: AIS pins and OREF wiring reconstruct from source", { skip: !fs.existsSync(path.join(M5, "3260501A.CAD")) }, () => {
  const lib = path.join(ROOT, "Raw Data from Controller", "CAD", "project", "7107LIB1.LBR");
  const reg = new SymbolRegistry();
  if (fs.existsSync(lib)) reg.add(parseLbrLibrary(fs.readFileSync(lib), "7107LIB1.LBR"));
  const all = fs.readdirSync(M5).filter((f) => /\.CAD$/i.test(f)).map((f) => decodeRecordStream(fs.readFileSync(path.join(M5, f))).records);
  const s = buildDrawingSheet(fs.readFileSync(path.join(M5, "3260501A.CAD")), "3260501A.CAD", { registry: reg, templates: learnPinTemplates(all), zoneGrid: { dx: -35, dy: 2140, pitch: 100 } });
  const wires = s.connections.filter((c) => c.connectionType === "signal");
  assert.equal(wires.length, 17);
  assert.ok(wires.every((w) => w.relationStatus === "EXPLICIT"));
  const ais = s.functionBlocks.filter((b) => b.symbolName === "AIS");
  assert.deepEqual(ais.map((b) => b.blockNumber), [1030, 1040, 1050]);
  for (const b of ais) {
    const outs = s.pins.filter((p) => p.blockId === b.id && p.side === "right").map((p) => [p.relX, p.relY]);
    assert.deepEqual(outs, [[120, -40], [120, -80], [120, -120], [120, -160], [120, -200]]);
  }
  const oref = s.connectors.find((c) => c.tag === "AI1-SL1/411FT-0007")!;
  assert.equal(oref.zone, "03.21", "zone must match I90XREF.OUT source address BQ01-03.21");
  assert.equal(oref.connectionIds.length, 1);
  if (fs.existsSync(lib)) assert.equal(s.frame.libraryResolved, true);
});
