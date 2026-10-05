import fs from "node:fs";
import path from "node:path";
import { decodeM1 } from "../src/decoder/scanner";

const [dir, cls] = process.argv.slice(2);
for (const f of fs.readdirSync(dir).filter((x) => /\.m1$/i.test(x)).sort()) {
  const d = decodeM1(fs.readFileSync(path.join(dir, f)), f, { strict: false });
  for (const r of d.records.filter((x) => x.className === cls)) {
    const summary = r.fields
      .filter((x) => !x.name.startsWith("hdr.") && !x.name.startsWith("style.") && x.name !== "preamble" && x.name !== "className")
      .map((x) => `${x.name}=${typeof x.value === "string" ? JSON.stringify(x.value) : x.value}`)
      .join(" | ");
    console.log(`${f} #${r.index} ${summary}`);
  }
}
