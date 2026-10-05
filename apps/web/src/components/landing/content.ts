/**
 * Landing-page copy and the sample data behind its figures.
 * Every sample value is taken from the M10 reference module (Guiding Material/Test 2 Data - CAD/M10.zip)
 * as decoded by this application; nothing here is illustrative filler.
 */

export const NAV = [
  { href: "#platform", label: "Platform" },
  { href: "#workflow", label: "Workflow" },
  { href: "#reconstruction", label: "Reconstruction" },
  { href: "#outputs", label: "Outputs" },
  { href: "#validation", label: "Validation" },
] as const;

export const CAPABILITIES = [
  {
    index: "01",
    title: "Legacy data",
    body: "Bus/Module ZIP backups are unpacked and every file is classified — binary CAD sheets, REF, XRF, ERR and OUT listings, and M1 operator graphics.",
    meta: "CAD · REF · XRF · ERR · OUT · M1",
  },
  {
    index: "02",
    title: "Graphics reconstruction",
    body: "M1 operator displays are decoded and redrawn, then exported per category as the original display followed by the same display with its tags marked.",
    meta: "M1 → SVG · PNG · PDF",
  },
  {
    index: "03",
    title: "Logic & connectivity",
    body: "Function blocks and their S1…SN specifications are read from each sheet, and wiring and cross-sheet references are followed to place every I/O point in its loop.",
    meta: "Function codes · specifications · references",
  },
  {
    index: "04",
    title: "Engineering outputs",
    body: "The decoded model is written out as deliverables an engineering team can review offline: workbooks for I/O and loops, and PDF packages for logic and graphics.",
    meta: "XLSX · PDF · SVG",
  },
] as const;

export const WORKFLOW = [
  {
    step: "01",
    title: "Upload",
    body: "A Bailey Bus/Module ZIP, or M1 graphics as files or a ZIP.",
    detail:
      "The controller backup is dropped into the studio. Archive entries are checked for path traversal and oversized files before a single byte is read.",
    items: ["Bus/Module ZIP", ".M1 files", "ZIP of M1"],
  },
  {
    step: "02",
    title: "Decode",
    body: "Binary CAD sheets, cross-reference listings and M1 displays are parsed — never executed.",
    detail:
      "Each CAD sheet is read record by record — function blocks, S1…SN specifications, wiring and text — alongside the REF, XRF, ERR and OUT listings and the M1 display files.",
    items: ["CAD", "REF", "XRF", "ERR", "OUT", "M1"],
  },
  {
    step: "03",
    title: "Reconstruct",
    body: "Sheets are redrawn to SVG and PDF; I/O, loops and function blocks are correlated.",
    detail:
      "Sheets are redrawn from the decoded model, I/O channels are matched to their device tags, and wiring is followed across sheets to group points into loops.",
    items: ["SVG sheets", "Function blocks", "I/O records", "Loops"],
  },
  {
    step: "04",
    title: "Validate",
    body: "Coverage, unresolved references and blank descriptions are reported against their source file.",
    detail:
      "The sheet count is checked against the XRF index. Unresolved inputs and blank descriptions stay attached to the file and sheet they concern instead of being dropped.",
    items: ["XRF coverage", "ERR findings", "Partial mappings"],
  },
  {
    step: "05",
    title: "Export",
    body: "I/O list, loop list, CAD logic PDF and graphics PDFs, generated per session.",
    detail:
      "Deliverables are generated from the session's decoded model on download, so every file reflects exactly what was read from the source.",
    items: ["IO_List.xlsx", "Loop_List.xlsx", "Block_Summary.xlsx", "CAD_Logic.pdf"],
  },
] as const;

/** Sheet 20710A1C.CAD — bytes 0x03D0–0x041F of the original 2,194-byte file. */
export const SOURCE_BYTES = {
  start: 0x03d0,
  hex:
    "2B 10 83 08 08 11 AC 08 4F 52 45 46 20 20 20 20 68 10 98 08 00 00 01 00 20 20 20 20 20 20 20 20 " +
    "20 20 20 20 20 20 20 41 4F 31 2D 32 34 2F 31 33 31 4C 56 33 38 31 41 44 32 34 2D 30 34 2E 30 36 " +
    "00 00 00 00 09 00 19 00 01 00 68 10 6B 08 51 11",
  /** Byte ranges decoded as the OREF record and its reference text. */
  highlight: [
    [0x03d8, 0x03db],
    [0x03f7, 0x040f],
  ],
} as const;

/** Display 421P01.m1 (Fiber Line), counted from its decoded session output. */
export const GRAPHIC_421P01 = {
  file: "421P01.m1",
  bytes: "184,805 bytes",
  records: "3,427 records",
  stats: [
    { value: "171", label: "Tags bound to live fields" },
    { value: "331", label: "Symbol instances from 35 templates" },
    { value: "323", label: "Lines and rectangles" },
    { value: "100%", label: "Of file bytes assigned to a record" },
  ],
  tagKinds: [
    { code: "HS", label: "Hand switches · pumps & valves", count: 66 },
    { code: "FC", label: "Flow controllers", count: 29 },
    { code: "II", label: "Current indicators", count: 29 },
    { code: "LC", label: "Level controllers", count: 15 },
    { code: "Other", label: "Level, consistency, temperature, …", count: 32 },
  ],
} as const;

/** Function blocks decoded from the same sheet. */
export const DECODED_BLOCKS = [
  { block: "59", fc: "80", name: "Control Station", symbol: "M/A-M" },
  { block: "66", fc: "66", name: "Analog Trend", symbol: "TREND" },
  { block: "2880", fc: "19", name: "PID (PV and SP)", symbol: "DELPID" },
  { block: "2881", fc: "40", name: "OR (4-Input)", symbol: "OR4" },
  { block: "5110", fc: "15", name: "Summer (2-Input)", symbol: "SUM" },
  { block: "5111", fc: "2", name: "Manual Set Constant", symbol: "A" },
] as const;

/** Loop 131FC-163, resolved through CAD wiring. */
export const LOOP_TRACE = {
  loopTag: "131FC-163",
  description: "POLYMER DILUTION WATER FLOW",
  input: { kind: "AI", tag: "131FT163", sheet: "2071003C.CAD", slave: "3", channel: "9" },
  station: { block: "578", fc: "80", name: "Control Station", sheet: "2071078C.CAD" },
  output: { kind: "AO", tag: "131FV163", sheet: "2071015C.CAD", slave: "15", channel: "13" },
} as const;

/** Back faces of the flip cards; every value is read from the M10 / 421P01 reference sessions. */
export const FLIP_DETAILS = {
  source: {
    kicker: "A · Legacy source",
    title: "What the highlighted bytes are",
    rows: [
      ["File", "20710A1C.CAD · M10"],
      ["Size", "2,194 bytes · binary"],
      ["Record", "OREF · offset 0x03D8"],
      ["Text", "AO1-24/131LV381AD24-04.06"],
      ["Text bytes", "0x03F7–0x040F"],
    ],
  },
  model: {
    kicker: "B · Decoded model",
    title: "55 spec values on 6 blocks",
    rows: [
      ["PID 2880 · S1", "4403 · PV input"],
      ["PID 2880 · S2", "60 · set point"],
      ["PID · P / I / D", "1.14999 · 0.300003 · 0.115"],
      ["PID · S9 / S10", "105 / -5 · limits"],
      ["Station 59", "31 specs · FC 80"],
    ],
  },
  sheet: {
    kicker: "C · Reconstructed sheet",
    title: "Redrawn, not traced",
    rows: [
      ["Vector paths", "564"],
      ["Text labels", "205"],
      ["Frame", "Zones 02–32 kept"],
      ["Formats", "SVG · CAD_Logic.pdf"],
      ["Followed by", "S1…SN block table"],
    ],
  },
  graphic: {
    kicker: "Fig. 02 · 421P01.m1",
    title: "Inside the decoded display",
    rows: [
      ["Decoder", "m1-decoder/1.1.0 · SHA-256 6faa2641…"],
      ["Records · links", "3,427 · 3,426"],
      ["Strings · groups · transforms", "7,389 · 20 · 276"],
      ["Fields", "15,097 known · 9,716 candidate · 2,050 unresolved"],
      ["Templates", "35 external · 331 instances"],
      ["Most used", "toba_pv_dec2 ×61 · Toba_TagName_white ×35 · toba_ctrl_vlv_co ×28"],
      ["Outputs", "Original + tag-marked · SVG · PNG · PDF"],
    ],
  },
  loop: {
    kicker: "Loop 131FC-163",
    title: "Every hop, with its source",
    rows: [
      ["Input record", "AI 131FT163 · 2071003C.CAD · slave 3 · ch 9"],
      ["Station", "Block 578 · FC 80 Control Station (M/A-M)"],
      ["Station specs", "S10 span 100 · S11 zero 0"],
      ["Also on 2071078C.CAD", "PID 2012 · Analog Transfer 2013 · OR 2014 · NOT 2015 · Trend 364"],
      ["Output record", "AO 131FV163 · 2071015C.CAD · slave 15 · ch 13"],
      ["IO_List.xlsx", "2 records share loop tag 131FC-163"],
      ["Loop_List.xlsx", "1 row · input AI 131FT163 · output AO 131FV163"],
    ],
  },
} as const;

/** Lineage of loop 131FC-163 in the M10 reference session; every value is from its outputs. */
export const LINEAGE = [
  {
    stage: "Source",
    value: "2071003C.CAD",
    detail: "AI slave 3 · channel 9",
    explain: "The binary CAD sheet that wires the field signal into the controller. Nothing downstream is entered by hand.",
    evidence: [
      ["File", "2071003C.CAD"],
      ["Card", "Analog input · slave 3"],
      ["Channel", "9"],
      ["Sheet blocks", "FC 132 Analog Input/Slave"],
    ],
  },
  {
    stage: "Object",
    value: "131FT163",
    detail: "Analog input · POLYMER DILUTION WATER FLOW",
    explain: "The I/O record decoded from that channel, kept with the sheet, slave and channel it was read from.",
    evidence: [
      ["Device", "131FT163"],
      ["Type", "AI"],
      ["Description", "POLYMER DILUTION WATER FLOW"],
      ["Written to", "IO_List.xlsx"],
    ],
  },
  {
    stage: "Tag",
    value: "131FC-163",
    detail: "Loop tag read from the CAD label",
    explain: "The loop tag is taken from the label drawn on the sheet. The output side of the loop carries the same tag on another sheet.",
    evidence: [
      ["Loop tag", "131FC-163"],
      ["Input", "AI 131FT163 · 2071003C.CAD"],
      ["Output", "AO 131FV163 · 2071015C.CAD"],
      ["AO channel", "Slave 15 · channel 13"],
    ],
  },
  {
    stage: "Logic",
    value: "FC 80 · block 578",
    detail: "Control Station on 2071078C.CAD, reached through wiring",
    explain: "Wiring and cross-sheet references are followed from the I/O point to the function block that carries the loop.",
    evidence: [
      ["Block", "578"],
      ["Function code", "80 · Control Station (M/A-M)"],
      ["Sheet", "2071078C.CAD"],
      ["PV span · zero", "S10 = 100 · S11 = 0"],
    ],
  },
  {
    stage: "Output",
    value: "Loop_List.xlsx",
    detail: "AI 131FT163 paired with AO 131FV163",
    explain: "Input and output devices of the loop are written to one row of the loop list template.",
    evidence: [
      ["$(TAG)", "131FC-163"],
      ["$(NAME40_1)", "POLYMER DILUTION WATER FLOW"],
      ["$(CARDTYPE1) · $(DEVICETAG1)", "AI · 131FT163"],
      ["$(CARDTYPE2) · $(DEVICETAG2)", "AO · 131FV163"],
    ],
  },
] as const;

export const OUTPUTS = [
  {
    title: "CAD output",
    file: "CAD_Logic.pdf",
    body: "Every logic sheet reconstructed from the binary CAD file, followed by the S1…SN specification table of each function block. Individual sheets are also available as SVG.",
  },
  {
    title: "Graphics output",
    file: "M1 graphics · PDF per category",
    body: "Decoded operator displays, grouped by category. Each graphic is two pages: the original, then the same graphic with its tags marked.",
  },
  {
    title: "Logic specification extraction",
    file: "Function blocks · logic report PDF",
    body: "Block number, function code, description and every specification value per sheet, with a summary of block types across all CAD files.",
  },
  {
    title: "Loop tag mapping",
    file: "Loop_List.xlsx · IO_List.xlsx",
    body: "AI, AO, DI and DO channels mapped to device tags and CAD sheets, and grouped into loops with input and output devices on separate rows.",
  },
] as const;

/** Sample sheets copied verbatim from the M10 reference session's generated outputs. */
export type SampleSheet = {
  id: string;
  tab: string;
  file: string;
  /** Columns that hold tags are emphasised. */
  tagColumns: number[];
  /** Free-text columns that may wrap so the sheet fits without horizontal scrolling. */
  wrapColumns: number[];
  columns: string[];
  rows: string[][];
  note: string;
};

export const OUTPUT_SHEETS: SampleSheet[] = [
  {
    id: "io",
    tab: "IO List",
    file: "IO_List.xlsx",
    tagColumns: [5],
    wrapColumns: [6],
    columns: ["CAD", "Type", "Ch", "Slave", "Device", "Loop tag", "Description"],
    rows: [
      ["2071003C.CAD", "AI", "1", "3", "131LT103", "131LI-103", "HcL AND NaOH TANK LEVEL"],
      ["2071003C.CAD", "AI", "2", "3", "131AT104", "131AI-104", "TREATMENT EFFLUENT pH INLET"],
      ["2071003C.CAD", "AI", "7", "3", "131FT155", "131FI-155", "SLUDGE PRESS INLET SLUDGE FLOW"],
      ["2071003C.CAD", "AI", "10", "3", "131LT171", "131LI-171", "PRIM SLUGE PRESS POLYMER MIX TANK"],
      ["2071003C.CAD", "AI", "11", "3", "131LT173", "131LI-173", "POLYMER STORAGE TANK 116 LEVEL"],
      ["2071003C.CAD", "AI", "12", "SL3", "131SC-120", "131SC-120", "SPEED CONTROL M120"],
      ["2071005C.CAD", "DI", "1", "5A", "131ZSH121", "131ZAH-121", "PRIM CLAR No 1 RAKE LIFT POSISITION"],
      ["2071005C.CAD", "DI", "2", "5B", "131ZSO153", "131HS-153", "SLUDGE THICKNER RAKE PUMP No1 SHUTOFF"],
      ["2071005C.CAD", "DI", "3", "5A", "131LSL123A", "131LAL-123A", "PRIM CLAR No 1 REDUCER OIL LEVEL"],
      ["2071009C.CAD", "DO", "1", "9B", "131XY-M506mc", "131HS-M506", "No.1 DEFORMER #1"],
      ["2071009C.CAD", "DO", "2", "9A", "131XY-M102mc", "131HS-M102", "PRIM CLAR No 1 RAKE DRIVES A&B"],
      ["2071009C.CAD", "DO", "2", "9B", "131XY-M107mc", "131HS-M107", "SLUDGE THICKNER DRIVES"],
      ["2071015C.CAD", "AO", "2", "15", "131SY-M117", "131SC-M117", "POLYMER TANK METERING SPEED PUMP"],
      ["2071015C.CAD", "AO", "10", "15", "131AV104C", "131AC-104C", "NAOH INLET CONTROL VALVE EFF."],
      ["2071015C.CAD", "AO", "13", "15", "131FV163", "131FC-163", "POLYMER DILUTION WATER FLOW"],
    ],
    note: "{shown} of 428 I/O records — 79 AI, 32 AO, 221 DI and 96 DO channels, each with its CAD sheet, slave and channel. Spellings are kept as found in the source.",
  },
  {
    id: "loop",
    tab: "Loop List",
    file: "Loop_List.xlsx",
    tagColumns: [1],
    wrapColumns: [0],
    columns: ["$(NAME40_1)", "$(TAG)", "$(CARDTYPE1)", "$(DEVICETAG1)", "$(CARDTYPE2)", "$(DEVICETAG2)"],
    rows: [
      ["SEC TREATMENT pH ACID/NaOH", "131AC-211A", "AI", "131AT211", "AO", "131AV211A"],
      ["SEC TREATMENT pH", "131AC-450A", "AI", "131AT0450", "AO", "131AV0450A"],
      ["DEEP TK 1 DISSOLVED OXYGEN METER", "131AI-554", "AI", "131AT-554", "", ""],
      ["POLYMER DILUTION WATER FLOW", "131FC-163", "AI", "131FT163", "AO", "131FV163"],
      ["NUTRIENT CONTROL FLOW", "131FC-312", "AI", "131FT-312", "AO", "131FV-312"],
      ["SEC CLARIFIER No 2 WASTE SLUDGE  F", "131FC-427", "AI", "131FT0427", "AO", "131FV0427"],
      ["POLYMER SPEED CONTROL", "131FI-511", "AI", "131ST-511", "AO", "131SV-511"],
      ["SLUDGE THICKNER RAKE PUMP No1 SHUTOFF", "131HS-153", "DI", "131ZSC153", "DO", "131HV153"],
      ["SLUDGE THICKNER RAKE PUMP No1 SHUTOFF", "131HS-153", "DI", "131ZSO153", "DO", "131HV153"],
      ["SLUDGE THICKNER PUMP SHUTOFF", "131HS-156", "DI", "131ZSC156", "DO", "131HV156"],
      ["PRIM CLAR 1 SUMP PUMP LEVEL", "131HS-180A", "DI", "131ZSO180A", "DO", "131HV180A"],
      ["PRIM CLAR 2 SUMP PUMP LEVEL", "131HS-180B", "DI", "131ZSO180B", "DO", "131HV180B"],
      ["PRIM CLAR No 1 RAKE DRIVES A&B", "131HS-M102", "DI", "131XS-M102f", "DO", "131XY-M102mc"],
      ["PRIM CLAR No 1 RAKE DRIVES A&B", "131HS-M102", "DI", "131XS-M102rf", "DO", "131XY-M102mc"],
      ["PRIM CLAR No 1 RAKE DRIVES A&B", "131HS-M102", "DI", "131XS102", "DO", "131XY-M102mc"],
    ],
    note: "{shown} of 342 loop rows, 6 of the 17 template columns. Input and output devices of a loop share a row; a loop with several inputs, like 131HS-M102, takes one row per input.",
  },
  {
    id: "logic",
    tab: "Logic",
    file: "Logic report · 20710A1C.CAD",
    tagColumns: [],
    wrapColumns: [2, 5],
    columns: ["Block", "FC", "Function", "Spec", "Value", "Description"],
    rows: [
      ["2880", "19", "PID (PV and SP)", "S1", "4403", "Block address of process variable input"],
      ["2880", "19", "PID (PV and SP)", "S2", "60", "Block address of set point"],
      ["2880", "19", "PID (PV and SP)", "S3", "59", "Block address of track reference signal"],
      ["2880", "19", "PID (PV and SP)", "S4", "61", "Block address of track switch signal"],
      ["2880", "19", "PID (PV and SP)", "S5", "9", "(K) gain multiplier"],
      ["2880", "19", "PID (PV and SP)", "S6", "1.14999", "(Kp) proportional constant"],
      ["2880", "19", "PID (PV and SP)", "S7", "0.300003", "(Ki) integral constant (1/min)"],
      ["2880", "19", "PID (PV and SP)", "S8", "0.115", "(Kd) derivative constant (min)"],
      ["2880", "19", "PID (PV and SP)", "S9", "105", "High output limit"],
      ["2880", "19", "PID (PV and SP)", "S10", "-5", "Low output limit"],
      ["2880", "19", "PID (PV and SP)", "S11", "0", "Set point change"],
      ["2880", "19", "PID (PV and SP)", "S12", "1", "Controller action on error"],
      ["5110", "15", "Summer (2-Input)", "S3", "-1", "Gain parameter of first input"],
      ["5110", "15", "Summer (2-Input)", "S4", "1", "Gain parameter of second input"],
      ["5111", "2", "Manual Set Constant", "S1", "100", "Output value in engineering units"],
    ],
    note: "Specifications of PID block 2880, summer 5110 and constant 5111, read from the binary sheet and described from the Function Code Application Manual. Values are stored exactly as decoded.",
  },
];

export const VALIDATION = [
  {
    title: "Source coverage",
    body: "The number of CAD sheets in the package is checked against the count expected by the XRF cross-reference index. A mismatch is reported, not absorbed.",
  },
  {
    title: "Object integrity",
    body: "Blank descriptions noted in the XRF listing are flagged, and I/O records still missing a loop tag or description are counted as partial mappings.",
  },
  {
    title: "Relationship validation",
    body: "Unresolved inputs listed in the ERR file are carried through to the sheet they affect, and remain open until resolved.",
  },
  {
    title: "Output verification",
    body: "Every I/O record is retained in the outputs. Loop rows are built from tagged records only, and the original values are preserved as text.",
  },
] as const;

/** Messages produced by the validation pass on the M10 reference module. */
export const VALIDATION_LOG = [
  { level: "info", source: "I90XREF.XRF", message: "CAD coverage OK: 245 sheets match XRF" },
  { level: "warn", source: "I90XREF.XRF", message: "Blank description in 20710Z1C.CAD" },
  { level: "error", source: "I90XREF.ERR", message: "Unresolved input AO2FB-SL15/131SV-M122 in 20710I9C.CAD" },
] as const;
