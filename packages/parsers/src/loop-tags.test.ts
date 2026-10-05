// Loop tags extracted from the M10 CAD, checked against the supplied engineering
// IO list. The list is only an oracle; extraction never reads it.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalLoopTag } from "./loop-tags";
import { processExtractedDir } from "./pipeline";
import { normalizeTag, parseTagMap } from "./tag-map";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const M10 = path.join(root, "tools/fc-manual/cache/m10");
const LIST = path.join(root, "Guiding Material/Test 2 Data - CAD/Expected Output - IO List.xls");

describe("CAD loop tags (M10)", { skip: !(fs.existsSync(M10) && fs.existsSync(LIST)) && "M10 data not present" }, () => {
  const project = processExtractedDir(M10);
  const map = parseTagMap(fs.readFileSync(LIST), path.basename(LIST))!;
  const expected = new Map<string, Set<string>>();
  for (const e of map.entries) {
    for (const t of [e.deviceTag, ...e.aliases]) {
      const k = normalizeTag(t);
      if (!expected.has(k)) expected.set(k, new Set());
      expected.get(k)!.add(canonicalLoopTag(e.loopTag) ?? e.loopTag.toUpperCase());
    }
  }

  it("never takes a drawing date or revision as a loop tag", () => {
    for (const r of project.ioRecords) {
      if (r.loopTag) assert.match(r.loopTag, /^\d{3}[A-Z]+-[A-Z]?\d+[A-Z]?$/, `${r.rawIoTag}: ${r.loopTag}`);
    }
  });

  it("known devices resolve to the listed loop tag", () => {
    const byDevice = new Map(project.ioRecords.map((r) => [r.deviceTag, r.loopTag]));
    assert.equal(byDevice.get("131LT103"), "131LI-103");
    assert.equal(byDevice.get("131LT-104"), "131LI-104");
    assert.equal(byDevice.get("131XY-M102mc"), "131HS-M102");
    assert.equal(byDevice.get("131ZSH121"), "131ZAH-121");
    assert.equal(byDevice.get("131IT-M106"), "131II-M106");
  });

  it("agrees with the engineering IO list for at least 90% of listed devices", () => {
    const seen = new Set<string>();
    let listed = 0;
    let agree = 0;
    for (const r of project.ioRecords) {
      const key = normalizeTag(r.deviceTag ?? "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const exp = expected.get(key);
      if (!exp) continue;
      listed++;
      if (r.loopTag && exp.has(r.loopTag)) agree++;
    }
    assert.ok(listed > 350, `listed devices: ${listed}`);
    assert.ok(agree / listed >= 0.9, `agreement ${agree}/${listed}`);
  });
});
