import fs from "node:fs";

const [file, startArg, countArg, filter] = process.argv.slice(2);
const buf = fs.readFileSync(file);
const s = buf.toString("latin1");
const re = /(?<=\0)[A-Za-z_][A-Za-z0-9_]*\+\0/g;
const marks = [];
let m;
while ((m = re.exec(s))) marks.push({ off: m.index, name: m[0].slice(0, -1) });
const start = Number(startArg || 0);
const count = Number(countArg || marks.length);
let shown = 0;
for (let i = 0; i < marks.length && shown < count; i++) {
  if (i < start) continue;
  const a = marks[i];
  if (filter && !new RegExp(filter).test(a.name)) continue;
  const end = i + 1 < marks.length ? marks[i + 1].off : buf.length;
  const body = buf.subarray(a.off + a.name.length + 1, end);
  const hex = [...body].map((b) => b.toString(16).padStart(2, "0")).join(" ");
  const asc = [...body].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("");
  console.log(`#${i} @${a.off.toString(16)} ${a.name} len=${end - a.off}\n  ${hex}\n  ${asc}`);
  shown++;
}
