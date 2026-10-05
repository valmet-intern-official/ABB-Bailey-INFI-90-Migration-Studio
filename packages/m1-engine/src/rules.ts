export type RuleStatus = "PROVEN" | "CANDIDATE";

export interface FormatRule {
  id: string;
  area: "binary" | "objects" | "geometry" | "style" | "text" | "bindings" | "view" | "templates";
  statement: string;
  status: RuleStatus;
  evidence: string;
  test: string;
}

/**
 * Every rule the decoder or renderer relies on. PROVEN rules are enforced by
 * an assertion over the whole supplied corpus; CANDIDATE rules are consistent
 * with the corpus but rest on interpretation (e.g. visual comparison).
 */
export const RULES: FormatRule[] = [
  { id: "RULE-MAGIC-001", area: "binary", status: "PROVEN", statement: "Files start with the 8-byte magic 'm1gms4u\\n' followed by three u32 (0x10, 1, 0); header length is 20 bytes.", evidence: "All 10 corpus files.", test: "binary.test.ts › RULE-MAGIC-001 magic and header" },
  { id: "RULE-REC-001", area: "binary", status: "PROVEN", statement: "After the header the file is a gap-free sequence of records [u32 preamble][ClassName '+\\0'][body].", evidence: "Record boundaries tile every file exactly; 0 gaps, 0 overlaps.", test: "binary.test.ts › RULE-REC-001 records tile the file" },
  { id: "RULE-REC-002", area: "binary", status: "PROVEN", statement: "The record preamble is 0 for every class except PtArray, where it equals 2 × point count.", evidence: "All PtArray records; all other records have preamble 0.", test: "binary.test.ts › RULE-REC-002 preamble" },
  { id: "RULE-FIELD-001", area: "binary", status: "PROVEN", statement: "Every byte of every record is assigned to a typed field (no residual bytes).", evidence: "Field-level coverage = 100 % on all 10 files.", test: "binary.test.ts › RULE-FIELD-001 typed fields tile every record" },
  { id: "RULE-ID-001", area: "objects", status: "PROVEN", statement: "Object id = record ordinal + 1; ids are allocated breadth-first in stream order, so every first reference to an unseen id equals the next free id.", evidence: "0 allocation violations over all references in 10 files.", test: "objects.test.ts › RULE-ID-001 breadth-first allocation" },
  { id: "RULE-HDR-001", area: "objects", status: "PROVEN", statement: "Shared object header: u32 dynPropRef | u32 transformRef | u32 slot2Ref | u16 flags | cstr name | cstr name2 | u32.", evidence: "Decodes every non-leaf record with exact field tiling.", test: "binary.test.ts › RULE-FIELD-001 (header decoding must tile every record)" },
  { id: "RULE-HDR-002", area: "objects", status: "PROVEN", statement: "Header slot 0 is a reference to a G_DynProp_30 (0 = none).", evidence: "All 6 nonzero values point at G_DynProp_30; treating it as a reference removes all orphans.", test: "objects.test.ts › RULE-HDR-002 slot 0 targets / no orphans" },
  { id: "RULE-REF-001", area: "objects", status: "PROVEN", statement: "Each reference role targets a single class family (e.g. geometry → PtArray/Point, transform → Scal2d/Mat2x3, property → G_StrConst_30/G_IntConst_30).", evidence: "Role/target histogram over all files.", test: "objects.test.ts › RULE-REF-001 reference roles" },
  { id: "RULE-GEOM-001", area: "geometry", status: "PROVEN", statement: "Coordinates in PtArray/Point are signed 16.16 fixed point, y-up; menu content spans [0,100]×[0,75].", evidence: "Menu background rectangle (1.2,1)–(99.2,74).", test: "geometry.test.ts › RULE-GEOM-001 fixed point + menu background" },
  { id: "RULE-XF-001", area: "geometry", status: "CANDIDATE", statement: "Scal2d = f64[tx, ty, sx, sy]; x' = sx·x + tx/65536, y' = sy·y + ty/65536.", evidence: "Menu buttons land on a 4.0-unit grid; rendered equipment registers with the reference.", test: "geometry.test.ts › RULE-XF-001 Scal2d + 4-unit grid" },
  { id: "RULE-XF-002", area: "geometry", status: "CANDIDATE", statement: "Mat2x3 = f64[a, b, tx, c, d, ty]; x' = a·x + b·y + tx/65536, y' = c·x + d·y + ty/65536.", evidence: "Grouped shading rectangles register with the reference.", test: "geometry.test.ts › RULE-XF-002 Mat2x3" },
  { id: "RULE-SHAPE-001", area: "geometry", status: "CANDIDATE", statement: "G_Rect/G_TRect use 2 corner points; G_Circ uses centre + circumference point; G_Sect uses centre + start point with f64 start/sweep degrees; G_Line/G_Spline are point lists.", evidence: "Sector start angle equals atan2 of (start − centre) (226.4°).", test: "geometry.test.ts › RULE-SHAPE-001 sector start angle" },
  { id: "RULE-STYLE-001", area: "style", status: "CANDIDATE", statement: "Primitive style block: u32 lineColor, u16 lineStyle, f32 lineWidth, u32 fillColor, u16 fillStyle, u32 fillPattern, u16 0x2710, u16 filled. Colours are palette indices.", evidence: "0x2710 constant in every record; calibrated colours agree across files.", test: "geometry.test.ts › RULE-STYLE-001 0x2710 constant" },
  { id: "RULE-STYLE-002", area: "style", status: "CANDIDATE", statement: "fillStyle 2 is a 50 % dither of the fill colour (rendered as mean tone).", evidence: "Reference shows checkered fills where fillStyle = 2.", test: "(visual: reference comparison only)" },
  { id: "RULE-TEXT-001", area: "text", status: "CANDIDATE", statement: "Text height is 16.16 units scaled by the transform's y scale; hAlign 1 = left, 2 = centre.", evidence: "TRect labels centred; Text labels register with the reference.", test: "(visual: reference comparison only)" },
  { id: "RULE-BIND-001", area: "bindings", status: "PROVEN", statement: "Instance expression '%#1#% NAME \"value\" … %#1#%' defines parameters; property keys with $NAME$ expand to the stored value.", evidence: "Every $…$ key expands exactly to its stored value.", test: "semantics.test.ts › RULE-BIND-001 key expansion" },
  { id: "RULE-TPL-001", area: "templates", status: "PROVEN", statement: "ModInst template geometry is not stored in these M1 files (no definition records exist); templates are external dependencies.", evidence: "No record class carries template geometry; Marker _FP$SN_ lists external symbols.", test: "semantics.test.ts › RULE-TPL-001 external templates" },
  { id: "RULE-VIEW-001", area: "view", status: "CANDIDATE", statement: "Display extent = [0,100]×[0,75] unioned with content (process pages reach x≈108).", evidence: "Reference windows fit exactly this extent.", test: "(visual: reference comparison only)" },
  { id: "RULE-VIEW-002", area: "view", status: "CANDIDATE", statement: "The viewer fits the extent uniformly into the client area.", evidence: "Measured 12.09 vs 12.11 px/unit on the 1302 reference.", test: "(visual: reference comparison only)" },
];
