# CAD Layout Engine V2 — Developer Report

## 1. Root cause of original layout problems

The native decoder ([`decodeCadSheet`](packages/cad-engine/src/reconstruction/sheet.ts)) correctly recovers blocks and wires with source coordinates. The renderer ([`renderEngineeringSvg`](packages/cad-engine/src/svg.ts)) **painted those coordinates directly** (axis-aligned boxes + raw polylines) with only heuristic nest-merge / nudge. There was **no** hierarchical graph layout, **no** Manhattan obstacle-aware router, and post-nudge endpoint shifts could introduce diagonals. Nested Bailey symbols drawn as full rectangles produced box overlaps.

## 2. Files modified / added

**Added**
- `packages/cad-engine/src/layout/` — full layout pipeline (`config`, `graph`, `groups`, `layers`, `sizing`, `place`, `ports`, `grid`, `router`, `lanes`, `labels`, `validate`, `score`, `pipeline`)
- `packages/cad-engine/src/layout/pipeline.test.ts` — 10 unit tests
- `tools/cad-forensics/render-v2.ts` — golden render + visual QA for Loading Deck sheets
- `tools/cad-forensics/diag-v2.ts` — wire-through diagnostics
- `tools/cad-forensics/out/v2/*` — generated SVG, JSON, QA HTML
- `docs/cad-layout-engine-v2-report.md` — this report

**Modified**
- `packages/core/src/engineering.ts` — `sourceGeometry`, port `side`/`offset`, `relationType`, `routingStatus`, `glyphStatus`
- `packages/cad-engine/src/reconstruction/sheet.ts` — attach `sourceGeometry` / `relationType` on decode
- `packages/cad-engine/src/svg.ts` — `CAD_RENDER_ENGINE=v2` branch; white background
- `packages/cad-engine/src/index.ts` — export layout API + `getCadRenderEngine`
- `packages/renderers/src/svg.ts` — pass engine into `cadSheetToSvg`
- `apps/web/src/lib/env.ts` + cad-svg route — honor `CAD_RENDER_ENGINE`
- `.env.example` — document `CAD_RENDER_ENGINE=v1|v2`

## 3. New layout / routing architecture

```
decodeCadSheet (unchanged topology)
  → buildLogicGraph
  → identifyLogicalGroups (STEP annotations / Y clusters)
  → assignLayers (IREF → logic depth → OREF)
  → calculateNodeDimensions
  → placeNodes (columns by layer, rows by source-Y)
  → assignPorts (left/right; bottom for feedback)
  → createRoutingGrid + carve column gutters
  → channel-aware orthogonal route + Lee BFS fallback
  → repairWireThrough
  → placeLabels
  → validateDiagramGeometry
  → renderEngineeringSvg
```

Feature flag: `CAD_RENDER_ENGINE=v2` (default `v1` preserves legacy paint).

## 4. Orthogonal routing approach

1. Prefer **inter-column vertical channels** and **inter-row horizontal gutters** that are geometrically clear of all block interiors.
2. Path shape: port stub → exit channel → gutter → entry channel → port stub (90° only).
3. If blocked: Lee/BFS on the routing grid; if still blocked: outer-lane fallback (never drop the edge).
4. Final **repairWireThrough** doglegs any residual segment that intersects an unrelated block.

## 5. Collision detection

- Node vs node: same-column overlap resolution during placement + validation AABB tests.
- Wire vs node: geometric segment∩rect with interior padding; used in validation and repair.
- Routing grid marks expanded block obstacles; column gutters are carved free.

## 6. Node placement strategy

- Columns by hierarchical layer (inputs/IREF left, logic center, outputs/OREF right).
- Rows by deterministic source-Y order; STEP groups reinforce ordinal alignment.
- Junctions placed in clear gutters (not barycenters inside logic boxes).
- Content-based width/height from labels and port counts.

## 7. Port / lane strategy

- Default ports: source **right**, target **left** (feedback: **bottom**).
- Multi-edge faces distribute offsets evenly, sorted by opposite-node Y.
- Vertical lanes = clear X between layer columns; horizontal lanes = clear Y between row bands.
- Parallel edges get small lane-index offsets.

## 8. Label placement

- Blocks reserve space; annotations (including STEP) placed via collision-aware `SpaceMap` with vertical-first nudges.
- Timer / S-parameters surfaced on block labels when present in decoded `parameters`.

## 9. Validation rules

`validateDiagramGeometry()` asserts:
- all segments orthogonal (`dx≈0` or `dy≈0`)
- no unintended node overlaps
- no wire through unrelated blocks
- nodes within page bounds
- reports connection/block counts

## 10. Tests executed

```
npx tsx --test packages/cad-engine/src/layout/pipeline.test.ts
→ 10/10 pass (2-node, chain, fan-in/out, STEP groups, feedback, determinism,
  connectivity, long labels, diagonal rejection)

npx tsx tools/cad-forensics/render-v2.ts
→ 3070561A.CAD: diag=0 overlap=0 through=0 ok=true countsMatch=true
→ 3070563A.CAD: diag=0 overlap=0 through=0 ok=true countsMatch=true
```

Artifacts: `tools/cad-forensics/out/v2/` (`*.svg`, `*_validation.json`, `cad_visual_qa.json/html`).

## 11. Remaining limitations

- Authentic `.LBR` symbol outlines still unused in sheet render (`glyphStatus=FALLBACK` rectangles).
- Per-pin topology from libraries is not decoded; ports are layout-assigned faces.
- Some long feedback/cross-sheet wires use outer lanes and can be longer than a hand-drafted sheet.
- `newId()` in decode is still time-based — layout itself is deterministic for a given model; full byte→ID determinism depends on stable IDs (future improvement).
- Visual density on very large sheets remains high; spacing is configurable via `LAYOUT_CONFIG`.

## Acceptance checklist (Loading Deck 1 & 2)

| Criterion | Status |
| --- | --- |
| No unintended box overlaps | Pass |
| No diagonal connection lines | Pass |
| Orthogonal 90° routing | Pass |
| No wire through unrelated elements | Pass (validator) |
| Counts unchanged (topology preserved) | Pass (123/96 and 121/95) |
| Multi-column hierarchy (IREF→logic→OREF) | Pass (layers 0..4 observed) |
| `sourceGeometry` retained | Pass |
| `v1` path unchanged by default | Pass |
| Generated SVG/PNG visually inspected | Pass — orthogonal H/V, column flow, white sheet; residual density/crossings remain on dense sheets |

Final golden metrics (`tools/cad-forensics/out/v2/cad_visual_qa.json`):

- **3070561A**: page 1536×~2800, diag=0, overlap=0, through=0, ok=true, score≈1022
- **3070563A**: page ~1576×~2600, diag=0, overlap=0, through=0, ok=true, score≈1045

Enable with: `CAD_RENDER_ENGINE=v2`
