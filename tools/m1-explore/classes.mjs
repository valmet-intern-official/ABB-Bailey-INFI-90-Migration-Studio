import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
const KNOWN = new Set([
  "Model", "Marker", "ModInst", "Group", "FillGroup", "Text", "LinkRef", "Point", "PtArray",
  "Mat2x3", "Scal2d", "G_Line_30", "G_Rect_30", "G_Circ_30", "G_Sect_30", "G_Spline_30",
  "G_TRect_30", "G_StrConst_30", "G_IntConst_30", "G_VarRef_30", "G_DynProp_30", "G_EVap_30",
  "G_Svap_30", "G_Cvap_30", "G_Action_30X", "G_FctnCall_30", "G_UnExpr_30", "G_RelExpr_30", "Z2",
]);
const stats = new Map();
for (const f of fs.readdirSync(dir).filter((x) => /\.m1$/i.test(x)).sort()) {
  const buf = fs.readFileSync(path.join(dir, f));
  const s = buf.toString("latin1");
  const re = /(?<=\0)([A-Za-z_][A-Za-z0-9_]*)\+\0/g;
  const marks = [];
  let m;
  while ((m = re.exec(s))) if (KNOWN.has(m[1])) marks.push({ off: m.index, name: m[1] });
  for (let i = 0; i < marks.length; i++) {
    const a = marks[i];
    const pre = a.off >= 4 ? buf.readUInt32LE(a.off - 4) : -1;
    const end = i + 1 < marks.length ? marks[i + 1].off - 4 : buf.length;
    const bodyLen = end - (a.off + a.name.length + 2);
    const st = stats.get(a.name) || { n: 0, pre: new Map(), len: new Map() };
    st.n++;
    st.pre.set(pre, (st.pre.get(pre) || 0) + 1);
    st.len.set(bodyLen, (st.len.get(bodyLen) || 0) + 1);
    stats.set(a.name, st);
  }
}
for (const [name, st] of [...stats].sort()) {
  const pre = [...st.pre].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join(" ");
  const len = [...st.len].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}:${v}`).join(" ");
  console.log(`${name.padEnd(15)} n=${st.n}\n   pre[${pre}]\n   bodyLen[${len}] distinct=${st.len.size}`);
}
