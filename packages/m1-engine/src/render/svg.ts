import type { DrawOp, Layout } from "./layout";
import { hexOf } from "./palette";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n2 = (v: number) => (Math.round(v * 100) / 100).toString();

function opToSvg(o: DrawOp): string {
  if (o.op === "path") {
    const d = o.points.map((p, i) => `${i ? "L" : "M"}${n2(p[0])} ${n2(p[1])}`).join("") + (o.closed ? "Z" : "");
    const fill = o.fill ? `fill="${hexOf(o.fill)}"${o.fillAlpha < 1 ? ` fill-opacity="${o.fillAlpha}"` : ""}` : `fill="none"`;
    const stroke = o.stroke ? ` stroke="${hexOf(o.stroke)}" stroke-width="${n2(o.strokeWidth)}"${o.dash ? ` stroke-dasharray="${o.dash.map(n2).join(" ")}"` : ""}` : "";
    return `<path data-obj="${o.objectId}" d="${d}" ${fill}${stroke} stroke-linejoin="miter"/>`;
  }
  if (o.op === "text") {
    const baseline = o.baseline === "middle" ? "central" : o.baseline === "top" ? "hanging" : "auto";
    const tf = o.scaleX !== 1 && Number.isFinite(o.scaleX) ? ` transform="translate(${n2(o.at[0])} ${n2(o.at[1])}) scale(${n2(o.scaleX)} 1) translate(${n2(-o.at[0])} ${n2(-o.at[1])})"` : "";
    return `<text data-obj="${o.objectId}" x="${n2(o.at[0])}" y="${n2(o.at[1])}" font-family="Arial, Helvetica, sans-serif" font-size="${n2(o.size)}"${o.bold ? ` font-weight="bold"` : ""} text-anchor="${o.anchor}" dominant-baseline="${baseline}" fill="${hexOf(o.color)}"${tf}>${esc(o.text)}</text>`;
  }
  const [x, y] = o.at;
  const lines = [o.templateName, o.label].filter(Boolean) as string[];
  return (
    `<g data-obj="${o.objectId}" class="placeholder">` +
    `<path d="M${n2(x - 4)} ${n2(y)}H${n2(x + 4)}M${n2(x)} ${n2(y - 4)}V${n2(y + 4)}" stroke="#ff00ff" stroke-width="1"/>` +
    lines.map((l, i) => `<text x="${n2(x + 5)}" y="${n2(y - 2 - (lines.length - 1 - i) * 9)}" font-family="Consolas, monospace" font-size="8" fill="#ff66ff">${esc(l)}</text>`).join("") +
    `</g>`
  );
}

export function renderSvg(layout: Layout, opts: { marking?: boolean; debug?: boolean; title?: string } = {}): string {
  const body = layout.ops.map(opToSvg).join("\n");
  const dbg = opts.debug ? `\n<g id="source-debug">\n${layout.debug.map(opToSvg).join("\n")}\n</g>` : "";
  const marks = opts.marking ? `\n<g id="marking-tags">\n${layout.marking.map(opToSvg).join("\n")}\n</g>` : "";
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">\n` +
    (opts.title ? `<title>${esc(opts.title)}</title>\n` : "") +
    `<rect width="100%" height="100%" fill="${hexOf(layout.background)}"/>\n` +
    `<g id="graphics">\n${body}\n</g>${dbg}${marks}\n</svg>\n`
  );
}
