/**
 * Structural analysis of the .LBR symbol libraries.
 *
 * The libraries hold the authentic symbol outlines the CAD sheets only
 * reference by name, so decoding them is what replaces bounding boxes with
 * real engineering symbols.
 */
import fs from "node:fs";
import path from "node:path";
import { ascii, lbrCorpus, stringRuns } from "./lib/walk";

const HEADER_GUESS = 256;

for (const file of lbrCorpus()) {
  const buf = fs.readFileSync(file);
  console.log("=".repeat(96));
  console.log(`${path.basename(file)}  ${buf.length} bytes`);
  console.log("=".repeat(96));

  // Header
  console.log("header (first 128 bytes):");
  for (let i = 0; i < 128; i += 16) {
    const row = buf.subarray(i, i + 16);
    console.log(
      `  +${String(i).padStart(3)}  ${[...row].map((b) => b.toString(16).padStart(2, "0")).join(" ")}  |${ascii(row)}|`
    );
  }

  // Where do 8-byte padded names live? In the CAD files they are at +14 of a
  // record; here we look for the directory structure instead.
  const names = stringRuns(buf, 3).filter((r) => /^[A-Z][A-Z0-9/_.\-+=()#]{1,7}$/i.test(r.text.trim()));
  console.log(`\nname-like strings: ${names.length}`);
  console.log("  first 24:");
  for (const n of names.slice(0, 24)) {
    console.log(`    @${String(n.at).padStart(6)}  "${n.text}"`);
  }

  // Are name entries evenly spaced? A fixed stride means a symbol directory.
  const deltas = new Map<number, number>();
  for (let i = 1; i < Math.min(names.length, 600); i++) {
    const d = names[i].at - names[i - 1].at;
    deltas.set(d, (deltas.get(d) ?? 0) + 1);
  }
  console.log(
    `\n  gaps between consecutive names: ${[...deltas]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([d, c]) => `${d}(x${c})`)
      .join(" ")}`
  );

  // Try the CAD record grammar from a few plausible starts.
  for (const start of [0, 128, 256, 512]) {
    let off = start;
    let ok = 0;
    const types = new Map<number, number>();
    while (off + 4 <= buf.length) {
      if (buf.readUInt16LE(off) === 0) {
        off += 2;
        continue;
      }
      const t = buf.readUInt16LE(off);
      const lw = buf.readUInt16LE(off + 2);
      if (lw < 4 || t > 64 || off + lw * 2 > buf.length) break;
      types.set(t, (types.get(t) ?? 0) + 1);
      ok++;
      off += lw * 2;
    }
    console.log(
      `  grammar from +${start}: ${ok} records, stopped at ${off}/${buf.length} ` +
        `(${((off / buf.length) * 100).toFixed(1)}%)  types=${[...types]
          .sort((a, b) => a[0] - b[0])
          .map(([t, c]) => `${t}:${c}`)
          .join(",")}`
    );
  }
  console.log();
}
