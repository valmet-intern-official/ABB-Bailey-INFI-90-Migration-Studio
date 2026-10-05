import type { DrawOp, Layout } from "./layout";
import type { RGB } from "./palette";

const f = (v: number) => (Math.round(v * 100) / 100).toString();
const rgb = ([r, g, b]: RGB) => `${f(r / 255)} ${f(g / 255)} ${f(b / 255)}`;

/** WinAnsi-safe literal string. Non-Latin-1 characters become '?'. */
function pdfString(s: string): string {
  let out = "(";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === "(" || ch === ")" || ch === "\\") out += "\\" + ch;
    else if (c < 32 || c > 255) out += "?";
    else if (c > 126) out += "\\" + c.toString(8).padStart(3, "0");
    else out += ch;
  }
  return out + ")";
}

/** Helvetica advance widths are not embedded; this estimate only drives alignment. */
const approxWidth = (text: string, size: number, bold: boolean) => text.length * size * (bold ? 0.58 : 0.54);

function content(ops: DrawOp[], h: number): string {
  const y = (v: number) => h - v;
  const out: string[] = [];
  for (const o of ops) {
    if (o.op === "path") {
      if (o.points.length < 2) continue;
      const d = o.points.map((p, i) => `${f(p[0])} ${f(y(p[1]))} ${i ? "l" : "m"}`).join(" ") + (o.closed ? " h" : "");
      out.push("q");
      if (o.fillAlpha < 1) out.push("/GSHalf gs");
      if (o.fill) {
        out.push(`${rgb(o.fill)} rg ${d} f`);
      }
      if (o.fillAlpha < 1) out.push("/GSFull gs");
      if (o.stroke) {
        out.push(`${rgb(o.stroke)} RG ${f(o.strokeWidth)} w ${o.dash ? `[${o.dash.map(f).join(" ")}] 0 d` : "[] 0 d"} ${d} S`);
      }
      out.push("Q");
    } else if (o.op === "text") {
      const w = approxWidth(o.text, o.size, o.bold) * o.scaleX;
      const x = o.anchor === "middle" ? o.at[0] - w / 2 : o.anchor === "end" ? o.at[0] - w : o.at[0];
      const by = o.baseline === "middle" ? o.at[1] + o.size * 0.35 : o.baseline === "top" ? o.at[1] + o.size * 0.8 : o.at[1];
      out.push(`BT /${o.bold ? "F2" : "F1"} ${f(o.size)} Tf ${f(o.scaleX * 100)} Tz ${rgb(o.color)} rg ${f(x)} ${f(y(by))} Td ${pdfString(o.text)} Tj ET`);
    } else {
      const [px, py] = o.at;
      out.push(`q 1 0 1 RG 1 w ${f(px - 4)} ${f(y(py))} m ${f(px + 4)} ${f(y(py))} l ${f(px)} ${f(y(py - 4))} m ${f(px)} ${f(y(py + 4))} l S Q`);
      const lines = [o.templateName, o.label].filter(Boolean) as string[];
      lines.forEach((l, i) => {
        out.push(`BT /F3 8 Tf 100 Tz 1 0.4 1 rg ${f(px + 5)} ${f(y(py - 2 - (lines.length - 1 - i) * 9))} Td ${pdfString(l)} Tj ET`);
      });
    }
  }
  return out.join("\n");
}

export function renderPdf(layout: Layout, opts: { marking?: boolean; debug?: boolean; title?: string } = {}): Buffer {
  const W = layout.width;
  const H = layout.height;
  const stream =
    `${rgb(layout.background)} rg 0 0 ${W} ${H} re f\n` +
    content(layout.ops, H) +
    (opts.debug ? "\n" + content(layout.debug, H) : "") +
    (opts.marking ? "\n" + content(layout.marking, H) : "");
  const objs: string[] = [];
  objs.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  objs.push(`<< /Type /Pages /Kids [3 0 R] /Count 1 >>`);
  objs.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> /ExtGState << /GSHalf 8 0 R /GSFull 9 0 R >> >> >>`
  );
  objs.push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
  objs.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
  objs.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`);
  objs.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>`);
  objs.push(`<< /Type /ExtGState /ca 0.5 >>`);
  objs.push(`<< /Type /ExtGState /ca 1 >>`);
  const info = opts.title ? `<< /Title ${pdfString(opts.title)} /Producer (infi90 m1-engine) >>` : `<< /Producer (infi90 m1-engine) >>`;
  objs.push(info);

  let body = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${objs.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
