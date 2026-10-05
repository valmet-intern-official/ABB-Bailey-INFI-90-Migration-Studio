// Summary statistics of an extraction run.
//   npx tsx tools/fb-spec/stats.ts <module dir> <module name>
import fs from "node:fs";
import path from "node:path";
import { extractModule } from "../../packages/fb-spec/src/extract";
import { reconstructModule } from "../../packages/cad-engine/src/reconstruct/pipeline";

const [dir, name] = process.argv.slice(2);
const cads = fs.readdirSync(dir).filter((n) => /\.cad$/i.test(n)).sort().map((n) => ({ name: n, data: fs.readFileSync(path.join(dir, n)) }));
const t0 = Date.now();
const rec = reconstructModule({ cads, extractDir: dir });
const t1 = Date.now();
const r = extractModule({ module: name, moduleType: rec.moduleHeader?.moduleType ?? null, sheets: rec.sheets.map((s) => ({ drawing: s.drawing, data: cads.find((c) => c.name === s.filename)!.data })) });
const t2 = Date.now();
const count = <T,>(xs: T[], k: (x: T) => string) => xs.reduce<Record<string, number>>((a, x) => ((a[k(x)] = (a[k(x)] ?? 0) + 1), a), {});
console.log(`reconstruct ${t1 - t0} ms, extract ${t2 - t1} ms; module type ${r.module.module_type}; executive ${r.module.executive_block}`);
console.log("blocks", r.blocks.length, count(r.blocks, (b) => b.status), count(r.blocks, (b) => b.layout_status));
console.log("specs", r.specifications.length, count(r.specifications, (s) => s.status));
console.log("address", count(r.specifications.filter((s) => s.address_resolution), (s) => s.address_resolution!.status));
console.log("pins", count(r.blocks.flatMap((b) => b.pins), (p) => p.evidence));
console.log("connections", r.connections.length, count(r.connections, (c) => `${c.kind}:${c.status}`));
console.log("spec_check", count(r.connections.filter((c) => c.spec_check), (c) => String(c.spec_check!.agrees)));
console.log("diagnostics", count(r.diagnostics, (d) => `${d.code}/${d.severity}`));
console.log("unknown FC", r.unknown_function_codes.map((u) => `${u.function_code}(${u.blocks.length})`).join(" "));
console.log("segments", count(r.blocks, (b) => String(b.segment.segment_block)));
for (const d of r.diagnostics.filter((d) => d.severity === "error").slice(0, 12)) console.log("  !", d.code, d.file ?? "", d.message);
const wu = r.specifications.filter((s) => s.wired_from.length && s.address_resolution?.status === "UNRESOLVED");
console.log("wired unresolved", wu.length, count(wu, (s) => s.wired_from.map((w) => (w.source_block == null ? "no-source" : w.source_address == null ? `label-unknown` : "ok")).join("+")));
const lu = wu.flatMap((s) => s.wired_from).filter((w) => w.source_block != null && w.source_address == null);
const fcOf = new Map(r.blocks.map((b) => [b.block_address, b.function_code]));
console.log("label-unknown driver FCs", count(lu, (w) => String(fcOf.get(w.source_block!))));
console.log("FC81 blocks", r.blocks.filter((b) => b.function_code === 81).map((b) => `${b.file}#${b.block_address}`));
const nz = r.connections.filter((c) => c.spec_check && !c.spec_check.agrees && c.spec_check.value !== 0);
console.log("spec_check disagree with non-zero value:", nz.length);
for (const c of nz.slice(0, 10)) console.log("  nz", c.file, c.source_block, c.source_terminal, "->", c.target_block, c.target_terminal, JSON.stringify(c.spec_check));
const miss = r.connections.filter((c) => c.spec_check && !c.spec_check.agrees).slice(0, 8);
for (const c of miss) console.log("  x", c.file, c.source_block, c.source_terminal, "->", c.target_block, c.target_terminal, JSON.stringify(c.spec_check));
