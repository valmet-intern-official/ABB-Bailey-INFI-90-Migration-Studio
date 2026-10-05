// End-to-end regression on the supplied modules. The vendor LIS/VFY reports
// are used only as assertion oracles.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { decodedFingerprint } from "./outputs";
import { runModule } from "./run";
import type { ExtractionResult } from "./types";
import { parseSpecReport, parseVerifyReport, validateResult } from "./validate";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const M10 = path.join(root, "tools/fc-manual/cache/m10/M10");
const M5 = path.join(root, "Guiding Material/Test 1 Data - CAD/work/M5/M5");

const load = (dir: string, module: string) => {
  const cads = fs.readdirSync(dir).filter((n) => /\.cad$/i.test(n)).sort().map((n) => ({ name: n, data: fs.readFileSync(path.join(dir, n)) }));
  return runModule({ module, cads, extractDir: dir }).result;
};
const cache = new Map<string, ExtractionResult>();
const get = (dir: string, module: string) => cache.get(module) ?? (cache.set(module, load(dir, module)), cache.get(module)!);
const spec = (r: ExtractionResult, id: string) => {
  const s = r.specifications.find((x) => x.id === id);
  assert.ok(s, `spec ${id} extracted`);
  return s;
};

describe("M10 (Test 2)", { skip: !fs.existsSync(M10) && "M10 data not present" }, () => {
  it("FC 33 NOT: S1 is the stored block address, byte-traceable, pin wired", () => {
    const r = get(M10, "M10");
    const s = spec(r, "2071000C.CAD#5166.S1");
    assert.equal(s.function_code, 33);
    assert.equal(s.raw_value_text, "0");
    assert.equal(s.raw_hex, "0000");
    assert.equal(s.type, "I");
    assert.deepEqual([s.source.byte_offset, s.source.byte_length], [2528, 2]);
    assert.equal(s.address_resolution?.status, "WIRED_INPUT");
    assert.equal(s.address_resolution?.target_block, 5165);
  });

  it("FC 35 TIME DELAY: S1..S3 decode as I, I, R with the vendor-format value", () => {
    const r = get(M10, "M10");
    const b = r.blocks.find((x) => x.id === "2071000C.CAD#5165")!;
    assert.equal(b.function_code, 35);
    assert.equal(b.payload_hex, "0000000000cdcc3d");
    assert.deepEqual(b.spec_ids.map((id) => spec(r, id).type), ["I", "I", "R"]);
    const s3 = spec(r, "2071000C.CAD#5165.S3");
    assert.equal(s3.raw_value_text, "0.1");
    assert.equal(s3.raw_hex, "00cdcc3d");
    assert.equal(s3.source.byte_length, 4);
  });

  it("FC 14 SUM 4-INPUT: stored fixed-block placeholders are kept verbatim and not upgraded", () => {
    const r = get(M10, "M10");
    for (const n of [1, 2, 3, 4]) {
      const s = spec(r, `20710C7C.CAD#5201.S${n}`);
      assert.equal(s.raw_value_text, "5");
      assert.equal(s.address_resolution?.status, "RESOLVED_FIXED_BLOCK");
      assert.notEqual(s.address_resolution?.evidence, "EXPLICIT");
    }
  });

  it("agrees with the vendor FC spec report for the regression blocks", () => {
    const r = get(M10, "M10");
    const lis = parseSpecReport(fs.readFileSync(path.join(M10, "20710.LIS"), "latin1"), "20710.LIS");
    for (const [file, blk] of [["2071000C.CAD", 5166], ["2071000C.CAD", 5165], ["20710C7C.CAD", 5201]] as const) {
      const v = lis.blocks.get(blk)!;
      const b = r.blocks.find((x) => x.id === `${file}#${blk}`)!;
      assert.equal(b.function_code, v.fc);
      for (const [n, text] of v.specs) assert.equal(spec(r, `${b.id}.S${n}`).raw_value_text, text, `${b.id}.S${n}`);
    }
  });

  it("FC 81 executive: the spec entry stored as block 0 pairs with the EX/MFC symbol block 10", () => {
    const r = get(M10, "M10");
    const b = r.blocks.find((x) => x.function_code === 81)!;
    assert.equal(b.id, "2071000C.CAD#10");
    assert.equal(b.symbol_name, "EX/MFC");
    assert.equal(b.status, "EXTRACTED");
    assert.equal(spec(r, "2071000C.CAD#10.S1").association.evidence, "DERIVED");
    assert.equal(r.module.executive_block, 10);
    assert.ok(!r.blocks.some((x) => x.status === "NOT_PRESENT"));
  });

  it("covers every block and spec of the vendor FC spec report", () => {
    const r = get(M10, "M10");
    const lis = parseSpecReport(fs.readFileSync(path.join(M10, "20710.LIS"), "latin1"), "20710.LIS");
    const o = validateResult(r, { specReport: lis }).oracle.vendor_spec_report as {
      blocks_compared: number; function_code_agreement: number; specs_compared: number; specs_equal: number; report_only_blocks: number[];
    };
    const reportSpecs = [...lis.blocks.values()].reduce((n, b) => n + b.specs.size, 0);
    assert.deepEqual(o.report_only_blocks, []);
    assert.equal(o.blocks_compared, lis.blocks.size);
    assert.equal(o.function_code_agreement, o.blocks_compared);
    assert.equal(o.specs_compared, reportSpecs);
    // The report dates from 2013; the CAD files were revised in 2016-2017. The
    // remaining differences are later edits (retuned spans, periods, rewired inputs).
    assert.ok(o.specs_equal >= 10709, `specs equal ${o.specs_equal}/${o.specs_compared}`);
  });

  it("passes every structural check and is deterministic", () => {
    const r = get(M10, "M10");
    const again = load(M10, "M10");
    const rep = validateResult(r, { determinism: { first: decodedFingerprint(r), second: decodedFingerprint(again) } });
    assert.deepEqual(rep.checks.filter((c) => !c.pass).map((c) => c.id), []);
  });

  it("has no FC 139 blocks; unknown codes are reported, not dropped", () => {
    const r = get(M10, "M10");
    assert.equal(r.blocks.filter((b) => b.function_code === 139).length, 0);
    assert.deepEqual(r.unknown_function_codes, []);
  });
});

describe("M5 (Test 1)", { skip: !fs.existsSync(M5) && "M5 data not present" }, () => {
  it("FC 10 and FC 11: four block-address specs decoded from the payload", () => {
    const r = get(M5, "M5");
    for (const [id, fc, text, hex] of [["32605G6A.CAD#1578", 10, "8", "0800"], ["32605G6A.CAD#1496", 11, "9", "0900"]] as const) {
      const b = r.blocks.find((x) => x.id === id)!;
      assert.equal(b.function_code, fc);
      assert.equal(b.payload_hex, hex.repeat(4));
      assert.equal(b.spec_ids.length, 4);
      const offsets = b.spec_ids.map((sid) => {
        const s = spec(r, sid);
        assert.equal(s.raw_value_text, text);
        assert.equal(s.raw_hex, hex);
        assert.equal(s.type, "I");
        return s.source.byte_offset!;
      });
      assert.deepEqual(offsets.map((o) => o - offsets[0]), [0, 2, 4, 6]);
    }
  });

  it("agrees with the SRC side of the Verify/Update report", () => {
    const r = get(M5, "M5");
    const vfy = parseVerifyReport(fs.readFileSync(path.join(M5, "32605.VFY"), "latin1"), "32605.VFY");
    const rep = validateResult(r, { verifyReport: vfy });
    const o = rep.oracle.vendor_verify_report as { presence_compared: number; presence_agree: number; function_codes_compared: number; function_codes_equal: number; specs_compared: number; specs_equal: number };
    assert.ok(o.presence_compared > 0);
    assert.equal(o.presence_agree, o.presence_compared);
    assert.equal(o.function_codes_equal, o.function_codes_compared);
    assert.equal(o.specs_equal, o.specs_compared);
    assert.deepEqual(rep.checks.filter((c) => !c.pass).map((c) => c.id), []);
  });
});
