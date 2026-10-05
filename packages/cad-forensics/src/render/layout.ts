/**
 * Monospaced text flow for portrait report pages (block detail pages, annex).
 * Links are recorded against symbolic keys and resolved to page indices once
 * every page of the document exists.
 */
import { COURIER_ADVANCE, type RenderItem as Item } from "@infi90/cad-engine";

export const A4P_W = 595;
export const A4P_H = 842;

export interface KeyLink {
  rect: [number, number, number, number];
  key: string;
}

export interface FlowPage {
  items: Item[];
  links: KeyLink[];
  label: string;
}

export interface Anchor {
  /** Index within this flow's pages. */
  page: number;
  y: number;
}

export interface Col {
  text: string;
  width: number;
}

export class Flow {
  readonly pages: FlowPage[] = [];
  readonly anchors = new Map<string, Anchor>();
  private y = 0;
  private readonly top = A4P_H - 40;
  private readonly bottom = 34;
  readonly left = 30;
  readonly size: number;
  readonly lh: number;
  private section = "";

  constructor(private readonly title: string, size = 5.6) {
    this.size = size;
    this.lh = size * 1.22;
  }

  get maxChars(): number {
    return Math.floor((A4P_W - 2 * this.left) / (COURIER_ADVANCE * this.size));
  }

  private get page(): FlowPage {
    if (!this.pages.length) this.newPage();
    return this.pages[this.pages.length - 1];
  }

  newPage(): void {
    const label = `${this.title}${this.section ? ` - ${this.section}` : ""}`;
    const p: FlowPage = { items: [], links: [], label };
    this.pages.push(p);
    p.items.push({ t: "text", x: this.left, y: A4P_H - 24, size: 6.5, angle: 0, text: label, cls: "report-header", src: "report" });
    p.items.push({ t: "text", x: A4P_W - this.left, y: 18, size: 5, angle: 0, text: `${this.title} p.${this.pages.length}`, anchor: "end", cls: "report-footer", src: "report" });
    p.items.push({ t: "path", pts: [[this.left, A4P_H - 28], [A4P_W - this.left, A4P_H - 28]], w: 0.3, cls: "report-rule", src: "report" });
    this.y = this.top;
  }

  setSection(name: string): void {
    this.section = name;
  }

  /** Start a new page unless `lines` more lines fit. */
  ensure(lines: number): void {
    if (!this.pages.length || this.y - lines * this.lh < this.bottom) this.newPage();
  }

  anchor(key: string): void {
    this.ensure(1);
    this.anchors.set(key, { page: this.pages.length - 1, y: Math.min(A4P_H, this.y + this.lh * 2) });
  }

  gap(lines = 0.6): void {
    this.y -= this.lh * lines;
  }

  heading(text: string, size = 7.5, src = "report"): void {
    this.ensure(4);
    this.y -= size * 0.6;
    this.page.items.push({ t: "text", x: this.left, y: this.y - size, size, angle: 0, text, cls: "report-heading", src });
    this.y -= size * 1.35;
  }

  /** One logical line; wrapped at the page width, continuation indented. */
  line(text: string, opts: { indent?: number; link?: string; src?: string; rgb?: [number, number, number]; cls?: string } = {}): void {
    const indent = opts.indent ?? 0;
    const width = this.maxChars - indent;
    const parts = wrap(text, width, 2);
    parts.forEach((part, i) => {
      this.ensure(1);
      const x = this.left + (indent + (i ? 2 : 0)) * COURIER_ADVANCE * this.size;
      this.y -= this.lh;
      this.page.items.push({ t: "text", x, y: this.y, size: this.size, angle: 0, text: part, cls: opts.cls ?? "report-line", src: opts.src ?? "report", rgb: opts.rgb });
      if (opts.link) this.page.links.push({ key: opts.link, rect: [x, this.y - 1.2, x + part.length * COURIER_ADVANCE * this.size, this.y + this.size * 0.85] });
    });
  }

  /** Fixed-width columns; each cell wraps inside its column. */
  row(cols: Col[], opts: { indent?: number; link?: string; src?: string; rgb?: [number, number, number] } = {}): void {
    const cells = cols.map((c) => wrap(c.text, Math.max(1, c.width - 1), 0));
    const n = Math.max(1, ...cells.map((c) => c.length));
    for (let i = 0; i < n; i++) {
      const text = cols.map((c, j) => (cells[j][i] ?? "").padEnd(c.width)).join("").trimEnd();
      this.line(text, { indent: opts.indent, link: i === 0 ? opts.link : undefined, src: opts.src, rgb: opts.rgb });
    }
  }
}

/** Hard wrap preserving every character (no trimming of content). */
export function wrap(text: string, width: number, contIndent: number): string[] {
  const out: string[] = [];
  let rest = text.replace(/[\r\n\t]+/g, " ");
  let w = width;
  while (rest.length > w) {
    let cut = rest.lastIndexOf(" ", w);
    if (cut < w * 0.5) cut = w;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^ /, "");
    w = Math.max(8, width - contIndent);
  }
  out.push(rest);
  return out;
}
