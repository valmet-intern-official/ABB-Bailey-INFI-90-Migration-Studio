// Compares the manual spec-type sequence of each function code against the
// trailer payload size observed in the census, for candidate type widths.
//   npx tsx tools/fc-manual/layout-closure.ts
import fs from "node:fs";
import path from "node:path";
import { KB } from "../../packages/function-codes/src/generated/kb";

const byCode = new Map(KB.function_codes.map((s) => [s.function_code, s]));
const census = new Map<number, number[]>();
const raw = fs.readFileSync(path.join(__dirname, "cache/census.txt"));
const text = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString("utf16le").slice(1) : raw.toString("utf8");
for (const line of text.split(/\r?\n/)) {
  const m = /^FC\s+(\d+):\s+(.+)$/.exec(line);
  if (m) census.set(+m[1], [...m[2].matchAll(/(\d+)B x\d+/g)].map((x) => +x[1]));
}

const candidates: Record<string, Record<string, number>> = {
  "B=1": { I: 2, R: 4, B: 1, INT: 2 },
  "B=2": { I: 2, R: 4, B: 2, INT: 2 },
};
for (const [name, w] of Object.entries(candidates)) {
  let ok = 0;
  const bad: string[] = [];
  for (const [fc, sizes] of census) {
    const schema = byCode.get(fc);
    if (!schema) continue;
    const types = schema.specifications.map((s) => s.type);
    const size = types.reduce((a, t) => a + (w[t] ?? NaN), 0);
    if (sizes.length === 1 && sizes[0] === size) ok++;
    else bad.push(`FC${fc} manual=${size} (${types.join("")}) cad=${sizes.join("/")}`);
  }
  console.log(`${name}: closed ${ok}/${ok + bad.length}`);
  for (const b of bad) console.log("   " + b);
}
const unknown = [...census.keys()].filter((fc) => !byCode.has(fc));
console.log(`census codes without manual schema: ${unknown.join(", ") || "none"}`);
