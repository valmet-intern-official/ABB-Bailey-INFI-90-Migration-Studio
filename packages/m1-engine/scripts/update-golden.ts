import fs from "node:fs";
import path from "node:path";
import { corpusFiles, GOLDEN_DIR } from "../test/corpus";
import { fingerprint } from "../test/golden";

fs.mkdirSync(GOLDEN_DIR, { recursive: true });
for (const { name, data } of corpusFiles()) {
  const fp = fingerprint(name, data);
  fs.writeFileSync(path.join(GOLDEN_DIR, name.replace(/\.m1$/i, ".json")), JSON.stringify(fp, null, 2) + "\n");
  console.log(`golden ${name}: records=${fp.records} svg=${fp.digests.svg.slice(0, 12)}`);
}
