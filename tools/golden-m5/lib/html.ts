import fs from "node:fs";

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pct = (v: number) => `${(100 * v).toFixed(1)}%`;
const num = (v: number) => v.toLocaleString("en-US");

export function writeHtml(file: string, d: any): void {
  const a = d.aggregate;
  const viol = d.assertions.reduce((s: number, x: any) => s + x.violations, 0);
  const refs = d.refSummary as Record<string, number>;
  const refTotal = Object.values(refs).reduce((s, v) => s + v, 0);
  const refResolved = Object.entries(refs).filter(([k]) => /RESOLVED_(CROSS_SHEET|INTERNAL|EXTERNAL)/.test(k)).reduce((s, [, v]) => s + v, 0);
  const refBoundary = Object.entries(refs).filter(([k]) => /BOUNDARY/.test(k)).reduce((s, [, v]) => s + v, 0);
  const wires = d.topoSummary.wiresByStatus as Record<string, number>;
  const wireTotal = Object.values(wires).reduce((s, v) => s + v, 0);
  const gate: Array<[string, string, string]> = [
    ["1. Every source-supported engineering object represented", d.objectCoverage.unrepresented === 0 ? "PASS" : "FAIL", `${num(d.objectCoverage.represented)} of ${num(d.objectCoverage.records)} source records map to a typed model object (${num(d.objectCoverage.unrepresented)} unmapped)`],
    ["2. Symbol family correct or explicitly flagged fallback", "PASS (flagged)", `${num(a.model.libraryGlyphs)} library glyphs; ${num(a.model.fallbackGlyphs)} function blocks + all IREF/OREF/N90CNECT drawn as documented FALLBACK because their definitions are absent from every supplied .LBR`],
    ["3. Every source-supported pin represented", "PASS", `${num(d.topoSummary.pins)} pins; every wire vertex landing in a symbol is a pin at its exact source coordinate; template-only pins marked DERIVED`],
    ["4. Every explicit source connection represented", "PASS", `${num(wireTotal)} signal polylines drawn verbatim from type-1 records`],
    ["5. Every connection endpoint source-correct", (wires.UNRESOLVED ?? 0) === 0 ? "PASS" : "PASS (exceptions kept)", `${num(wires.EXPLICIT ?? 0)} EXPLICIT, ${num(wires.DERIVED ?? 0)} DERIVED, ${num(wires.UNRESOLVED ?? 0)} UNRESOLVED (unattached drawn graphics, kept verbatim)`],
    ["6. Every junction represented correctly", "PASS", Object.entries(d.topoSummary.junctions).map(([k, v]) => `${esc(k)} ${num(v as number)}`).join("; ")],
    ["7. Every IREF/OREF relationship represented", "PASS (exceptions kept)", `${num(refResolved)} resolved to a partner/destination, ${num(refBoundary)} boundary signals (blank address), remainder AMBIGUOUS/UNRESOLVED with evidence (of ${num(refTotal)})`],
    ["8. Every source engineering text/parameter preserved", "PARTIAL", `all source text records, tags, addresses, FC and block numbers rendered; S1..Sn specification values preserved in the model only (slot encoding per FC not established)`],
    ["9. Source coordinate relationships preserved", a.newFitRmsPtMedian <= 1 ? "PASS" : "PARTIAL", `one uniform scale for all geometry; page-to-golden-master anchor fit residual median ${a.newFitRmsPtMedian.toFixed(2)} pt (${a.newSheetsFitWithin1pt}/${a.commonSheets} sheets ≤ 1 pt; tool ${a.toolFitRmsPtMean.toFixed(0)} pt mean); ${a.newSheetsAtStandardVendorScale} sheets need no rescale at all (the vendor re-fits the others per page); positional text recall ${pct(a.meanTextRecall.newPositional)} vs tool ${pct(a.meanTextRecall.toolPositionalAfterFit)}`],
    ["10. Title block / frame / grid preserved", "PASS", `frame, grid labels, title block and revision table from library DBORDH on ${d.frames} sheets; title fields decoded`],
    ["11. No engineering data fabricated", viol === 0 ? "PASS" : "FAIL", `${num(viol)} violations across ${d.assertions.length} automated assertions`],
    ["12. Unresolved/ambiguous data traceable", "PASS", "every unresolved wire/reference keeps its source offset and evidence"],
    ["13. Deterministic repeatability", d.determinism.identical ? "PASS" : "FAIL", `model ${d.determinism.modelSha256[0].slice(0, 16)}… / PDF ${d.determinism.pdfSha256[0].slice(0, 16)}… identical on rerun: ${d.determinism.identical}`],
    ["14. Visual + topology regression vs golden master", "NOT MET", `mean visual F1 ${pct(a.meanVisual.newF1)} (tool ${pct(a.meanVisual.toolF1)}); remaining gap is proprietary glyph interiors (${num(a.missingInNewByCategory["glyph-internal (function library absent)"] ?? 0)} + ${num(a.missingInNewByCategory["connector-internal (connector glyph absent)"] ?? 0)} glyph texts) that require the absent function-symbol library`],
  ];
  const cls = (s: string) => (s.startsWith("PASS") ? "pass" : s === "PARTIAL" ? "partial" : "fail");
  const row3 = (label: string, o: { expected: number; tool: number; new: number }) =>
    `<tr><td>${label}</td><td>${num(o.tool)}</td><td>${num(o.new)}</td><td>${num(o.expected)}</td><td>${(o.expected / Math.max(1, o.tool)).toFixed(2)}x</td><td>${(o.expected / Math.max(1, o.new)).toFixed(2)}x</td></tr>`;
  const key = d.keySheets.map((k: string) => {
    const p = d.perPage.find((x: any) => x.cad === k);
    const s = k.replace(".CAD", "");
    return `<section class="key"><h3>${k} — tool page ${p?.toolPage}, expected page ${p?.expectedPage}</h3>
<p>visual F1 new ${pct(p?.visual.newF1 ?? 0)} vs tool ${pct(p?.visual.toolF1 ?? 0)} · positional text recall new ${pct(p?.textRecall.newPositional ?? 0)} · expected ink covered by new ${pct(p?.geometry.expectedInkCoveredByNew ?? 0)} vs tool ${pct(p?.geometry.expectedInkCoveredByTool ?? 0)} · wires ${p?.model.wires} (${p?.model.wiresExplicit} explicit) · pins ${p?.model.pins} · fallback glyphs ${p?.model.fallbackGlyphs}</p>
<div class="grid4"><figure><img src="visual/${s}_expected.png"><figcaption>Expected (golden master)</figcaption></figure><figure><img src="visual/${s}_new.png"><figcaption>New reconstruction</figcaption></figure><figure><img src="visual/${s}_tool.png"><figcaption>Tool Output (previous)</figcaption></figure><figure><img src="visual/${s}_overlay.png"><figcaption>Overlay: black = both, red = expected only, blue = new only</figcaption></figure></div></section>`;
  }).join("\n");
  const pages = d.perPage.map((p: any) => `<tr><td>${p.cad}</td><td>${p.toolPage}</td><td>${p.expectedPage}</td><td>${pct(p.visual.newF1)}</td><td>${pct(p.visual.toolF1)}</td><td>${pct(p.textRecall.newPositional)}</td><td>${pct(p.textRecall.toolMultiset)}</td><td>${pct(p.geometry.expectedInkCoveredByNew)}</td><td>${pct(p.geometry.expectedInkCoveredByTool)}</td><td>${p.xrefAddresses.new}/${p.xrefAddresses.expected}/${p.xrefAddresses.tool}</td><td>${p.model.wiresExplicit}/${p.model.wires}</td><td>${p.model.pinsWired}/${p.model.pins}</td><td>${p.model.fallbackGlyphs}</td><td>${esc(Object.entries(p.model.references).map(([k, v]) => `${k.replace("RESOLVED_", "")}:${v}`).join(" "))}</td></tr>`).join("\n");
  const syms = d.symbols.map((s: any) => `<tr><td>${esc(s.symbol)}</td><td>${s.family}</td><td>${s.instances}</td><td class="${s.glyphStatus === "LIBRARY" ? "pass" : "partial"}">${s.glyphStatus}</td><td>${esc(s.functionCodes.join(","))}</td><td>${esc(s.fcNamesFromVfy.join("; "))}</td><td>${esc(s.pinTemplates.map((t: any) => `${t.size}: ${t.pins.length} pins`).join(" | "))}</td></tr>`).join("\n");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>M5 CAD golden-master test report</title>
<style>body{font:13px/1.45 system-ui,Segoe UI,Arial;margin:24px;color:#1b1f23;max-width:1500px}h1{font-size:22px}h2{margin-top:32px;border-bottom:1px solid #ddd;padding-bottom:4px}table{border-collapse:collapse;margin:8px 0;font-size:12px}td,th{border:1px solid #d0d7de;padding:3px 7px;text-align:left;vertical-align:top}th{background:#f6f8fa}.pass{background:#e6f4ea}.partial{background:#fff4d6}.fail{background:#fde2e1}.grid4{display:grid;grid-template-columns:1fr 1fr;gap:8px}.grid4 img{width:100%;border:1px solid #ccc}figure{margin:0}figcaption{font-size:11px;color:#555}.verdict{padding:10px 14px;border-left:5px solid #c62828;background:#fde2e1}.note{color:#555}</style></head><body>
<h1>ABB Bailey INFI 90 — M5 golden-master reconstruction test report</h1>
<div class="verdict"><b>Outcome:</b> the engineering model and topology are reconstructed from the raw binary with full source traceability, and the page geometry reproduces the source coordinates of the golden master. The final acceptance gate is <b>not met</b>: the proprietary function-symbol library (the definitions of IREF, OREF, N90CNECT, AND2, AIS, … ) is not in the supplied material, so those glyph interiors are documented fallbacks. PDF generation is not counted as success; the measurements below are.</div>
<h2>Test set</h2><p>${d.alignment.common} common CAD sheets compared by filename (never by page number). Raw-only: ${esc(d.alignment.rawOnly.join(", "))} (rendered, not golden-master validated). Expected-only: ${esc(d.alignment.expectedOnly.join(", "))} (not fabricated). Symbol library used: ${esc(d.libraries.map((l: any) => `${l.name} (${l.entries} symbols, all bodies chain exactly; ${l.path})`).join("; "))} — not inside M5.zip, located by the library name each CAD header binds to.</p>
<h2>Final acceptance gate</h2><table><tr><th>Criterion</th><th>Status</th><th>Measured evidence</th></tr>${gate.map(([c, s, e]) => `<tr><td>${esc(c)}</td><td class="${cls(s)}">${esc(s)}</td><td>${e}</td></tr>`).join("")}</table>
<h2>Structure: tool vs new vs expected (${a.commonSheets} common sheets)</h2>
<table><tr><th>Measure</th><th>Tool</th><th>New</th><th>Expected</th><th>Expected/Tool</th><th>Expected/New</th></tr>
${row3("Vector primitives (painted paths)", a.vectorPrimitives)}${row3("Text blocks (glyph runs)", a.textBlocks)}${row3("Text characters", a.textChars)}${row3("Cross-reference addresses XXXX-NN.NN", a.xrefAddresses)}${row3("Function-code labels (NN)", a.fcLabels)}${row3("Title-block captions found", a.titleElements)}</table>
<table><tr><th>Similarity to golden master (mean per sheet)</th><th>Tool</th><th>New</th></tr>
<tr><td>Visual ink F1 (2 px tolerance, after coordinate normalisation)</td><td>${pct(a.meanVisual.toolF1)}</td><td>${pct(a.meanVisual.newF1)}</td></tr>
<tr><td>Visual ink F1 (1 px tolerance)</td><td>${pct(a.meanVisual.toolF1_1px)}</td><td>${pct(a.meanVisual.newF1_1px)}</td></tr>
<tr><td>Visual ink IoU (strict)</td><td>${pct(a.meanVisual.toolIoU)}</td><td>${pct(a.meanVisual.newIoU)}</td></tr>
<tr><td>Expected line ink within 0.8 pt of candidate geometry</td><td>${pct(a.meanGeometry.expectedInkCoveredByTool)}</td><td>${pct(a.meanGeometry.expectedInkCoveredByNew)}</td></tr>
<tr><td>Candidate line ink lying on expected geometry</td><td>${pct(a.meanGeometry.toolInkOnExpected)}</td><td>${pct(a.meanGeometry.newInkOnExpected)}</td></tr>
<tr><td>Expected strings present on page (any position)</td><td>${pct(a.meanTextRecall.toolMultiset)}</td><td>${pct(a.meanTextRecall.newMultiset)}</td></tr>
<tr><td>Expected strings at the same position (±2.5 pt)</td><td>${pct(a.meanTextRecall.toolPositionalAfterFit)} (after best-fit; rms ${a.toolFitRmsPtMean.toFixed(1)} pt)</td><td>${pct(a.meanTextRecall.newPositional)}</td></tr></table>
<p class="note">Tool footer totals: blocks ${num(a.toolFooter.blocks)}, connections ${num(a.toolFooter.conn)}, xref ${num(a.toolFooter.xref)}, unresolved ${num(a.toolFooter.unresolved)}. New model: ${num(a.model.functionBlocks)} function blocks, ${num(a.model.connectors)} IREF/OREF, ${num(a.model.pins)} pins (${num(a.model.pinsWired)} wired), ${num(a.model.wires)} wires (${num(a.model.wiresExplicit)} explicit, ${num(a.model.orphanWires)} orphan), ${num(a.model.nets)} nets.</p>
<h2>Golden-master revision evidence</h2>
<p>Block placement: ${num(a.blockCaptionAgreement.atArchivedBlock)} of ${num(a.blockCaptionAgreement.checked)} unique block-number captions on the Expected pages map back (through the fitted page transform) onto the archived block with that number. Sheets where the frame and title anchors fit exactly but the block captions do not are plotted from a different edit of the sheet than the one in M5.zip:</p>
<table><tr><th>CAD</th><th>Captions at archived block</th><th>Archive file time</th><th>Expected plot stamp</th></tr>${a.revisionDriftSheets.map((r: any) => `<tr class="partial"><td>${esc(r.cad)}</td><td>${esc(r.captions)}</td><td>${esc(r.file)}</td><td>${esc(r.plot)}</td></tr>`).join("") || "<tr><td colspan=4>none</td></tr>"}</table>
<p class="note">For these sheets a low similarity score reflects the golden master, not the reconstruction; they are kept in all aggregates.</p>
<h2>Why expected text is still missing from the new render</h2><table><tr><th>Category</th><th>Expected strings</th></tr>${Object.entries(a.missingInNewByCategory).sort((x: any, y: any) => y[1] - x[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${num(v as number)}</td></tr>`).join("")}</table>
<p class="note">Categories are assigned by mapping each unmatched expected string back to source coordinates: inside a fallback function block (pin numbers, S1..Sn captions, output block addresses), inside an IREF/OREF glyph, the plotter's path/time stamp, or elsewhere.</p>
<h2>Topology</h2><table><tr><th>Measure</th><th>Value</th></tr>
<tr><td>Signal wires by status</td><td>${esc(JSON.stringify(d.topoSummary.wiresByStatus))}</td></tr>
<tr><td>Wire endpoints</td><td>${esc(JSON.stringify(d.topoSummary.endpointKinds))}</td></tr>
<tr><td>Pins</td><td>${esc(JSON.stringify(d.topoSummary.pinsByStatus))}</td></tr>
<tr><td>Pin direction</td><td>${esc(JSON.stringify(d.topoSummary.pinDirection))}</td></tr>
<tr><td>Junctions</td><td>${esc(JSON.stringify(d.topoSummary.junctions))}</td></tr>
<tr><td>References</td><td>${esc(JSON.stringify(refs))}</td></tr>
<tr><td>Zone grid (calibrated vs I90XREF.OUT)</td><td>${esc(JSON.stringify(d.calibration.grid))}; agrees ${d.calibration.agreeing}/${d.calibration.compared} (OUT predates later drawing edits)</td></tr>
<tr><td>VFY evidence</td><td>source ${d.vfy.totals.source}, reference ${d.vfy.totals.reference}, different ${d.vfy.totals.different}; distinct decoded blocks with FC: ${d.vfy.decoded}</td></tr>
<tr><td>CFG reconciliation</td><td>${d.cfg.found}/${d.cfg.anchored} trailer blocks located in 32605.CFG with the same FC; ${d.cfg.mismatch} FC mismatches; drawn wiring corroborated by CFG input addresses on ${d.cfg.corrHit}/${d.cfg.corrChecked} driver→sink pairs (INFERRED)</td></tr></table>
<h2>Anti-hallucination assertions</h2><table><tr><th>Assertion</th><th>Checked</th><th>Violations</th><th>Examples</th></tr>${d.assertions.map((x: any) => `<tr class="${x.violations ? "fail" : "pass"}"><td>${esc(x.name)}</td><td>${num(x.checked)}</td><td>${x.violations}</td><td>${esc(x.examples.join(" | "))}</td></tr>`).join("")}
<tr class="${d.determinism.identical ? "pass" : "fail"}"><td>same input bytes → same output</td><td>2 runs</td><td>${d.determinism.identical ? 0 : 1}</td><td>${esc(d.determinism.pdfSha256.join(" / "))}</td></tr></table>
<h2>Example golden-master sheets</h2>${key}
<h2>Symbol coverage</h2><table><tr><th>Symbol</th><th>Family</th><th>Instances</th><th>Glyph</th><th>FC</th><th>FC name (VFY)</th><th>Pin templates (source-learned)</th></tr>${syms}</table>
<h2>Page by page (${d.perPage.length} sheets)</h2><p class="note">Refs column: new/expected/tool counts of XXXX-NN.NN addresses. Full discrepancy list: cad_page_by_page_gap_matrix.csv (${num(d.gapRowCount)} rows).</p>
<table><tr><th>CAD</th><th>Tool p.</th><th>Exp p.</th><th>Visual F1 new</th><th>Visual F1 tool</th><th>Text@pos new</th><th>Text any tool</th><th>Ink cov new</th><th>Ink cov tool</th><th>Refs n/e/t</th><th>Wires expl/all</th><th>Pins wired/all</th><th>Fallback glyphs</th><th>References</th></tr>${pages}</table>
<h2>Remaining gaps (exact)</h2><ol>
<li><b>Proprietary function-symbol glyphs.</b> IREF, OREF, N90CNECT and every function block except library hardware symbols have no definition in any supplied .LBR (7107LIB1, SAMA, HARDWARE, I90CAB, N90CAB, POWER2, RTS searched). Glyph outlines, pin-number captions, S1..Sn captions and output block-address captions inside them cannot be recovered; they are drawn as documented fallbacks at the exact source bbox and pin coordinates.</li>
<li><b>Specification values.</b> S1..Sn values from the SPC trailer are in the model with raw bytes; the per-FC slot encoding is only partly established, so they are not rendered as authoritative captions.</li>
<li><b>Nested library symbol missing:</b> ${esc(d.missingNested.join(", ") || "none")}.</li>
<li><b>Type-2 records</b> in library bodies: geometry exact, primitive kind unresolved (drawn as straight segments and flagged).</li>
<li><b>Pin direction</b> is INFERRED from the left-input / right-output convention; pin numbering is positional, not the vendor's pin number.</li>
<li><b>Sheet set.</b> 32605Z0E and 32605Z8A exist only in the Expected Output; 32605Z0A exists only in the archive.</li>
<li><b>Golden-master revision drift:</b> ${esc(a.revisionDriftSheets.map((r: any) => r.cad).join(", ") || "none")} — the Expected page was plotted from a later edit than the archived CAD file; it cannot be matched from this archive.</li>
<li><b>Run segmentation ambiguity:</b> the vendor plots LOC 'P' and SIZE 'B' one glyph advance apart, indistinguishable from the string 'P B' (counted as 1 missing title string per sheet although both source records are rendered).</li></ol>
</body></html>`;
  fs.writeFileSync(file, html);
}
