import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allFunctionCodes,
  decodePayload,
  expectedPayloadBytes,
  fixedBlock,
  formatG,
  getFunctionCode,
  getSpecification,
  knowledgeBase,
} from "./index";

const payload = (h: string) => new Uint8Array(Buffer.from(h, "hex"));

test("knowledge base covers the manual sections with contiguous numbering", () => {
  const kb = knowledgeBase();
  assert.equal(kb.source.pages, 734);
  assert.ok(allFunctionCodes().length >= 130);
  for (const fc of allFunctionCodes()) {
    assert.ok(fc.name, `FC${fc.function_code} has a name`);
    assert.equal(fc.spec_count, fc.max_spec_number, `FC${fc.function_code} numbering`);
    fc.specifications.forEach((s, i) => assert.equal(s.number, i + 1));
  }
});

test("FC 33 Not: single block-address spec", () => {
  const fc = getFunctionCode(33)!;
  assert.equal(fc.name, "Not");
  assert.equal(fc.spec_count, 1);
  assert.equal(fc.specifications[0].type, "I");
  assert.equal(fc.specifications[0].is_block_address, true);
  const d = decodePayload(fc, payload("e204"));
  assert.equal(d.status, "DECODED");
  assert.equal(d.specs[0].raw_value_text, "1250");
});

test("FC 35 Timer: I, I, R and 24-bit real printed as the vendor does", () => {
  const fc = getFunctionCode(35)!;
  assert.equal(fc.name, "Timer");
  assert.deepEqual(fc.specifications.map((s) => s.type), ["I", "I", "R"]);
  assert.equal(fc.specifications[2].default, "0.000");
  assert.equal(expectedPayloadBytes(fc), 8);
  const d = decodePayload(fc, payload("0000000000cdcc3d"));
  assert.deepEqual(d.specs.map((s) => s.raw_value_text), ["0", "0", "0.1"]);
  assert.notEqual(d.specs[2].actual_value, 0.1);
  assert.equal(d.specs[2].normalized_value, 0.1);
  assert.equal(d.specs[2].raw_hex, "00cdcc3d");
});

test("FC 10/11/14: four block-address inputs with manual defaults", () => {
  const cases: Array<[number, string, string]> = [
    [10, "High Select", "8"],
    [11, "Low Select", "9"],
    [14, "Summer (4-Input)", "5"],
  ];
  for (const [code, name, def] of cases) {
    const fc = getFunctionCode(code)!;
    assert.equal(fc.name, name);
    assert.deepEqual(fc.specifications.map((s) => s.label), ["S1", "S2", "S3", "S4"]);
    for (const s of fc.specifications) {
      assert.equal(s.type, "I");
      assert.equal(s.default, def);
    }
  }
  const d = decodePayload(getFunctionCode(10)!, payload("0800080008000800"));
  assert.deepEqual(d.specs.map((s) => s.actual_value), [8, 8, 8, 8]);
});

test("FC 139: long schema with mixed types", () => {
  const fc = getFunctionCode(139)!;
  assert.equal(fc.spec_count, 17);
  assert.equal(getSpecification(139, 11)!.type, "R");
  assert.equal(getSpecification(139, 11)!.default, "2.500");
  assert.deepEqual(fc.specifications.filter((s) => s.type === "R").map((s) => s.number), [11, 12, 15]);
  assert.equal(expectedPayloadBytes(fc), 14 * 2 + 3 * 4);
});

test("FC 147: bullet-elided rows are filled only between identical rows and marked", () => {
  const fc = getFunctionCode(147)!;
  assert.equal(fc.spec_count, 36);
  assert.equal(getSpecification(147, 20)!.elided_between, "S10 … S34");
  assert.equal(getSpecification(147, 34)!.elided_between, undefined);
  assert.equal(expectedPayloadBytes(fc), 72);
});

test("payload that does not close against the schema is not decoded", () => {
  const d = decodePayload(getFunctionCode(35)!, payload("000000"));
  assert.equal(d.status, "LAYOUT_MISMATCH");
  assert.equal(d.specs.length, 0);
  assert.equal(d.raw_hex, "000000");
});

test("fixed block addresses come from the manual table", () => {
  assert.equal(fixedBlock(8)!.description, "-9.2 E18");
  assert.equal(fixedBlock(9)!.description, "9.2 E18");
  assert.equal(fixedBlock(1)!.description, "Logic 1");
  assert.equal(fixedBlock(4000), undefined);
});

test("formatG matches C %g with a three-digit exponent", () => {
  assert.equal(formatG(0), "0");
  assert.equal(formatG(0.10000000149011612), "0.1");
  assert.equal(formatG(9.200009e18), "9.20001e+018");
  assert.equal(formatG(0.8000030517578125), "0.800003");
  assert.equal(formatG(1e-5), "1e-005");
  assert.equal(formatG(123456), "123456");
  assert.equal(formatG(1234567), "1.23457e+006");
});
