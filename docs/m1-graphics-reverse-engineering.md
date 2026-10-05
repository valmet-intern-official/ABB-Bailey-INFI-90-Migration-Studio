# M1 graphics reverse-engineering and extractor

The `@infi90/m1-engine` package (`packages/m1-engine`) decodes ABB Bailey INFI 90 `.M1` operator graphics into a typed object model and renders them deterministically. The web app exposes it through the **M1 graphics** upload on the home page and the `/m1/[id]` inspector.

The decoder never guesses. Every byte is assigned to a typed field with a status of `KNOWN`, `CANDIDATE` or `UNRESOLVED`. Anything that cannot be derived from the file is labelled as such rather than approximated. This document records the format rules, the evidence for each, and the known limits.

## 1. Pipeline

| Stage | Module | Output |
| --- | --- | --- |
| Inventory | `archive/inventory.ts` | ZIP/directory/file listing, sha256, magic check |
| Binary decode | `decoder/scanner.ts`, `decoder/records.ts` | Records with typed fields, raw hex, coverage report (strict mode fails loudly on gaps) |
| Object graph | `objects/graph.ts` | IDs, reference edges, referrers, owners, parents, integrity issues |
| Bindings | `bindings/bindings.ts` | Instance parameters, property bindings, tag index |
| Templates | `templates/templates.ts` | Template registry, per-template instances, external dependencies |
| Logic | `logic/logic.ts` | Dynamic-property graph (opcodes kept raw) |
| Scene | `scene/scene.ts` | World-space render stack in draw order, each node traced to its object id |
| Render | `render/layout.ts`, `svg.ts`, `pdf.ts`, `png.ts` | SVG, PDF and PNG, original and marking-tag variants |
| Validation (optional) | `validation/*` | Page matching, registration, metrics, palette calibration against a reference PDF |
| Package | `package/writer.ts` | `source/ decoded/ graphics/ diagnostics/ forensic/` per file |

The decoder revision is `m1-decoder/1.1.0` (`DECODER_REVISION` in `decoder/scanner.ts`), and it is stamped into every output.

## 2. Format rules

All rules live in `src/rules.ts` and are exported as `rules.json` with every package. A rule is `PROVEN` only when an assertion over the full corpus enforces it; `test/rules.test.ts` checks that each non-visual rule names an existing test. Rules supported only by visual comparison are `CANDIDATE`.

| Rule | Status | Statement |
| --- | --- | --- |
| RULE-MAGIC-001 | PROVEN | Magic `m1gms4u\n` followed by u32 0x10, 1, 0. The header is 20 bytes. |
| RULE-REC-001 | PROVEN | After the header, records tile the file with no gaps: `[u32 preamble][Class+\0][body]`. |
| RULE-REC-002 | PROVEN | The preamble is 0, except for PtArray, where it is 2 × point count. |
| RULE-FIELD-001 | PROVEN | Every byte of every record belongs to a typed field. |
| RULE-ID-001 | PROVEN | Object id = ordinal + 1. IDs are allocated breadth-first in stream order (0 violations). |
| RULE-HDR-001/002 | PROVEN | Shared header layout. Slot 0 is a reference to a `G_DynProp_30`. |
| RULE-REF-001 | PROVEN | Each reference role targets one class family. |
| RULE-GEOM-001 | PROVEN | Coordinates are 16.16 fixed point, y-up. Menus span [0,100]×[0,75]. |
| RULE-XF-001/002 | CANDIDATE | Scal2d `[tx,ty,sx,sy]` and Mat2x3 `[a,b,tx,c,d,ty]`, with translations in 16.16 units. |
| RULE-SHAPE-001 | CANDIDATE | Rect: 2 corners. Circ: centre + circumference point. Sect: centre + start point, start/sweep in degrees. Line/Spline: point lists. |
| RULE-STYLE-001 | CANDIDATE | 24-byte style block (contains the 0x2710 constant). Colours are palette indices. |
| RULE-STYLE-002 | CANDIDATE | fillStyle 2 is a 50 % dither, rendered as the mean tone. |
| RULE-TEXT-001 | CANDIDATE | Text height is 16.16 × transform sy. hAlign 1 = left, 2 = centre. |
| RULE-BIND-001 | PROVEN | `%#1#% NAME "value" … %#1#%` parameters; `$NAME$` keys expand exactly to their stored values. |
| RULE-TPL-001 | PROVEN | Template geometry is not stored in these files; templates are external dependencies. |
| RULE-VIEW-001/002 | CANDIDATE | The view extent is [0,100]×[0,75] ∪ content, fitted uniformly to the client area. |

When a new rule is discovered, it is added here and in `rules.ts` together with a unit test before rendering relies on it. The decoder revision is bumped whenever field layouts change, and old forensic outputs are kept.

## 3. Corpus results (`Guiding Material/Test 1 Data - Graphics/M10`)

All 10 files decode with 100 % of bytes typed: 14,925 records, 14,915 resolved references, 0 graph issues and 0 inconsistent bindings. Re-rendering is byte-identical across runs.

When the reference PDF is supplied, each file is matched to its pair of reference pages (original and marking) without being told which page belongs to which file:

| File | Records | Scene nodes | Placeholders | External templates | Ref. pages | Edge precision | Edge recall |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1302-131pms01 | 165 | 38 | 23 | 1 | 1/2 | 0.996 | 0.085 |
| 1303-131pml01 | 308 | 71 | 56 | 1 | 3/4 | 0.998 | 0.108 |
| 1304-131pmt01 | 315 | 73 | 58 | 1 | 5/6 | 0.998 | 0.113 |
| 1305-131pmq01 | 314 | 72 | 57 | 1 | 7/8 | 0.997 | 0.107 |
| 1311-131ps01 | 2109 | 637 | 225 | 20 | 9/10 | 0.938 | 0.290 |
| 1312-131ps02 | 2770 | 979 | 152 | 16 | 11/12 | 0.936 | 0.444 |
| 1313-131ps03 | 5252 | 1011 | 244 | 19 | 13/14 | 0.897 | 0.340 |
| 1314-131ps04 | 2311 | 822 | 268 | 18 | 15/16 | 0.822 | 0.186 |
| 1323-131ps1323 | 647 | 119 | 99 | 5 | 17/18 | 0.815 | 0.213 |
| 1324-131ps24 | 734 | 161 | 120 | 7 | 19/20 | 0.845 | 0.174 |

How to read these numbers:

- **High edge precision** means that what the renderer draws is present in the reference, so geometry, transforms and view mapping are right.
- **Low recall** is expected and explained: equipment faces, pipes and menu buttons are drawn by external templates whose geometry is not in the M1 file. Each instance stays in the scene graph as `TEMPLATE_GEOMETRY_UNRESOLVED`. The normal graphic paints that instance's source tag and menu caption at its origin, and does not paint the template resource name. `graphics/source-debug.svg` shows the names and object ids. Symbol artwork is not invented.

## 4. What is not resolved

These gaps are stated in every package's `claim`, in `discrepancies.json` and in the inspector:

- **Templates:** 24 external templates (for example `dupont_MenuPB`, `iiu_stain_pipe3d`, `iiu_Raff_tk01`). Their geometry lives in template libraries that are not part of the supplied data. Supplying those libraries is the path to full-fidelity rendering. The quality gate reports "ModInsts resolved" as `PARTIAL` and templates as `EXPLICITLY_UNRESOLVED`.
- **Palette:** the M1 files store palette indices only; no RGB table exists in them. Without a reference, indices 0–15 use the ANSI-16 order (ASSUMED) and all others get a deterministic synthetic colour (UNKNOWN). With a reference PDF, colours are calibrated from the screenshots (CANDIDATE, source documented in `palette.json` and `palette-calibration.json`). Indices 147–180 were rejected by calibration and remain UNKNOWN.
- **Field semantics:** fields typed `UNRESOLVED` are exported with raw hex in `diagnostics/unresolved-fields.csv`.
- **Logic semantics:** opcodes are preserved raw; their meaning is not asserted.
- **Visual rules:** `CANDIDATE` rules rest on visual comparison with the oracle, not on a byte-level assertion.

The engine never reports a file as "fully decoded". `claim.semantics` is `PARTIAL`, and `claim.rendering` is `PARTIAL_EXTERNAL_TEMPLATES` whenever placeholders are drawn.

## 5. Reference PDF (validation oracle only)

`Expected Output - Graphics.pdf` has 20 pages, each holding raster screenshots and no text. Pages come in pairs: the original screen, then the same screen with red marking overlays.

The extractor runs without the PDF. When one is supplied, it is used for four things only:

1. Page pairing: normalised-thumbnail NCC, taking local maxima.
2. Marking detection: a tolerant red-pixel count.
3. File-to-pair assignment and registration: greedy matching on distinctive edges, then a coarse-to-fine search over scale and offset.
4. Metrics (pixel similarity, edge precision/recall/F1, foreground IoU, histogram intersection, per-object edge recall) and optional palette calibration.

The PDF never feeds geometry, layout or text into the renders.

## 6. Output package

The package is written by `writeOutputPackage` (from the CLI or the web API):

```text
<file>/source/        original .m1 + source-info.json (sha256, decoder revision)
<file>/decoded/       records, strings, tags, properties, transforms, geometry, groups, links (.csv)
                      logic, scene-graph, templates, bindings (.json)
<file>/graphics/      original.{svg,pdf,png}, with-marking-tag.{svg,pdf,png}
<file>/diagnostics/   coverage, object-graph, marker-candidates, palette-usage, discrepancies (.json)
                      unresolved-fields.csv; with a reference: reference-comparison.json,
                      reference/diff/overlay/side-by-side PNGs
<file>/forensic/      full-hexdump.txt (annotated at record starts), record-index.csv, fields.csv
summary.json  quality-gate.json  rules.json  palette.json  archive-inventory.json  [palette-calibration.json]
```

Every SVG element carries `data-obj="<object id>"`, so any drawn pixel traces back to its record and bytes.

## 7. Running it

- **CLI:** `npm run extract -w @infi90/m1-engine -- --input <zip|dir|file> --out <dir> [--reference <pdf>] [--no-calibrate] [--strict]`. It exits with code 1 if any quality-gate item fails.
- **Tests:** `npm test -w @infi90/m1-engine` runs the rule tests, integrity tests, determinism tests and golden masters. Refresh the golden masters with `npm run golden:update -w @infi90/m1-engine`, and only after reviewing the diff.
- **Web:** upload `.m1` files or a ZIP (plus an optional reference PDF) in the **M1 graphics** card on the home page.
  - The `/m1/[id]` page shows the rendered graphics preview with a file selector, an Original / With marking tags toggle, zoom, and PDF/PNG/SVG downloads.
- **API** (under `apps/web/src/app/api/m1`):
  - `POST /api/m1/upload`
  - `GET /api/m1/[id]`
  - `GET /api/m1/[id]/asset/[...path]` (path-contained to the session package)
