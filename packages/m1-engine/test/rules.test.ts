import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RULES } from "../src/rules";

const here = path.dirname(fileURLToPath(import.meta.url));

test("every non-visual rule points at an existing test that names it", () => {
  for (const rule of RULES) {
    if (rule.test.startsWith("(visual")) {
      assert.equal(rule.status, "CANDIDATE", `${rule.id}: visually-evidenced rules cannot be PROVEN`);
      continue;
    }
    const [file, title] = rule.test.split(" › ");
    const src = path.join(here, file);
    assert.ok(fs.existsSync(src), `${rule.id}: ${file} does not exist`);
    const ruleId = title.match(/RULE-[A-Z]+-\d{3}/)?.[0];
    assert.ok(ruleId, `${rule.id}: test reference must name a rule id`);
    assert.match(fs.readFileSync(src, "utf8"), new RegExp(`test\\("${ruleId}\\b`), `${rule.id}: no test titled ${ruleId} in ${file}`);
  }
});
