# M5 Conversion Engineering Gap Analysis

## Validation outcome

**Result: NOT ACCEPTABLE for engineering use or migration sign-off.** The generated PDF is not an equivalent engineering representation of the M5 source/expected drawings. It preserves much of the functional-block and I/O signal-name text, but it loses the great majority of source cross-reference tags, the drawing-sheet engineering presentation, reference endpoint semantics, and one required sheet. Every generated sheet explicitly reports `COMPLETED_WITH_WARNINGS`.

This report distinguishes defects already present in the supplied source package from conversion defects. A source-side unresolved reference must not be silently removed or converted into a different warning count.

## Inputs inspected in full

| Input | What was inspected | Finding |
|---|---|---|
| `M5.zip` | All 222 `.CAD` files; `.CFG`, `.BND`, `.LST`, `.MHD`, `.REF`, `.VFY`, `I90XREF.OUT`, `I90XREF.ERR`, `I90XREF.XRF`, logs and list files | Proprietary binary CAD project containing function blocks, symbols, coordinates, pin/link records, labels and cross-references. `I90XREF.OUT` is the source signal/cross-reference listing. `I90XREF.ERR` contains 807 pre-existing unresolved records (10 input and 797 output). |
| `Tool Output.pdf` | All 222 pages, extracted text/metadata and rendered visual pages | 10,304 blocks, 8,767 connections, 3,988 tags and 4,258 xrefs reported by the tool. Every page has an unknown-classification marker (`.CAD ?`) and a warning footer. |
| `Expected Output.pdf` | All 223 pages, extracted text and rendered visual pages | Full Bailey-format engineering sheets, with native block symbols, numbered pins, endpoint glyphs, signal lines, BQ cross-reference tags, zones, title/revision blocks and drawing identifiers. |

## Source engineering structure

The source is a Bailey INFI 90 Digester configuration. The drawing population includes:

- Master/executive sheet `3260500A.CAD`.
- Analog input slaves 1-4 (`3260501A` through `3260504A`), analog output slaves 5-8 (`3260505A` through `3260508A`), digital input slaves 9-16, and digital output slaves 17-20.
- Process/control, inter-module, alarm, spare and macro drawings covering the remaining `32605xxA.CAD` files.
- Function types including AIS, AS0, DIGRP, DOGRP, OREF, IREF, NOT, H/L, TD-DIG, OR, AND, SUM, APID, TSTALM and associated Bailey symbols.
- Named I/O such as `AI1-SL1/411FT-0007`, `AO1-SL5/411FV-0007`, `DI1-SL9/411LSH-0074` and `DO...`; BQ tags are the actual cross-sheet endpoint/address identifiers.

The original sheet format is A4 (595 x 842 pt) with a coordinate frame, title block, revision table, document control and native CAD sheet layout. The tool changes every output page to Letter (792 x 612 pt).

## Complete high-severity discrepancy checklist

| ID | Scope / exact location | Expected | Tool result | Difference and engineering significance | Required correction |
|---|---|---|---|---|---|
| G-01 | Entire set, 222 common sheets | Native Bailey drawing symbols, pins, terminal/endpoint glyphs, wires, junction dots and spatially meaningful topology | Generic small blue/orange rectangles and orthogonal line stubs on a different sheet canvas | This is a representation substitution, not a faithful CAD conversion. Symbol identity, port identity and visual signal traceability are no longer verifiable from the output. | Implement symbol-family mapping, pin/port geometry, wire routing and junction rendering from the CAD object model. Validate rendered geometry, not only object counts. |
| G-02 | All 222 tool page headers | Identifiable drawing title/number in a controlled title block | `32605…CAD ? …` on all 222 pages | `?` is an unclassified/unknown state embedded in every deliverable. | Resolve drawing classification before export; fail the job if an unknown classification remains. |
| G-03 | All 222 tool pages | Engineering drawing with source title/revision block, border grid, date/revision/customer controls and drawing metadata in their prescribed locations | Loose text at lower left; native title block, grid, revision table and document-control layout omitted | Document identity and revision traceability are lost. This prevents use as a controlled engineering drawing. | Reconstruct or faithfully render the original title block, border/grid and revision controls at their source coordinates. |
| G-04 | All 222 tool pages | No conversion diagnostics within the released drawing | `blocks:… conn:… tags:… xref:… unresolved:… status:COMPLETED_WITH_WARNINGS engine:v2` footer | Non-engineering diagnostic text has been added to every drawing and all pages are known non-clean conversions. | Remove diagnostics from production output; emit them in a separate validation report. Treat nonzero unresolved values as an export failure or an explicitly approved exception. |
| G-05 | All pages with cross-reference labels; extraction comparison across PDFs | 4,168 occurrences of `BQ…` connection/tag references | 35 occurrences retained | 4,133 expected BQ references are absent (99.16%). This is the dominant functional defect: remote signal endpoints cannot be identified or traced. | Preserve each BQ identifier verbatim, associate it with its correct source/destination pin, and render it at the expected endpoint. Add a one-to-one BQ-reference reconciliation test. |
| G-06 | Entire set | 2,466 `411-…` engineering identifiers | 901 extracted occurrences | At least 1,565 411 identifiers are absent (63.46%). Loss includes equipment/loop and signal-context identifiers. | Preserve all 411 identifiers as endpoint annotations and metadata; compare normalized source text at element level. |
| G-07 | Entire set | 509 named AI/AO/DI/DO endpoint strings | 493 retained | At least 16 I/O endpoint strings are absent (3.14%); retained strings are often converted to generic `OREF`/`IREF` boxes rather than native endpoint representation. | Produce a named-I/O reconciliation: source name, source pin, BQ tag, target pin, rendered endpoint and page/coordinate. Block release for any unmatched endpoint. |
| G-08 | Tool pages 1-222 | Complete, clean conversion or clearly source-matched exceptions | All pages have `COMPLETED_WITH_WARNINGS` | No page is cleanly converted. The status alone invalidates any assertion of complete engineering equivalence. | Make warning-free conversion the default acceptance gate; exceptions must retain the original source issue and be documented individually. |
| G-09 | Expected page 223, `32605Z8A.CAD` | A complete macro sheet containing the final visible chain (`1` -> function -> `A`) | No tool page | Required expected sheet missing. It is also absent from M5.zip, so this is a source-package completeness issue and a tool-output coverage defect. | Obtain/version-control `32605Z8A.CAD`; include it in the input manifest and require expected-page/output-page reconciliation. |
| G-10 | Tool page 216 versus expected page 216 | Expected identifies `32605Z0E.CAD` | Tool identifies/archive contains `32605Z0A.CAD` | Source identity mismatch. The two suffixes cannot be assumed equivalent. The expected reference log also names Z0E while archive contains Z0A. | Resolve the authoritative drawing identity before conversion. Do not map Z0A to Z0E by page position. |

## Connection, endpoint and symbol defects

### Systemic endpoint conversion failure

Expected endpoint semantics are: native function-block pin -> wire -> native endpoint/cross-reference marker -> BQ address -> associated 411/tag/description. The tool commonly renders: generic function box -> partial orthogonal segment -> orange `OREF`/`IREF` box with an artificial `#OREF_n`/`#IREF_n` identifier. The artificial numbered identifiers are not the source BQ tags and cannot substitute for them.

- Hashed OREF identifiers occur on 200 tool pages; hashed IREF identifiers occur on 208 pages.
- Expected pin numbers, pin-side orientation, terminal glyphs, bus/branch relationship and junction-dot semantics are not preserved by that substitution.
- Long horizontal line stubs in the tool output are frequently visually detached from the converted reference boxes. They must not be accepted as a connection merely because the PDF contains a line and a block nearby.
- The tool's connection count is a diagnostic count, not evidence of correct endpoint pairing. Its 8,767 reported connections have not been rendered in the source topology or annotated with the 4,133 missing BQ references.

### Representative element-by-element findings

| Expected location | Expected element/connection | Tool-generated element/connection | Exact difference | Required correction |
|---|---|---|---|---|
| Expected/tool page 2, `3260501A.CAD`, Analog Input Slave 1 | Three native `(132) AIS` blocks, with 15 named outputs `AI1-SL1` through `AI15-SL1`; each output is wired to its BQ/411 reference and process description | Three generic AIS boxes plus 15 orange OREF boxes, numbered `#OREF_1` to `#OREF_15`; only 17 connections reported | All 14 expected BQ references on the sheet are absent. The expected endpoint labels include `BQ34-04.07`, `BQ42-04.07`, `BQ46-04.07`, `BQ56-07.07`, `BQ56-10.07`, `BQ68-06.07`, `BQ68-10.07`, `BQC8-14.07`, `BQD6-04.07`, `BQE0-05.07`, `BQE6-04.07`, `BQF7-06.07`, `BQP0-05.07`, `BQZ5-06.07`; the tool replaces the endpoint identity with `#OREF_n`. Expected 411/process annotations are also absent from the endpoint representation. | Map each AIS port separately; render all 15 wires, BQ labels, 411 IDs and descriptions at the corresponding endpoints. Verify port-to-endpoint pairs rather than only `xref:15`. |
| Expected/tool page 3, `3260502A.CAD`, Analog Input Slave 2 | Three AIS blocks and 13 named outputs `AI1-SL2` through `AI13-SL2`, each with source BQ reference, 411 ID and description | Three generic AIS blocks and 13 numbered OREF boxes; 15 connections reported | All 13 expected BQ tags are absent, including `BQ36-04.07`, `BQ43-04.07`, `BQ48-05.07`, `BQ59-06.07`, `BQ59-10.07`, `BQ72-06.07`, `BQ72-10.07`, `BQC9-14.07`, `BQD7-04.07`, `BQE1-05.07`, `BQE7-04.07`, `BQF7-08.07`, `BQP2-06.07`. The expected source spelling `DIG 6 BOOTOM RECIRC FLOW` is retained by the tool, so this word is source content, not a tool spelling defect. | Restore the 13 BQ endpoint labels and associated 411/description annotations. Preserve source spelling unless a separately approved source-data correction is made. |
| Expected/tool page 4, `3260503A.CAD`, Analog Input Slave 3 | 13 AIS outputs with BQ endpoint labels from `BQ38-04.07` through `BQP4-06.07` | Generic AIS/OREF conversion, `xref:13`, BQ labels absent | The output preserves signal names but not the cross-sheet address that makes each signal traceable. | Render every BQ label on the corresponding source endpoint and retain pin number/side. |
| Expected/tool page 5, `3260504A.CAD`, Analog Input Slave 4 | 15 AIS outputs, including `AI14-SL4/411LT-2614` and `AI15-SL4/411FT-0070`, with BQ labels | 15 OREF boxes; `xref:15` | Source tag/endpoint structure is flattened into generic OREF nodes; BQ and 411 context is not at the endpoint. | Perform 15 one-to-one endpoint reconciliations and preserve native output-port arrangement. |
| Expected/tool page 6, `3260505A.CAD`, Analog Output Slave 5 | Two-column native `(149) AS0` output modules with AO1-AO14, pin labels, BQ tags and valve/service annotations | Generic boxes/lines with AO text; only 12 tags/xrefs reported | Expected includes AO13/AO14 paths and BQ references such as `BQJ4-07.26`, `BQJ4-09.07`, `BQJ4-03.07`; the tool's reported tags/xrefs are incomplete and its graphic lacks native two-column module/pin presentation. | Recreate both AS0 modules, all AO paths, endpoints, BQ tags and service labels. Reconcile expected 14 output channels. |
| Expected/tool page 10, `3260509A.CAD`, Digital Input Slave 9 | Two native `(84) DIGRP` blocks, 15 DI signals, BQ tags and named valve/level/pump endpoints | Two generic DIGRP boxes with numbered OREF boxes; `tags:14`, `xref:14` | Expected has 15 DI paths (`DI1`-`DI15`); reported tag/xref totals show one path is not fully represented. All 14 extractable expected BQ references are absent from tool text. | Verify each of 15 input pins, endpoint BQ tag and signal description. Reject unequal DI-path and xref counts. |
| Expected/tool page 218, `32605Z2A.CAD`, Inter-Module | Multi-branch inter-module logic: DI/L, AI/L, DO/L, IREF/OREF, OR, NOT, T-DIG, H/L and signal branches for Digester 5-8 | 105 generic blocks, 88 connections, 47 tags, 41 xrefs | The source page's functional routing, branch/junction topology and BQ references are visually replaced by generic graph layout. It is a high-complexity topology regression even though tool `unresolved:0`. | Use this sheet as a topology regression test: compare every block type, pin number, edge direction, BQ endpoint and junction with a graph derived from CAD. |
| Expected/tool page 219, `32605Z4A.CAD`, Annunciator Alarm | Four alarm paths for 411HS-0086E/F/G/H with native DO/L/IREF/OREF connections | 12 blocks, 8 connections, 8 tags/xrefs and `unresolved:4` | Four unresolved items remain. The source BQ labels (`BQB2-06.26`, `BQB3-06.26`, `BQB4-06.26`, `BQB5-06.26`) are absent from tool text. | Do not release. Resolve/render each alarm path, its BQ reference, DO endpoint and IREF source. |
| Expected/tool page 222, `32605Z7A.CAD`, Macro | Native macro logic including SUM, AND2, APID, TSTALM, T-AN, AO/AI and Boolean constants | 31 generic blocks, 28 connections, 7 tags, 9 xrefs, `unresolved:2` | Macro graph is not a native-symbol representation; expected BQ macro references are absent and two items are unresolved. | Create a macro-symbol and macro-port mapping; reconcile each logic edge and constant connection. |

## Warning reconciliation: exact mismatched drawing locations

The raw cross-reference error log has **807** unresolved records. The tool footer totals **791**. A lower number is not an improvement when the records are not traceably preserved. The following are all 18 drawing-level count mismatches between the raw `I90XREF.ERR` log and the tool footer.

| Drawing | Raw unresolved | Tool unresolved | Delta | Validation finding |
|---|---:|---:|---:|---|
| `3260508A.CAD` | 1 | 0 | -1 | Source issue silently omitted |
| `3260566A.CAD` | 2 | 9 | +7 | Tool introduced/reclassified seven warnings |
| `3260567A.CAD` | 6 | 4 | -2 | Two source issues omitted |
| `32605B2A.CAD` | 10 | 9 | -1 | One source issue omitted |
| `32605B5A.CAD` | 10 | 9 | -1 | One source issue omitted |
| `32605D9A.CAD` | 1 | 0 | -1 | Source issue silently omitted |
| `32605E9A.CAD` | 9 | 8 | -1 | One source issue omitted |
| `32605F4A.CAD` | 2 | 0 | -2 | Source issues silently omitted |
| `32605I7A.CAD` | 10 | 8 | -2 | Two source issues omitted |
| `32605J8A.CAD` | 1 | 0 | -1 | Source issue silently omitted |
| `32605K5A.CAD` | 3 | 2 | -1 | One source issue omitted |
| `32605K8A.CAD` | 1 | 0 | -1 | Source issue silently omitted |
| `32605M9A.CAD` | 3 | 0 | -3 | Three source issues silently omitted |
| `32605N1A.CAD` | 3 | 2 | -1 | One source issue omitted |
| `32605N2A.CAD` | 2 | 0 | -2 | Source issues silently omitted |
| `32605Z0A.CAD` | 0 | 7 | +7 | Tool warnings do not match archive source |
| `32605Z0E.CAD` | 4 | 0 | -4 | Expected/log drawing absent from archive/output identity |
| `32605Z1A.CAD` | 17 | 11 | -6 | Six source issues omitted |

## Tool-reported unresolved-item coverage

112 of 222 tool sheets report unresolved items (791 total); the other 110 are only *reported* as zero and still carry `COMPLETED_WITH_WARNINGS`. These are exact affected drawing groups from the tool footer, suitable for a test-run checklist.

| Tool unresolved count | Drawings |
|---:|---|
| 15 | `32605G2A`, `32605I0A` |
| 14 | `32605I2A` |
| 13 | `32605C8A`, `32605C9A`, `32605D0A`, `32605D1A`, `32605G0A`, `32605G8A`, `32605H2A`, `32605H8A`, `32605I6A`, `32605I8A` |
| 12 | `32605G4A`, `32605H4A`, `32605J0A` |
| 11 | `32605G3A`, `32605H1A`, `32605I1A`, `32605Z1A` |
| 10 | `3260500A`, `32605D2A`, `32605D3A`, `32605D4A`, `32605D5A` |
| 9 | `3260557A`, `3260560A`, `3260563A`, `3260566A`, `3260569A`, `3260573A`, `3260577A`, `3260581A`, `32605B2A`, `32605B3A`, `32605B4A`, `32605B5A`, `32605C4A`, `32605C5A`, `32605H3A`, `32605H9A`, `32605I9A` |
| 8 | `3260546A`, `3260548A`, `3260550A`, `3260552A`, `32605C6A`, `32605C7A`, `32605E6A`, `32605E7A`, `32605E8A`, `32605E9A`, `32605G1A`, `32605G9A`, `32605I7A` |
| 7 | `3260534A`, `3260536A`, `3260538A`, `3260540A`, `3260542A`, `3260543A`, `3260544A`, `3260545A`, `32605B6A`, `32605B7A`, `32605B8A`, `32605B9A`, tool page 216 (`32605Z0A`, expected `32605Z0E`) |
| 6 | `32605A4A`, `32605A6A`, `32605A8A`, `32605B0A` |
| 5 | `32605C2A`, `32605C3A`, `32605P0A`, `32605P2A`, `32605P4A`, `32605P6A` |
| 4 | `3260553A`, `3260558A`, `3260561A`, `3260564A`, `3260567A`, `3260570A`, `3260574A`, `3260578A`, `3260582A`, `32605Z4A` |
| 3 | `3260551A` |
| 2 | `3260547A`, `3260549A`, `32605F0A`, `32605F1A`, `32605F2A`, `32605F3A`, `32605G6A`, `32605H6A`, `32605I4A`, `32605J2A`, `32605K4A`, `32605K5A`, `32605K7A`, `32605L3A`, `32605L4A`, `32605M2A`, `32605M5A`, `32605N1A`, `32605Z7A` |
| 1 | `32605G7A`, `32605H7A`, `32605I5A`, `32605J3A` |

## Acceptance criteria for the corrected converter

1. Establish a source manifest before conversion: 222 archive files plus a formal disposition for expected-only `32605Z8A` and Z0A/Z0E identity mismatch.
2. Build a graph directly from each CAD drawing: block type, instance ID, parameter values, pin number, pin side, wire/junction, OREF/IREF target, BQ reference, 411 identifier and annotation.
3. Reconcile every source object to exactly one rendered object; reject merged, duplicated, fragmented or unclassified (`?`) objects.
4. Reconcile every logical edge by `(source block, source pin, destination block/endpoint, destination pin, signal name, BQ tag)`. A line merely touching a box is not acceptance evidence.
5. Require BQ reference count and values to be exactly equal to the expected/source page after normalization. The target is 4,168/4,168, not 35/4,168.
6. Require all named I/O strings and all 411 identifiers to match source values and location/endpoint association.
7. Render native Bailey symbols, pin orientations, endpoint glyphs, junctions, line style and title/revision graphics on the original A4 sheet geometry.
8. Move diagnostics to a separate report. Production drawing output must contain no `?`, no conversion footer and no non-approved unresolved item.
9. Reconcile source `I90XREF.ERR` records one-for-one. Existing source issues must be carried forward, not dropped; new issues must be separately classified.
10. Use pages 2, 3, 6, 10, 218, 219 and 222 as mandatory visual-and-graph regression sheets, plus the required missing page 223 once `32605Z8A` is supplied.

## Conclusion

The tool has extracted a substantial set of block names, parameters and I/O names, but it has **not** performed a faithful engineering-drawing migration. The loss of BQ references, changed endpoint semantics, altered symbolography/layout, omitted controlled-document graphics, unmatched warning accounting and missing expected sheet make the output unsuitable as a validated replacement for the expected Bailey engineering representation.
