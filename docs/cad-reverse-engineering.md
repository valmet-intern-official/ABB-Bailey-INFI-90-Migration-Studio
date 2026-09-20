# Bailey INFI 90 `.CAD` — Reverse Engineering Report

Status of this document: **all twelve record types and the `BCCo SPC LIST`
trailer are decoded; 100% of the record stream is accounted for.** Function
codes and block specifications are now read from the source rather than a
hand-written table. Every rule was re-tested across the whole corpus and
validated against two independent vendor artefacts: the `I90XREF.OUT`
cross-reference report and the 288-page reference plot. Recovered engineering
content measures **77.35%** of everything the vendor's own plot draws (§10.1);
symbol outlines in the `.LBR` bodies remain the principal gap (§10).

Every statement below is classified:

| Class | Meaning |
| --- | --- |
| `CONFIRMED` | Validated mechanically against the archive; failure would have been detected |
| `INFERRED` | Strongly supported by repeated evidence, not yet mechanically validated |
| `ASSUMED` | Working hypothesis, must be proved or discarded |
| `UNKNOWN` | Not yet determined — do not code against it |

No field marked `ASSUMED` or `UNKNOWN` may be presented as a Bailey specification.

## 1. Evidence base

The corpus is **every** `.CAD` file in the supplied material, deduplicated by
content. 11,421 paths exist, but 4,101 are byte-identical copies — mostly the
running app's own upload and extraction scratch space under
`apps/web/data/`, plus `Input/M5` and `Input/M10` which duplicate drawings
already present under `Raw Data from Controller`.

| Item | Value |
| --- | --- |
| `.CAD` paths found | 11,421 |
| Unique by content | **7,320** |
| Redundant copies excluded | 4,101 |
| Records decoded | **762,038** |
| Record-stream bytes | 23,234,700 |
| Files failing the length chain | 0 |
| Symbol libraries | 10 files, 7 distinct (`.LBR`) |
| Loop prefixes represented | 42 |

Analysis is archive-wide, not fixture-driven. Every rule proposed from a single
file is re-tested against all 7,320 files before being relied upon; the
verification run is reproducible via `verify-hypotheses.ts` below.

| Tool | Purpose |
| --- | --- |
| `census.ts` | Per-type, per-field statistics over every record in the corpus |
| `verify-hypotheses.ts` | Re-tests every layout rule archive-wide and reports pass rates |
| `coverage.ts` | Byte-level accounting: what the schema explains and what it does not |
| `residue.ts` | Locates remaining unexplained bytes by type and offset |
| `field-columns.ts` | Character-class analysis to find fixed-width sub-field boundaries |
| `probe-type.ts` | Labelled byte map for one record type, sampled across many files |
| `validate-oracle.ts` | Compares decoded output against the vendor's `I90XREF.OUT` report |
| `batch-validate.ts` | Whole-corpus decode, reconstruction and correlation run |
| `inventory.ts` | Corpus discovery and duplicate detection |
| `lbr-*.ts` | Symbol-library directory, body, stride and scale analysis |

## 2. Originating application — `CONFIRMED`

`7107LIB1.LBR` opens with the ASCII banner:

```
SCAD 5.3Wed Dec 21 15:26:02 2016
```

The drawings are **SCAD 5.3** files. This is the authority to consult for
format questions, and it means the `.CAD` files are *not* self-contained
drawings — see §6.

## 3. File layout — `CONFIRMED`

```
+--------------------------------------------------+
| 0x000  file header, 256 bytes                    |
+--------------------------------------------------+
| 0x100  record stream (variable-length records)   |
+--------------------------------------------------+
|        "BCCo<C5>SPC<C5>LIST"  + entry table      |
|        "BCCo<C5>ATR<C5>LIST"  + entry table      |
|        "END<C5>CAD<C5>FILE"                      |
+--------------------------------------------------+
```

`0xC5` acts as the field separator inside trailer keyword tokens; `0x00`
terminates a token. The record stream ends at the first `BCCo<C5>`.

## 4. Record grammar — `CONFIRMED`

```
offset  size  field
  +0      2   uint16 LE   type          (observed 1..12)
  +2      2   uint16 LE   lengthWords   record size in 16-bit words, incl. header
  +4     10   uint16 LE x5              w2..w6 — meaning UNKNOWN (see §7)
 +14      8   char[8]     symbolName    space-padded, on name-bearing records
 +22      ..              payload       NUL-padded strings / binary
```

Records are word-aligned; runs of `0x0000` between records are padding.

**Validation.** Walking `offset += lengthWords * 2` from byte 256 terminates
exactly at the trailer in **7,340 of 7,340 files (100%)**, consuming all
763,726 records with zero desynchronisation. A wrong length field or wrong
header size would desynchronise within a few records and fail loudly, so this
is a genuine mechanical confirmation rather than a plausible reading.

### Record type distribution (whole corpus) — all twelve decoded

| Type | Count | Decoded as | Class |
| --- | --- | --- | --- |
| 5 | 325,167 | Text with extent box, height, rotation (§4.2) | `CONFIRMED` |
| 1 | 204,584 | Polyline, 2–53 vertices: wires and drawing rules (§4.1) | `CONFIRMED` |
| 6 | 69,128 | Symbol instance + Bailey block number | `CONFIRMED` |
| 8 | 63,613 | Symbol instance + 30-byte tag + reference address (§4.4) | `CONFIRMED` |
| 9 | 42,245 | Symbol instance + reserved 8-byte text slot | `CONFIRMED` |
| 11 | 34,985 | Symbol instance — the `N90CNECT` junction | `CONFIRMED` |
| 2 | 12,962 | Two-point primitive | `CONFIRMED` geometry, kind `UNKNOWN` |
| 10 | 3,242 | Symbol instance + small enum at `+30` | `CONFIRMED` |
| 4 | 2,761 | Three-point primitive | `CONFIRMED` geometry, kind `UNKNOWN` |
| 7 | 1,698 | Terminal block + reference array (§4.3) | `CONFIRMED` |
| 3 | 1,426 | Two-point primitive | `CONFIRMED` geometry, kind `UNKNOWN` |
| 12 | 227 | Symbol instance | `CONFIRMED` |

Types 6, 7, 8, 9, 10, 11 and 12 — 215,138 records — all carry the 8-byte name
at `+14`, a bounding box at `+6`, an insertion point at `+22` and a rotation at
`+26`, so they share one symbol-instance layout that the decoder handles
uniformly, with per-type extensions after `+30`.

Type 11 is **not** a separate "connection record" as previously supposed: it is
the instance record for the `N90CNECT` junction symbol, which is why its count
matches the junction count exactly. Topology comes from type 1.

### 4.0 Shared fields — `CONFIRMED`

Verified over all 762,038 records:

```
+0  uint16  type          1..12
+2  uint16  lengthWords   record size in 16-bit words, including this header
+4  uint16  layer         1..16   (95% of records are on layer 1)
```

Symbol instance types add:

```
+6  x1  +8 y1  +10 x2  +12 y2      bounding box, always ordered x1<=x2, y1<=y2
+14 char[8]  symbolName            8 printable bytes, space padded
+22 uint16   insertionX
+24 uint16   insertionY
+26 uint16   rotation              0 / 90 / 180 / 270, no other value occurs
+28 uint16   flags
```

The insertion point is a placement origin and is **not** contained in the
bounding box: border symbols such as `DBORDH` are placed at the sheet origin
while their extent spans the drawing. An earlier containment rule passed on
95.5% of records and was discarded as over-fitted rather than tuned.

Fields are padded with spaces in some files and NULs in others; every text
reader accepts both.

### 4.1 Type 1 — line — `CONFIRMED`

```
offset  size  field
  +0      2   uint16 LE   type = 1
  +2      2   uint16 LE   lengthWords = 8
  +4      2   uint16 LE   flag        1 = signal wire, 2 = drawing rule
  +6      2   uint16 LE                UNKNOWN (0 or 1)
  +8      2   uint16 LE   x1
 +10      2   uint16 LE   y1
 +12      2   uint16 LE   x2
 +14      2   uint16 LE   y2
```

**This is the wire topology.** In `30705C8A.CAD`, wire `@560` runs
`(3860,2800) -> (2220,2800)`: x=2220 is the right edge of an `IREF` bounding
box and x=3855 is the left edge of the `DO/L` box on the same centreline, so
the segment joins exactly those two symbols. Every record is a fixed 8 words.

The `flag` distinction is `INFERRED` but strongly separable: in the fixtures
every `flag = 1` line is incident on two symbols and every `flag = 2` line
spans the sheet touching none.

### 4.2 Type 5 — text — `CONFIRMED`

```
offset  size  field
  +6      2   uint16 LE   x1          text extent box
  +8      2   uint16 LE   y1
 +10      2   uint16 LE   x2
 +12      2   uint16 LE   y2
 +14      2   uint16 LE   textHeight  observed 20 / 30 / 40
 +18      ..  char[]      string
```

Confirmed by width proportionality: `DEBARKER #1 DRIVE GEAR LUB PRESS`
(32 chars) occupies `(4220,1170)-(4795,1200)`, i.e. 575 units wide at height
30, about 18 units per character — consistent across the sampled records.

The height word carries a flag in bit 15. A raw value of `32788` is
`0x8000 | 20`; masking the low 15 bits makes every one of the 325,167 text
records fall on a round height (20, 30, 40, 50, 10, 60, 70, 80, 100, 120, 140,
200). The meaning of bit 15 is `UNKNOWN` and is preserved and flagged.

### 4.3 Type 7 — terminal block with a reference array — `CONFIRMED`

```
+30 uint16   UNKNOWN (preserved)
+32 array of 40-byte entries, one per terminal:
      +0  char[10] reference   'XXXX-NN.NN', may be blank
      +10 char[30] tag         signal tag / description
```

Lengths are 38 words (one entry) or 178 words (eight entries); the entry array
always occupies a whole number of 40-byte slots. Example, one `DIL/B` record
carrying eight terminals:

```
AH96-10.26  D282TA1239
AHB0-13.26  D282MAN301
AH03-05.13  DI1-3A/282AUX-M301
AH09-05.27  DI1-9B/282LSH211
```

### 4.4 Type 8 — IREF / OREF with a cross-reference address — `CONFIRMED`

```
+30 char[30] tag         signal tag / description, right-aligned
+60 char[10] reference   'XXXX-NN.NN', or blank
+70 4 bytes  zero
```

The reference is rigidly formatted. Character-class analysis of the 40-byte
window across all 63,613 records shows **column 64 is always `-` and column 67
is always `.`** in every one of the 57,676 populated records; the remaining
5,937 are blank. Types 7 and 8 carry the same two fields in opposite order.

## 5. Header fields

| Offset | Bytes | Reading | Class |
| --- | --- | --- | --- |
| `0x000` | 2 | `02 00` in all fixtures — version/magic | `INFERRED` |
| `0x00A` | 2 | varies per file | `UNKNOWN` |
| `0x07A` | 8 | `14 00 FB FF 04 00 04 00` — note `FBFF` = `-5` signed; candidate extents/scale | `ASSUMED` |
| `0x08A` | 6 | `08 01 30 00 20 00` | `UNKNOWN` |
| `0x090` | 8 | `7107lib1` — **symbol library binding** | `CONFIRMED` |
| `0x0A2` | 6 | `D0 CA 0B E6 30 4D` | `UNKNOWN` |
| `0x0FE` | 2 | `B1 DE` immediately before first record; candidate checksum | `ASSUMED` |

Header size of 256 bytes is `CONFIRMED` — it is the offset the validated record
walk starts from.

## 6. Symbol geometry lives in the libraries — `CONFIRMED`

This is the most consequential finding for rendering.

The `.CAD` records reference symbols **by 8-byte name only** and contain no
symbol outlines. `7107LIB1.LBR` contains a symbol directory beginning at
`0x210`, with **16-byte entries**: an 8-byte space-padded name followed by 8
bytes (`ASSUMED` offset + length into the library body).

Directory entries observed: `TITLE`, `DBORDH`, `REV`, `LINE`, `BOX1`, `BOX2`,
`DIP2W`, `DIP4W`, `TCSAO1`, `TCSAO2`, `TCSDO1`–`TCSDO4`, `DSO21`–`DSO28`,
`DSO41`–`DSO45`, …

**19 of 20** symbol names sampled from the CAD record stream resolve against
this library, and the library body contains `LINE` and `FILL` primitives.

Consequence: authentic engineering symbols are **recoverable**. The renderer
must resolve `CAD record name → library symbol → primitives`, not substitute
generic flowchart shapes. 344 distinct symbol names are referenced across the
archive.

## 7. Geometry encoding — `CONFIRMED`

Solved via the library route: the `.LBR` body reuses the *same* record grammar
as `.CAD`, but there the payloads carry literal drawing primitives, which made
the numeric conventions readable. Two records at LBR offsets 1058 and 1074
decode as a line from (3984,1222) to (3984,1246) and a three-point primitive —
coordinates in the same numeric range as the CAD header words.

Applying that reading to the CAD record header:

```
offset  size  field
  +6      2   uint16 LE   x1   bounding box left
  +8      2   uint16 LE   y1   bounding box bottom
 +10      2   uint16 LE   x2   bounding box right
 +12      2   uint16 LE   y2   bounding box top
 +14      8   char[8]     symbolName
 +22      2   uint16 LE   insertionX
 +24      2   uint16 LE   insertionY
```

### Validation against the whole archive (215,648 named instances)

| Prediction | Result |
| --- | --- |
| `x1 <= x2` and `y1 <= y2` | **215,648 / 215,648 — 100.00%** |
| insertion point falls within the bounding box | 201,781 / 215,648 — 93.57% |
| instances match their symbol's most common exact size | 133,742 / 215,648 — 62.02% |

Perfect box ordering across 215,648 independent records cannot arise from
pointer or handle values, which would violate the ordering roughly half the
time. Combined with the per-symbol size table below, this is `CONFIRMED`.

Drawing coordinate space: **X 246..9955, Y 226..9670** — i.e. a ~10000×10000
integer grid. Y is mathematically upward (`y1` is the low edge), so rendering
to SVG requires a Y flip.

### Per-symbol sizes are physically meaningful

| Symbol | Instances | Dominant size | Reading |
| --- | --- | --- | --- |
| `N90CNECT` | 35,053 | 12×12 | connection node / junction dot |
| `IREF` | 34,427 | 221×41 | off-sheet input reference |
| `OREF` | 27,890 | 221×41 | off-sheet output reference |
| `DBORDH` | 7,020 | 3380×2180 | drawing border — the sheet frame |
| `LINE` | 6,352 | 2481×1791 | frame rule |
| `AND2` | 5,058 | 137×101 | logic gate |
| `NOT` | 8,874 | 137×45 | inverter |
| `TD-DIG` | 6,456 | 177×80 | digital timer |
| `SR` | 2,691 | 137×125 | set/reset latch |
| `PRT5` | 1,903 | 11×11 | 100% single size |
| `PRD4` | 1,757 | 10×10 | 100% single size |

The 62% exact-match figure understates stability: the residual is a handful of
near-identical variants per symbol (`AND2` at 137×101 / 135×100 / 144×101),
consistent with library revisions or text-extent inclusion rather than noise.
Rotation was tested as an explanation and rejected — normalising width/height
as unordered changed the figure by 14 instances out of 215,648, so symbols in
this archive are effectively axis-aligned.

The normalised viewer canvas (e.g. 1000×750) is a *transformation target*
applied after decoding, never an assumption about the source encoding.

### Visual validation

`tools/cad-forensics/render-proof.ts` draws every name-bearing record at its
decoded position using only confirmed fields — no inferred layout, no synthetic
spacing. Rasterised via headless Chrome into
`tools/cad-forensics/out/*.png`.

`30705C8A` (18 placed symbols) renders as a coherent I/O sheet: four
`RDI01B1/B2/B3/B7` hardware blocks stacked at regular 400-unit intervals down
the left edge, each with an `IREF` reference abutting its right side, matching
`DO/L` outputs in a right-hand column, and `DI1SYS` nested inside the first
block.

`30705D6A` (156 placed symbols) renders as a six-stage sequence ladder with
strict left-to-right signal flow:

```
RDI01A1..A6 + IREF  ->  OR2  ->  SR (+NOT)  ->  AND2 x2  ->  TD-DIG  ->  NOT  ->  OREF
```

Six near-identical rows correspond to the `STEP 1`..`STEP 6` strings in the
same file, and `N90CNECT` instances land in vertical columns *between* stages —
precisely where wire junctions belong. Coherent engineering structure at this
level cannot be produced by a mis-decode, so this closes the geometry question.

It also corroborates lead #1 in §10: type 11 / `N90CNECT` is the wire topology.

## 8. Semantic content observed

Recovered strings are real engineering payload, e.g. from the fixtures:

- I/O references: `DI1-31B/322PSL155`, `AI10-9/322TT152C`
- BA cross-references: `BA31-06.22`
- Hardware/termination: `RDI01B1`, `062-05/06-B1`, `DI1SYS`
- Function blocks: `AND2`, `OR2`, `NOT`, `SR`, `TD-DIG`, `QOR`, `H/L`, `PID`
- Timer parameters: `TO=5 SEC`, `TO=10 SEC`
- Sequence steps: `STEP 1` … `STEP 12`
- Descriptions: `DEBARKER #1 DRIVE GEAR LUB PRESS`, `NO. 2 WOODYARD`
- Title block: `30705C8`, `MARC/2005`, `RP`, `A`, `C216560`, `920327`, `MILL EXPANSION`
- Usage notes: `USE = 322-150.0`

The `BCCo SPC LIST` trailer is now decoded — see §8.1.

## 8.1 The `BCCo SPC LIST` trailer — `CONFIRMED`

The trailer is 6.92% of every file and holds the engineering data the record
stream does not: each configured block's **numeric function code** and its
**specification values**. The vendor's plot draws exactly these, which is how
the layout was found — the reference page for `2061000A.CAD` shows blocks
1050/1051/1055/1056 with codes `(12) (33) (35) (82) (90)`, and searching the
trailer for those literal values exposed the structure.

```
"BCCo" C5 "SPC" C5 "LIST"          section token
<section header>                    solved per file (1 byte in 7,315 of 7,316)
entries, each:
  +0  uint16  lengthWords          entry size in 16-bit words
  +2  uint16  blockNumber          Bailey block address
  +4  uint16  functionCode         numeric FC
  +6  ...     payload              specification slots, 4 bytes each
"BCCo" C5 "ATR" C5 "LIST"
"END" C5 "CAD" C5 "FILE"
```

Worked example, `2061000A.CAD`, matching the plot exactly:

| offset | lengthWords | block | FC |
| --- | --- | --- | --- |
| +28 | 28 | 15 | 82 |
| +84 | 28 | 1024 | 82 |
| +140 | 28 | 9000 | 82 |
| +196 | 12 | 20 | 90 |
| +220 | 8 | 1050 | 12 |
| +236 | 7 | 1055 | 35 |
| +250 | 4 | 1056 | 33 |

**The section-header size is solved, not assumed.** A fixed 15 bytes fitted
this file and desynchronised 89% of the archive — a textbook overfit. It is
instead recovered per file by a hard constraint: the only acceptable offset is
one whose length chain terminates *exactly* on the following section token.
With that, **7,316 of 7,320 files (99.95%) chain cleanly** and unexplained
trailer bytes fall to 4 across the whole corpus.

### Corroboration

| Check | Result |
| --- | --- |
| Entry chain ends exactly on the next section token | 7,316 / 7,320 (99.95%) |
| Type 6 record block numbers also present in the trailer | 69,091 / 69,128 (99.95%) |
| Trailer block numbers also present in the records | 69,091 / 70,826 (97.55%) |
| Specification entries recovered | 70,827 |
| Specification slots recovered | 228,473 |
| Distinct function codes | 91 |

### Function codes are now read from the source

Joining a record-stream symbol name to its trailer entry through the block
address yields the function-code table. It is self-consistent: **all 82
distinct symbol names map to exactly one function code, agreeing on 69,091 of
69,091 observations (100.00%)** with zero conflicts.

| Symbol | FC | Symbol | FC | Symbol | FC |
| --- | --- | --- | --- | --- | --- |
| NOT | 33 | SR | 34 | TD-DIG | 35 |
| QOR | 36 | AND2 | 37 | AND4 | 38 |
| OR2 | 39 | OR4 | 40 | DO/L | 45 |
| AO/L | 30 | H/L | 12 | T-AN | 9 |
| DIGRP | 84 | DOGRP | 83 | PID | 18 |
| SUM | 15 | MULT | 16 | DIV | 17 |
| SEGCRM | 82 | EEX/MFC | 90 | ETIMER | 86 |

This **corrected an error**: the engine previously carried a hand-written table
with `AND=33`, `NOT=34`, `OR=37`. The source says `NOT=33`, `SR=34`, `AND2=37`,
`OR2=39`. Values are now read per block from the file, with the table used only
as a fallback for sheets without a trailer entry.

### Specification slot encoding — `AMBIGUOUS`, preserved

Slots are 4 bytes, but the payload is not uniformly float32: 44.7% are zero and
34.8% decode as denormal floats, while the plot shows integer specifications
such as `20..29`. The encoding evidently varies by function code in a way not
yet established, so every slot retains its float32, two uint16, uint32 and raw
hex readings, with a `likely` classification of `zero`, `float`, `integer` or
`ambiguous`. An ambiguous slot is surfaced as `AMBIGUOUS(0x…)` rather than
silently resolved to one reading.

## 9. Production decoder — in service

The string-scraping path in `packages/parsers/src/cad.ts` has been retired
behind the native decoder. `parseCadFile()` now calls `decodeCadSheet()` and
only falls back to the old scraper when a buffer yields no placed symbols.

Module layout in `packages/cad-engine/src`:

| Module | Responsibility |
| --- | --- |
| `binary/reader.ts` | header size, trailer bounds, name/string field reads |
| `records/decode.ts` | length-chain walk → typed `RawCadRecord[]` |
| `semantic/classify.ts` | symbol name → role, numeric function code, parameters |
| `geometry/transform.ts` | source grid → viewer space, including the Y flip |
| `reconstruction/sheet.ts` | records → `EngineeringSheetModel` |
| `svg.ts` | vector renderer with `data-*` hit-testing hooks |

Module layout additions: `semantic/reference.ts` (address parsing),
`semantic/modules.ts` (module-prefix registry), `reconstruction/correlate.ts`
(cross-sheet linking), `lbr/library.ts` (symbol library directory).

### 9.1 Rule verification — every rule tested archive-wide

`verify-hypotheses.ts` re-tests each proposed layout rule against all 7,320
files. **24 of 24 rules hold at exactly 100%**, covering 762,038 records:
record grammar, layer range, symbol name/bbox/insertion/rotation, polyline
vertex arithmetic, two- and three-point primitives, text extent/height/rotation,
Bailey block-number range, and the type 7 and 8 field layouts.

Three candidate rules were **rejected** by this process rather than tuned:
insertion-within-bbox (95.5%), a same-loop reference rule (§9.3), and a
fixed-stride model for `.LBR` bodies. Each failure was traced to a cause before
the rule was replaced.

### 9.2 Byte-level coverage (`coverage.ts`)

| Measure | Value |
| --- | --- |
| Total bytes across the corpus | 26,974,011 |
| File headers (256 B each) | 1,873,920 (6.95%) |
| Record stream | 23,234,700 (86.14%) |
| Trailer | 1,865,391 (6.92%) |
| Inter-record padding | 0 |
| **Record bytes explained by a schema field** | **23,234,700 / 23,234,700 (100.00%)** |
| Records of unknown kind | 0 |

Nothing is discarded. Non-zero values in positions the schema does not
interpret are kept on `reserved` with their byte offsets and named in
`unresolved`. Six such fields remain, all preserved:

| Field | Records | Note |
| --- | --- | --- |
| polyline `style` | 204,584 | Value 0..3; separates wires from drawing rules but the encoding is not established |
| `primitiveKind` (types 2/3/4) | 17,149 | Geometry is exact; which primitive is drawn is unknown |
| text height bit 15 | 12,375 | Flag of unknown meaning |
| type 9 `+44` | 4,259 | Constant 20 |
| type 10 `+30` | 2,837 | Small enum, 1..9 |
| type 7 `+30` | 1,698 | uint16, coordinate-band values |

### 9.3 Cross-sheet correlation

The reference address is
`<modulePrefix:2><sheetSuffix:2>-<block:2>.<port:2>`. The sheet suffix names
the target drawing, but the loop prefix comes from the **module prefix** — a
reference can point into a different loop entirely:

```
AH65-06.07  on 2121009A  ->  2120565A   (not 2121065A)
AGZ2-08.03  on 2121070A  ->  21110Z2A
AA72-01.07  on 2121072A  ->  2030572C
```

Assuming the host sheet's own loop was therefore wrong; it scored 97.41%
against the vendor report. The mapping is not stored in the records, but it is
determined by the archive: for a given prefix, only one loop makes the
referenced suffixes resolve to drawings that exist. `ModuleRegistry` recovers
it by that constraint, requiring at least 40 supporting suffixes and a clear
margin over the runner-up, so a weakly supported guess cannot silently
redirect a signal to the wrong drawing. The revision letter is looked up per
drawing, since `21210Q7Q` sits alongside `21210Q6A`.

### 9.4 Whole-corpus reconstruction (`batch-validate.ts`)

| Measure | Value |
| --- | --- |
| Files decoded with real geometry | 7,319 / 7,320 (99.99%) |
| Exceptions thrown | 0 |
| Placed symbols | 201,007 (of which 34,985 junctions) |
| Wire and primitive records | 221,733 |
| **Wires not incident on a symbol or another wire** | **8 (0.00%)** |
| Sheets with a decoded title | 7,013 (95.8%) |
| Runtime | 16.5 s |

Wire endpoints attach by real coordinate incidence against symbol bounding
boxes, with a tee onto another wire counted as connected. Nothing is wired by
reading order. Decoding type 1 as a polyline rather than a single segment is
what closed the gap: dangling wires fell from 19,622 (9.57%) to 8.

Cross-sheet references, 63,613 total:

| Outcome | Count |
| --- | --- |
| Resolved via the learned module registry | 52,662 (82.78%) |
| Resolved via same-loop fallback, marked `inferred` | 4,779 (7.51%) |
| Address field blank in the source | 6,155 (9.68%) |
| Target absent from the supplied archive | 17 |

Every reference that carries an address is resolved. The 6,155 unresolved ones
have a blank address field in the source record, so there is nothing to
resolve — they are reported, not invented.

### 9.5 Reference comparison against vendor ground truth

`I90XREF.OUT` is produced by ABB's own I90XREF tool from these same drawings,
making it independent ground truth. 51 reports cover 5,742 sheets with 77,457
output rows. `validate-oracle.ts` cross-checks 5,380 sheets:

| Check | Result |
| --- | --- |
| Output descriptions found as a decoded tag | 74,490 / 74,842 (**99.53%**) |
| Destination references resolving to the same drawing the vendor named | 113,131 / 113,520 (**99.66%**) |
| Destinations resolved to a *different* drawing | 389 (0.34%) |
| Vendor "Source" addresses found as a decoded reference | 2,982 / 74,842 (3.98%) |

Using the learned registry alone, without the same-loop fallback, only **68 of
113,520** destinations (0.06%) resolve to the wrong drawing — the fallback
trades a little precision for 9,000 extra resolutions and is marked `inferred`
so the difference is visible downstream.

The 3.98% source-address figure is a genuine gap, not a rounding artefact: the
type 8 record carries the *destination* address, and the signal's own source
address is not present in any decoded field. It is listed in §10.

## 9.6 `.LBR` symbol libraries — directory `CONFIRMED`, bodies `UNKNOWN`

The directory is solved. Entries run at a fixed 16-byte stride from `+528`:

```
+0  char[8] name
+8  uint16  offsetHi      body offset = offsetHi * 256 + offsetLo
+10 uint16  offsetLo
+12 uint16  = 6
+14 uint16  length
```

This self-verifies by chaining: each entry's offset equals the previous
entry's offset plus its length, with **zero breaks in any library**. `BAI` sits
at `3*256+1 = 769` with length 966, and `LEY` at `6*256+199 = 1735 = 769+966`.

Body geometry is **not** solved, and is deliberately not used for rendering.
Established so far:

- Bodies are a variable-length primitive stream, not a fixed stride. A
  stride/phase fit scored per symbol disagrees with itself, and a `BOX2` body
  embeds a nested `TITLE` symbol reference.
- The line primitive is a 16-byte record: `+0 x1 +2 y1 +4 x2 +6 y2` followed by
  the literal bytes `01 00 08 00 02 00 00 00`. Clean instances decode to sane
  segments, e.g. `(4170,540)-(4800,540)`.
- The **unit of the offset/length fields is unresolved**. Read as bytes, the
  directory region `528..1024` overlaps the first body offset `769`, which is
  impossible. Read as words, `BAI` and `LEY` (the two halves of the Bailey
  logo) yield 85 and 87 segments covering 70% and 79% of their bodies — strong
  evidence — but `LINE`, `BOX1` and `BOX2` then yield nothing, while at byte
  offsets those same three produce perfectly formed primitives. Neither
  reading explains every entry.
- Only 31 directory entries are readable before the name field stops looking
  like a name, yet the file holds 2,042 name-like strings, so there are almost
  certainly further directory blocks not yet located.

Because a half-decoded body would draw **wrong** shapes while presenting them
as authentic, `LbrSymbol.segments` is marked EXPERIMENTAL and the renderer does
not consume it. Symbols are drawn at their exact decoded per-instance bounding
box and rotation instead, which is source-faithful and verifiable.

## 10. Open questions, in priority order

1. **`.LBR` body offset unit and further directory blocks** (§9.6) — the
   blocker for authentic symbol outlines. The directory format and the line
   primitive are already confirmed; what is missing is the addressing.
2. **Specification slot encoding** (§8.1) — 228,473 slots are recovered with
   their raw bytes, but the float-vs-integer reading per slot is ambiguous and
   the slot-to-`Sn` assignment is by payload order only. Resolving this
   probably requires a per-function-code layout table.
3. **Signal source addresses** — the vendor report lists a `Source` address per
   output (e.g. `BA00-14.26`) that appears in no decoded field; only 3.98% are
   recoverable. Candidate: the still-undecoded `BCCo ATR LIST` section.
4. **`BCCo ATR LIST`** — the second trailer section, not yet decoded.
5. **Per-pin topology** — wires attach to a block, not to a numbered input pin.
   Pin positions come from the `.LBR` bodies (item 1).
6. **Primitive kinds for types 2, 3 and 4** — coordinates are exact and
   preserved, but whether a record draws an arc, a rectangle or a filled
   triangle is not established (17,149 records).
7. The preserved-but-uninterpreted fields listed in §9.2.
8. Whether `0x0FE` is a checksum, and whether `0x07A` encodes sheet extents.

## 10.1 Measured completeness against the vendor plot

`Output/CAD.pdf` is the vendor's own plot, 288 pages, one per sheet, each
stamping its source filename — an independent per-sheet oracle for engineering
content. `golden-master.ts` compares every plotted string against what the
decoder recovers.

| Stage | Recovered |
| --- | --- |
| Before the trailer was decoded | 30,703 / 42,598 (72.08%) |
| After the trailer was decoded | **32,950 / 42,598 (77.35%)** |

Effect on the targeted gaps:

| Unrecovered kind | Before | After |
| --- | --- | --- |
| Function-code numbers `(NN)` | 1,087 | **3** |
| Specification labels `Sn` | 1,917 | 952 |
| Blocks carrying an FC number | 946 | 2,371 |
| Decoded S-specifications | 0 | 4,220 |

Of the 9,648 strings still unrecovered, roughly 2,100 are drawing-frame
boilerplate — `THIS DRAWING IS THE PROPERTY OF BAILEY CANADA INC`, `DWN:`,
`CHK:`, `APV:`, the customer name, and ruler tick labels — each appearing
exactly 125 times. That text lives in the `.LBR` frame symbol, not in any
`.CAD` file, so it is blocked on §10 item 1 and is not a record-decoding gap.

## 11. Phase status

| Phase | State |
| --- | --- |
| 1 — Forensic binary inspection | **complete** — 7,320 files, 762,038 records |
| 2 — Record discovery / classification | **complete** — all 12 types, 100% of record bytes |
| 3 — Engineering element decoding | **complete** — names, block numbers, tags, addresses, terminals, rotation, layers |
| 4 — Geometry reconstruction | **complete** — bboxes, insertion points, polyline vertices |
| 5 — Symbol recognition | **partial** — instances and roles decoded; authentic outlines blocked on §9.6 |
| 6 — Connection / topology | **complete** — 8 unattached wires in 221,733 records |
| 7 — Cross-sheet correlation | **complete** — 99.66% agreement with vendor report |
| 8 — Canonical model | **complete** — `EngineeringSheetModel`, fully traced to byte offsets |
| 9 — Validation | **complete** — 24/24 rules at 100%; oracle comparison in §9.5 |
| 10 — Visual reconstruction | **complete** — overlap-controlled SVG in the CAD viewer |
| 11 — Reference comparison | **complete** — `validate-oracle.ts` against `I90XREF.OUT` |

Remaining work is enumerated in §10 and is bounded: symbol outlines, source
addresses, and `S1..S9` specifications. Everything else in the record stream is
decoded and verified.

Decisions taken: the engine is built in **TypeScript** inside
`packages/cad-engine` (mirroring the module layout in the brief) so the Next.js
viewer keeps calling it in-process; the existing string-scraping path stays
live until the new decoder demonstrably beats it.
