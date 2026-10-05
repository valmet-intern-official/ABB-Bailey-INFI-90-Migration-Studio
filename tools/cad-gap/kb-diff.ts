import fs from "node:fs";

type Sym = { title: string | null; inputs: string[]; outputs: string[]; items: unknown[] };
type K = { function_codes: Array<{ function_code: number; symbol: Sym; specifications: unknown[] }> };
const a = JSON.parse(fs.readFileSync(process.argv[2], "utf8")) as K;
const b = JSON.parse(fs.readFileSync(process.argv[3], "utf8")) as K;
const bm = new Map(b.function_codes.map((f) => [f.function_code, f]));
let changed = 0;
for (const fa of a.function_codes) {
  const fb = bm.get(fa.function_code);
  if (!fb) { console.log(`FC${fa.function_code} REMOVED`); continue; }
  const s = (x: Sym) => `title=${x.title} in=[${x.inputs.join(",")}] out=[${x.outputs.join(",")}] items=${x.items.length}`;
  const specs = fa.specifications.length !== fb.specifications.length ? ` SPECS ${fa.specifications.length}->${fb.specifications.length}` : "";
  if (s(fa.symbol) !== s(fb.symbol) || specs) {
    changed++;
    console.log(`FC${fa.function_code}${specs}\n  before ${s(fa.symbol)}\n  after  ${s(fb.symbol)}`);
  }
}
console.log(`changed: ${changed}`);
