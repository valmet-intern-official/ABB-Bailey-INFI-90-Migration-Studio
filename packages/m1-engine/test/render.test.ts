import { test } from "node:test";
import assert from "node:assert/strict";
import { corpusFiles, skip } from "./corpus";
import { analyzeM1 } from "../src/pipeline/analyze";
import { layoutScene } from "../src/render/layout";
import { renderSvg } from "../src/render/svg";
import { renderPdf } from "../src/render/pdf";
import { fallbackPalette } from "../src/render/palette";

test("renders are deterministic and every element traces to a source object", { skip }, () => {
  for (const { name, data } of corpusFiles()) {
    const a1 = analyzeM1(name, data);
    const a2 = analyzeM1(name, data);
    const l1 = layoutScene(a1.scene, { palette: fallbackPalette() });
    const svg1 = renderSvg(l1, { marking: true });
    const svg2 = renderSvg(layoutScene(a2.scene, { palette: fallbackPalette() }), { marking: true });
    assert.equal(svg1, svg2, name);
    const els = svg1.match(/<(path|text|g) data-obj="(\d+)"/g) ?? [];
    assert.ok(els.length >= l1.ops.length, name);
    for (const m of svg1.matchAll(/data-obj="(\d+)"/g)) assert.ok(Number(m[1]) >= 1 && Number(m[1]) <= a1.decoded.records.length);
    const pdf = renderPdf(l1);
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.ok(pdf.toString("latin1").includes("%%EOF"));
  }
});

test("claims never state full decoding", { skip }, () => {
  for (const { name, data } of corpusFiles()) {
    const a = analyzeM1(name, data);
    assert.equal(a.claim.bytes, "ALL_BYTES_TYPED");
    assert.equal(a.claim.semantics, "PARTIAL");
    assert.ok(a.claim.reasons.length > 0);
  }
});
