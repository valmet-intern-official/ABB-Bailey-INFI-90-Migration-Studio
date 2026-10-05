import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { corpusFiles, GOLDEN_DIR, skip } from "./corpus";
import { fingerprint } from "./golden";

test("golden master: decoded records, fields, links, properties and SVG are unchanged", { skip }, () => {
  const files = corpusFiles();
  assert.equal(files.length, 10);
  for (const { name, data } of files) {
    const goldenPath = path.join(GOLDEN_DIR, name.replace(/\.m1$/i, ".json"));
    assert.ok(fs.existsSync(goldenPath), `missing golden master ${goldenPath}; run npm run golden:update`);
    const expected = JSON.parse(fs.readFileSync(goldenPath, "utf8"));
    assert.deepEqual(fingerprint(name, data), expected, `${name} drifted from its golden master`);
  }
});
