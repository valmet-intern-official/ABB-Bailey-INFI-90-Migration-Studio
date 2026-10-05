import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
const files = fs.readdirSync(dir).filter((f) => /\.m1$/i.test(f)).sort();
const re = /[A-Za-z_][A-Za-z0-9_]*\+\0/g;
const totals = new Map();
for (const f of files) {
  const buf = fs.readFileSync(path.join(dir, f));
  const s = buf.toString("latin1");
  const counts = new Map();
  let m;
  while ((m = re.exec(s))) {
    const prev = m.index > 0 ? buf[m.index - 1] : 0;
    const name = m[0].slice(0, -1);
    const key = prev === 0 ? name : `${name}(prev=${prev.toString(16)})`;
    counts.set(key, (counts.get(key) || 0) + 1);
    totals.set(key, (totals.get(key) || 0) + 1);
  }
  console.log(f, buf.length, JSON.stringify(Object.fromEntries([...counts].sort())));
}
console.log("TOTAL", JSON.stringify(Object.fromEntries([...totals].sort()), null, 1));
