import {
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFPage,
  PDFRef,
  StandardFonts,
  rgb,
  type PDFFont,
  type RGB,
} from "pdf-lib";
import type { CorrelatedProject } from "@infi90/core";
import type { CadLogic, SheetLogicBlock } from "@/lib/function-blocks";

const W = 595.28;
const H = 841.89;
const MARGIN = 40;
const CONTENT = W - MARGIN * 2;
const TOP = H - 62;
const BOTTOM = 52;

const GREEN = rgb(0.122, 0.478, 0.302);
const GREEN_DARK = rgb(0.078, 0.325, 0.2);
const INK = rgb(0.13, 0.16, 0.15);
const MUTED = rgb(0.4, 0.45, 0.42);
const SOFT = rgb(0.914, 0.953, 0.929);
const ZEBRA = rgb(0.968, 0.98, 0.972);
const LINE = rgb(0.8, 0.85, 0.82);
const WHITE = rgb(1, 1, 1);

const CELL_SIZE = 7.5;
const CELL_LH = 9.6;
const PAD_X = 4;
const PAD_Y = 3.5;

type Align = "left" | "right" | "center";

interface Column {
  title: string;
  /** Share of the content width. */
  width: number;
  align?: Align;
}

interface Cell {
  text: string;
  bold?: boolean;
  color?: RGB;
}

type Row = Array<string | Cell>;

interface TableOptions {
  caption?: string;
  captionRight?: string;
  onRow?: (index: number, page: PDFPage, top: number, bottom: number) => void;
}

function safe(text: string | null | undefined): string {
  return (text ?? "").replace(/[^\x20-\x7e\xa0-\xff]/g, " ").replace(/\s+/g, " ").trim();
}

class Layout {
  readonly pages: PDFPage[] = [];
  readonly outline: Array<{ title: string; page: PDFPage }> = [];
  private readonly deferred: Array<() => void> = [];
  page!: PDFPage;
  y = TOP;
  running = "";

  constructor(
    readonly doc: PDFDocument,
    readonly font: PDFFont,
    readonly bold: PDFFont,
    readonly title: string
  ) {}

  cover(): PDFPage {
    this.page = this.doc.addPage([W, H]);
    this.pages.push(this.page);
    return this.page;
  }

  newPage() {
    this.page = this.doc.addPage([W, H]);
    this.pages.push(this.page);
    this.page.drawRectangle({ x: 0, y: H - 34, width: W, height: 34, color: GREEN });
    this.draw(this.title, MARGIN, H - 21, { size: 9, font: this.bold, color: WHITE });
    if (this.running) {
      this.draw(this.running, W - MARGIN, H - 21, { size: 8, color: WHITE, align: "right", maxWidth: CONTENT * 0.55 });
    }
    this.y = TOP;
  }

  ensure(height: number): boolean {
    if (this.y - height >= BOTTOM) return false;
    this.newPage();
    return true;
  }

  later(fn: () => void) {
    this.deferred.push(fn);
  }

  bookmark(title: string) {
    this.outline.push({ title: safe(title), page: this.page });
  }

  width(text: string, size: number, font = this.font) {
    return font.widthOfTextAtSize(text, size);
  }

  fit(text: string, size: number, max: number, font = this.font): string {
    let s = safe(text);
    if (this.width(s, size, font) <= max) return s;
    while (s.length > 1 && this.width(`${s}...`, size, font) > max) s = s.slice(0, -1);
    return `${s.trimEnd()}...`;
  }

  wrap(text: string, size: number, max: number, font = this.font): string[] {
    const out: string[] = [];
    for (const para of (text || "-").split(/;\s*/)) {
      const words = safe(para).split(" ").filter(Boolean);
      let line = "";
      for (let word of words) {
        while (this.width(word, size, font) > max) {
          let cut = word.length - 1;
          while (cut > 1 && this.width(word.slice(0, cut), size, font) > max) cut--;
          if (line) {
            out.push(line);
            line = "";
          }
          out.push(word.slice(0, cut));
          word = word.slice(cut);
        }
        const next = line ? `${line} ${word}` : word;
        if (this.width(next, size, font) <= max) line = next;
        else {
          out.push(line);
          line = word;
        }
      }
      if (line) out.push(line);
    }
    return out.length ? out : ["-"];
  }

  draw(
    text: string,
    x: number,
    y: number,
    opts: { size?: number; font?: PDFFont; color?: RGB; align?: Align; maxWidth?: number; page?: PDFPage } = {}
  ) {
    const size = opts.size ?? 9;
    const font = opts.font ?? this.font;
    const s = opts.maxWidth ? this.fit(text, size, opts.maxWidth, font) : safe(text);
    const w = this.width(s, size, font);
    const dx = opts.align === "right" ? -w : opts.align === "center" ? -w / 2 : 0;
    (opts.page ?? this.page).drawText(s, { x: x + dx, y, size, font, color: opts.color ?? INK });
  }

  gap(n: number) {
    this.y -= n;
  }

  section(number: string, title: string) {
    this.running = title;
    this.newPage();
    this.bookmark(`${number}  ${title}`);
    this.draw(number, MARGIN, this.y - 14, { size: 15, font: this.bold, color: GREEN });
    this.draw(title, MARGIN + 26, this.y - 14, { size: 15, font: this.bold, color: INK });
    this.y -= 22;
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: W - MARGIN, y: this.y }, thickness: 1.2, color: GREEN });
    this.y -= 14;
  }

  paragraph(text: string, size = 8.5, color = MUTED) {
    for (const line of this.wrap(text, size, CONTENT)) {
      this.ensure(size + 4);
      this.draw(line, MARGIN, this.y - size, { size, color });
      this.y -= size + 3.5;
    }
    this.y -= 6;
  }

  band(left: string, right: string) {
    this.ensure(22 + 16 + 20);
    this.page.drawRectangle({ x: MARGIN, y: this.y - 22, width: CONTENT, height: 22, color: GREEN_DARK });
    this.draw(left, MARGIN + 8, this.y - 15, { size: 10, font: this.bold, color: WHITE, maxWidth: CONTENT * 0.66 });
    this.draw(right, W - MARGIN - 8, this.y - 15, { size: 8, color: WHITE, align: "right" });
    this.y -= 30;
  }

  table(columns: Column[], rows: Row[], opts: TableOptions = {}) {
    const widths = columns.map((c) => c.width * CONTENT);
    const cells = (row: Row) => row.map((c) => (typeof c === "string" ? { text: c } : c));
    const layout = rows.map((row) => {
      const cs = cells(row);
      const lines = cs.map((c, i) =>
        c.text === "" ? [""] : this.wrap(c.text, CELL_SIZE, widths[i] - PAD_X * 2, c.bold ? this.bold : this.font)
      );
      const height = Math.max(...lines.map((l) => l.length)) * CELL_LH + PAD_Y * 2;
      return { cs, lines, height };
    });
    const headH = 17;
    const capH = opts.caption ? 18 : 0;
    let segTop = 0;

    const caption = (continued: boolean) => {
      if (!opts.caption) return;
      this.page.drawRectangle({ x: MARGIN, y: this.y - capH, width: CONTENT, height: capH, color: SOFT });
      this.page.drawRectangle({ x: MARGIN, y: this.y - capH, width: 3, height: capH, color: GREEN });
      this.draw(`${opts.caption}${continued ? "  (continued)" : ""}`, MARGIN + 9, this.y - 12, {
        size: 8.5,
        font: this.bold,
        color: GREEN_DARK,
        maxWidth: CONTENT * 0.7,
      });
      if (opts.captionRight) {
        this.draw(opts.captionRight, W - MARGIN - 8, this.y - 12, { size: 7.5, color: MUTED, align: "right", maxWidth: CONTENT * 0.28 });
      }
      this.y -= capH;
    };
    const header = () => {
      segTop = this.y;
      this.page.drawRectangle({ x: MARGIN, y: this.y - headH, width: CONTENT, height: headH, color: GREEN });
      let x = MARGIN;
      columns.forEach((c, i) => {
        const tx = c.align === "right" ? x + widths[i] - PAD_X : c.align === "center" ? x + widths[i] / 2 : x + PAD_X;
        this.draw(c.title, tx, this.y - 11.5, { size: 7.5, font: this.bold, color: WHITE, align: c.align });
        x += widths[i];
      });
      this.y -= headH;
    };
    const closeSegment = () => {
      const bottom = this.y;
      let x = MARGIN;
      for (let i = 0; i < widths.length - 1; i++) {
        x += widths[i];
        this.page.drawLine({ start: { x, y: segTop - headH }, end: { x, y: bottom }, thickness: 0.4, color: LINE });
      }
      this.page.drawRectangle({
        x: MARGIN,
        y: bottom,
        width: CONTENT,
        height: segTop - bottom,
        borderColor: LINE,
        borderWidth: 0.6,
      });
    };

    const first = layout[0]?.height ?? CELL_LH + PAD_Y * 2;
    this.ensure(capH + headH + first);
    caption(false);
    header();
    layout.forEach((row, index) => {
      if (this.y - row.height < BOTTOM) {
        closeSegment();
        this.newPage();
        caption(true);
        header();
      }
      const top = this.y;
      if (index % 2 === 1) {
        this.page.drawRectangle({ x: MARGIN, y: top - row.height, width: CONTENT, height: row.height, color: ZEBRA });
      }
      let x = MARGIN;
      row.cs.forEach((c, i) => {
        const col = columns[i];
        const font = c.bold ? this.bold : this.font;
        row.lines[i].forEach((line, k) => {
          const ly = top - PAD_Y - CELL_SIZE - k * CELL_LH + 1;
          const tx = col.align === "right" ? x + widths[i] - PAD_X : col.align === "center" ? x + widths[i] / 2 : x + PAD_X;
          this.draw(line, tx, ly, { size: CELL_SIZE, font, color: c.color ?? INK, align: col.align });
        });
        x += widths[i];
      });
      this.y -= row.height;
      this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: W - MARGIN, y: this.y }, thickness: 0.4, color: LINE });
      opts.onRow?.(index, this.page, top, this.y);
    });
    if (layout.length === 0) {
      this.draw("No entries", MARGIN + PAD_X, this.y - 11, { size: CELL_SIZE, color: MUTED });
      this.y -= 16;
    }
    closeSegment();
    this.y -= 14;
  }

  link(page: PDFPage, rect: [number, number, number, number], target: PDFPage) {
    const ctx = this.doc.context;
    const annot = ctx.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: rect,
      Border: [0, 0, 0],
      Dest: [target.ref, PDFName.of("XYZ"), PDFNull, PDFNull, PDFNull],
    });
    page.node.addAnnot(ctx.register(annot));
  }

  finish(generated: string) {
    for (const fn of this.deferred) fn();
    const total = this.pages.length;
    this.pages.forEach((page, i) => {
      if (i === 0) return;
      page.drawLine({ start: { x: MARGIN, y: 36 }, end: { x: W - MARGIN, y: 36 }, thickness: 0.5, color: LINE });
      this.draw(this.title, MARGIN, 24, { size: 7.5, color: MUTED, page });
      this.draw(`Generated ${generated}`, W / 2, 24, { size: 7.5, color: MUTED, align: "center", page });
      this.draw(`Page ${i + 1} of ${total}`, W - MARGIN, 24, { size: 7.5, color: MUTED, align: "right", page });
    });
    this.writeOutline();
  }

  private writeOutline() {
    if (this.outline.length === 0) return;
    const ctx = this.doc.context;
    const root = ctx.nextRef();
    const refs: PDFRef[] = this.outline.map(() => ctx.nextRef());
    this.outline.forEach((entry, i) => {
      const dict = ctx.obj({
        Title: PDFHexString.fromText(entry.title),
        Parent: root,
        Dest: [entry.page.ref, PDFName.of("XYZ"), PDFNull, PDFNull, PDFNull],
        ...(i > 0 ? { Prev: refs[i - 1] } : {}),
        ...(i < refs.length - 1 ? { Next: refs[i + 1] } : {}),
      });
      ctx.assign(refs[i], dict);
    });
    ctx.assign(root, ctx.obj({ Type: "Outlines", First: refs[0], Last: refs[refs.length - 1], Count: refs.length }));
    this.doc.catalog.set(PDFName.of("Outlines"), root);
    this.doc.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
  }
}

const SPEC_COLUMNS: Column[] = [
  { title: "Spec", width: 0.065 },
  { title: "Type", width: 0.055, align: "center" },
  { title: "Value", width: 0.12 },
  { title: "Description", width: 0.33 },
  { title: "Meaning of value", width: 0.18 },
  { title: "Default", width: 0.09 },
  { title: "Range", width: 0.16 },
];

const BLOCK_COLUMNS: Column[] = [
  { title: "Block", width: 0.1, align: "right" },
  { title: "FC", width: 0.08, align: "right" },
  { title: "Function", width: 0.42 },
  { title: "Symbol", width: 0.26 },
  { title: "S values", width: 0.14, align: "right" },
];

function differsFromDefault(value: string | null, def: string): boolean {
  if (value == null || !def) return false;
  const a = Number(value);
  const b = Number(def);
  if (Number.isFinite(a) && Number.isFinite(b)) return a !== b;
  return safe(value).toUpperCase() !== safe(def).toUpperCase();
}

function blockCaption(b: SheetLogicBlock): string {
  return [`Block ${b.block}`, `FC ${b.functionCode ?? "-"}`, b.name || "No manual description"].join("  |  ");
}

/** A4 portrait PDF of every CAD sheet's function blocks and S values, laid out as tables. */
export async function buildLogicReport(project: CorrelatedProject, logic: CadLogic): Promise<Uint8Array> {
  const moduleName = safe(project.meta.module || project.meta.name) || "Module";
  const title = `${moduleName} Logic Report`;
  const generated = new Date().toISOString().slice(0, 10);

  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setSubject("Function blocks and specification values per CAD sheet");
  doc.setProducer("ABB Bailey INFI 90 Migration Studio");
  doc.setCreator("ABB Bailey INFI 90 Migration Studio");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const L = new Layout(doc, font, bold, title);

  const sheets = project.cadSheets.map((s, i) => {
    const blocks = logic[s.filename.toUpperCase()] ?? [];
    return {
      no: i + 1,
      filename: s.filename,
      title: safe(s.title),
      blocks,
      specs: blocks.reduce((n, b) => n + b.specs.length, 0),
    };
  });
  const withLogic = sheets.filter((s) => s.blocks.length > 0);
  const withoutLogic = sheets.filter((s) => s.blocks.length === 0);
  const blockCount = sheets.reduce((n, s) => n + s.blocks.length, 0);
  const specCount = sheets.reduce((n, s) => n + s.specs, 0);
  const changed = sheets.reduce(
    (n, s) => n + s.blocks.reduce((m, b) => m + b.specs.filter((x) => differsFromDefault(x.value, x.default)).length, 0),
    0
  );

  const fcUsage = new Map<number, { name: string; blocks: number; sheets: Set<string> }>();
  for (const s of sheets) {
    for (const b of s.blocks) {
      if (b.functionCode == null) continue;
      const u = fcUsage.get(b.functionCode) ?? { name: b.name ?? "", blocks: 0, sheets: new Set<string>() };
      u.blocks++;
      u.sheets.add(s.filename);
      if (!u.name && b.name) u.name = b.name;
      fcUsage.set(b.functionCode, u);
    }
  }

  const sheetPage = new Map<string, PDFPage>();

  // Cover
  const cover = L.cover();
  L.bookmark("Cover");
  cover.drawRectangle({ x: 0, y: H - 300, width: W, height: 300, color: GREEN });
  cover.drawRectangle({ x: 0, y: H - 306, width: W, height: 6, color: GREEN_DARK });
  L.draw("ABB BAILEY INFI 90 MIGRATION STUDIO", MARGIN, H - 80, { size: 9, font: bold, color: rgb(0.8, 0.92, 0.85) });
  L.draw("Logic Report", MARGIN, H - 150, { size: 34, font: bold, color: WHITE });
  L.draw(`Module ${moduleName}`, MARGIN, H - 182, { size: 15, color: WHITE });
  L.draw("Function blocks and specification values by CAD sheet", MARGIN, H - 206, { size: 10, color: rgb(0.85, 0.94, 0.89) });
  L.draw(`Generated ${generated}`, MARGIN, H - 270, { size: 9, color: WHITE });
  L.y = H - 340;

  L.table(
    [
      { title: "Project information", width: 0.35 },
      { title: "", width: 0.65 },
    ],
    [
      ["Module", { text: moduleName, bold: true }],
      ["Project", safe(project.meta.name) || "-"],
      ...(project.meta.loop ? [["Loop", safe(String(project.meta.loop))] as Row] : []),
      ["Report date", generated],
      ["Source", "Function block specifications read from the CAD sheets"],
    ]
  );
  L.table(
    [
      { title: "Summary", width: 0.35 },
      { title: "Count", width: 0.2, align: "right" },
      { title: "", width: 0.45 },
    ],
    [
      ["CAD sheets", String(sheets.length), ""],
      ["Sheets with function blocks", String(withLogic.length), ""],
      ["Sheets without function blocks", String(withoutLogic.length), withoutLogic.length ? "Listed in Appendix A" : ""],
      ["Function blocks", String(blockCount), ""],
      ["Function codes in use", String(fcUsage.size), ""],
      ["Specification values (S)", String(specCount), ""],
      ["Values different from default", String(changed), "Shown in bold in the tables"],
    ]
  );

  const contents: Array<{ label: string; page?: PDFPage }> = [
    { label: "1   Sheet index" },
    { label: "2   Function code usage" },
    { label: "3   Sheet details" },
    ...(withoutLogic.length ? [{ label: "A   Sheets without function blocks" }] : []),
  ];
  L.table(
    [
      { title: "Contents", width: 0.85 },
      { title: "Page", width: 0.15, align: "right" },
    ],
    contents.map((c) => [c.label, ""]),
    {
      onRow: (i, page, top, bottom) => {
        L.later(() => {
          const target = contents[i].page;
          if (!target) return;
          L.draw(String(L.pages.indexOf(target) + 1), W - MARGIN - PAD_X, bottom + PAD_Y + 1.5, { size: CELL_SIZE, page, align: "right" });
          L.link(page, [MARGIN, bottom, W - MARGIN, top], target);
        });
      },
    }
  );

  // 1 Sheet index
  L.section("1", "Sheet index");
  contents[0].page = L.page;
  L.paragraph("Every CAD sheet in the module with its function block and S value count. Select a row to go to that sheet.");
  L.table(
    [
      { title: "No.", width: 0.07, align: "right" },
      { title: "CAD sheet", width: 0.18 },
      { title: "Title", width: 0.47 },
      { title: "Blocks", width: 0.09, align: "right" },
      { title: "S values", width: 0.1, align: "right" },
      { title: "Page", width: 0.09, align: "right" },
    ],
    sheets.map((s) => [
      String(s.no),
      { text: s.filename, bold: s.blocks.length > 0 },
      s.title || "-",
      s.blocks.length ? String(s.blocks.length) : "-",
      s.specs ? String(s.specs) : "-",
      "",
    ]),
    {
      onRow: (i, page, top, bottom) => {
        L.later(() => {
          const target = sheetPage.get(sheets[i].filename);
          if (!target) return;
          L.draw(String(L.pages.indexOf(target) + 1), W - MARGIN - PAD_X, bottom + PAD_Y + 1.5, { size: CELL_SIZE, page, align: "right" });
          L.link(page, [MARGIN, bottom, W - MARGIN, top], target);
        });
      },
    }
  );

  // 2 Function code usage
  L.section("2", "Function code usage");
  contents[1].page = L.page;
  L.paragraph("Function codes used in the module, with the number of blocks and sheets for each.");
  L.table(
    [
      { title: "FC", width: 0.08, align: "right" },
      { title: "Function", width: 0.62 },
      { title: "Blocks", width: 0.15, align: "right" },
      { title: "Sheets", width: 0.15, align: "right" },
    ],
    [...fcUsage.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([fc, u]) => [{ text: String(fc), bold: true }, u.name || "No manual description", String(u.blocks), String(u.sheets.size)])
  );

  // 3 Sheet details
  L.section("3", "Sheet details");
  contents[2].page = L.page;
  L.paragraph(
    "For each sheet: a summary of its function blocks, then one table per block listing the S values from the CAD with the function code manual description, default and range. Values in bold differ from the default."
  );
  withLogic.forEach((s) => {
    L.running = `Sheet details  |  ${s.filename}`;
    L.band(`${s.filename}${s.title ? `   ${s.title}` : ""}`, `Sheet ${s.no} of ${sheets.length}  |  ${s.blocks.length} blocks  |  ${s.specs} S values`);
    sheetPage.set(s.filename, L.page);
    L.bookmark(s.filename);
    L.table(
      BLOCK_COLUMNS,
      s.blocks.map((b) => [
        { text: String(b.block), bold: true },
        b.functionCode != null ? String(b.functionCode) : "-",
        b.name || "No manual description",
        b.symbol || "-",
        String(b.specs.length),
      ]),
      { caption: "Function blocks on this sheet" }
    );
    for (const b of s.blocks) {
      if (b.specs.length === 0) {
        L.table([{ title: "Specification", width: 1 }], [[{ text: "No specification values recorded in the CAD", color: MUTED }]], {
          caption: blockCaption(b),
          captionRight: b.symbol ? `Symbol ${b.symbol}` : undefined,
        });
        continue;
      }
      L.table(
        SPEC_COLUMNS,
        b.specs.map((x) => {
          const diff = differsFromDefault(x.value, x.default);
          return [
            { text: x.label, bold: true, color: GREEN_DARK },
            x.type || "-",
            { text: x.value ?? "-", bold: diff, color: diff ? GREEN_DARK : INK },
            x.description || "-",
            x.meaning || "-",
            x.default || "-",
            x.range || "-",
          ];
        }),
        { caption: blockCaption(b), captionRight: b.symbol ? `Symbol ${b.symbol}` : undefined }
      );
    }
  });

  if (withoutLogic.length) {
    L.section("A", "Sheets without function blocks");
    contents[3].page = L.page;
    L.paragraph("These CAD sheets carry no function blocks, for example title, termination or wiring sheets.");
    L.table(
      [
        { title: "No.", width: 0.08, align: "right" },
        { title: "CAD sheet", width: 0.22 },
        { title: "Title", width: 0.7 },
      ],
      withoutLogic.map((s) => [String(s.no), s.filename, s.title || "-"]),
      {
        onRow: (i, page) => {
          if (!sheetPage.has(withoutLogic[i].filename)) sheetPage.set(withoutLogic[i].filename, page);
        },
      }
    );
  }

  L.finish(generated);
  return doc.save();
}
