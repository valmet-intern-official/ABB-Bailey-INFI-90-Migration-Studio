import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getFunctionCode } from "@infi90/function-codes";
import { formatPlotTime, symbolCaptions } from "./scene";
import { manualInputMultiple } from "./terminals";

describe("manual-derived rules", () => {
  it("reads input spacing multiples from manual symbols", () => {
    assert.equal(manualInputMultiple(getFunctionCode(85)!), 1); // UP/DN: S1..S4 at standard spacing
    assert.equal(manualInputMultiple(getFunctionCode(34)!), 2); // SR: double spacing
    assert.equal(manualInputMultiple(getFunctionCode(129)!), 1);
  });

  it("keeps manual top-down output order", () => {
    assert.deepEqual(getFunctionCode(80)!.symbol.outputs, ["N+1", "N", "N+2", "N+4", "N+3", "N+5"]);
    assert.deepEqual(getFunctionCode(132)!.symbol.outputs.slice(0, 2), ["N+5", "N"]);
  });

  it("parses long manual symbols to the last S label (FC147 to S36)", () => {
    const inputs = getFunctionCode(147)!.symbol.inputs;
    assert.ok(inputs.includes("S36"), inputs.join(","));
    assert.ok(inputs.includes("S28"));
  });

  it("binds H/L captions to the output rows", () => {
    const caps = symbolCaptions(getFunctionCode(12)!);
    assert.deepEqual(caps.filter((c) => c.side === "output").map((c) => `${c.text}@${c.row_label}`).sort(), ["H@N", "L@N+1"]);
  });

  it("binds segment-control pin captions and the executive absolute rows", () => {
    const seg = symbolCaptions(getFunctionCode(82)!);
    assert.deepEqual(seg.filter((c) => c.side === "output").map((c) => `${c.text}@${c.row_label}`), ["PT@N", "ET@N+1", "UF@N+2", "OR@N+3", "CT@N+4"]);
    const ex = symbolCaptions(getFunctionCode(81)!);
    assert.deepEqual(ex.filter((c) => c.side === "output").map((c) => `${c.text}@${c.row_label}`), ["SU@10", "MEM@11", "PT@12", "REV@13", "N/A@14"]);
  });

  it("formats the plot time like the vendor header", () => {
    assert.equal(formatPlotTime(new Date(2016, 11, 21, 8, 26, 40)), "08:26:40 AM 12/21/2016");
    assert.equal(formatPlotTime(new Date(2017, 3, 17, 15, 57, 34)), "03:57:34 PM 04/17/2017");
    assert.equal(formatPlotTime(new Date(2017, 0, 1, 0, 5, 0)), "12:05:00 AM 01/01/2017");
  });
});
