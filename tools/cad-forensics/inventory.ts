/** Where every .CAD / .LBR file lives, and which are byte-identical duplicates. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { findFiles } from "./lib/walk";

for (const [label, re] of [
  ["CAD", /\.CAD$/i],
  ["LBR", /\.LBR$/i],
] as const) {
  const files = findFiles(".", re);
  console.log(`\n${"=".repeat(90)}\n${label}: ${files.length} files\n${"=".repeat(90)}`);

  const byDir = new Map<string, number>();
  for (const f of files) {
    // Group by the top three path segments.
    const key = path.dirname(f).split(/[\\/]/).slice(0, 4).join("/");
    byDir.set(key, (byDir.get(key) ?? 0) + 1);
  }
  for (const [d, n] of [...byDir].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(6)}  ${d}`);
  }

  const hashes = new Map<string, string[]>();
  for (const f of files) {
    const h = crypto.createHash("sha1").update(fs.readFileSync(f)).digest("hex");
    if (!hashes.has(h)) hashes.set(h, []);
    hashes.get(h)!.push(f);
  }
  const dupGroups = [...hashes.values()].filter((g) => g.length > 1);
  const dupFiles = dupGroups.reduce((n, g) => n + g.length - 1, 0);
  console.log(`  unique by content: ${hashes.size}`);
  console.log(`  redundant copies : ${dupFiles}`);

  // Distinct basenames tell us how many logical drawings exist.
  const names = new Set(files.map((f) => path.basename(f).toUpperCase()));
  console.log(`  distinct filenames: ${names.size}`);
}
