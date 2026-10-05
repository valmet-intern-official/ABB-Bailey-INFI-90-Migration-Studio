import { allFunctionCodes } from "../../packages/function-codes/src/index.ts";

let same = 0, prefix = 0, other = 0, empty = 0;
const rows: string[] = [];
for (const s of allFunctionCodes()) {
  const sym = s.symbol.inputs.filter((l) => /^S\d+$/.test(l));
  const ba = s.specifications.filter((p) => p.is_block_address).map((p) => p.label);
  if (!sym.length && !ba.length) { empty++; continue; }
  const eq = sym.join(",") === ba.join(",");
  const isPrefix = !eq && sym.length < ba.length && ba.slice(0, sym.length).join(",") === sym.join(",");
  if (eq) same++;
  else if (isPrefix) { prefix++; rows.push(`PREFIX FC${s.function_code} sym=${sym.length} ba=${ba.length} missing=${ba.slice(sym.length).join(",")}`); }
  else { other++; rows.push(`DIFF   FC${s.function_code} sym=[${sym.join(",")}] ba=[${ba.join(",")}]`); }
}
console.log({ same, prefix, other, empty });
console.log(rows.join("\n"));
