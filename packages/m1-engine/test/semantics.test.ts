import { test } from "node:test";
import assert from "node:assert/strict";
import { decoded, skip } from "./corpus";
import { expandKey, extractBindings, parseInstanceExpression } from "../src/bindings/bindings";
import { analyzeTemplates } from "../src/templates/templates";
import { buildSceneGraph } from "../src/scene/scene";
import { buildLogicGraph } from "../src/logic/logic";

test("RULE-BIND-001 instance expression parameters", () => {
  assert.deepEqual(parseInstanceExpression('%#1#% TAG "131HS-M106" %#1#%'), { TAG: "131HS-M106" });
  assert.deepEqual(parseInstanceExpression(' %#1#% Tag "131HS-M102C" StateAtom "EB_FB2" %#1#% '), { Tag: "131HS-M102C", StateAtom: "EB_FB2" });
  assert.deepEqual(parseInstanceExpression(""), {});
  assert.equal(expandKey("$TAG$#dC_APV", { TAG: "131AC-105" }), "131AC-105#dC_APV");
  assert.equal(expandKey("$Tag$#d$StateAtom$_N", { Tag: "X", StateAtom: "EB_FB2" }), "X#dEB_FB2_N");
  assert.equal(expandKey("$TAG$", {}), null);
});

test("RULE-BIND-001 every $…$ key expands exactly to its stored value", { skip }, () => {
  let checked = 0;
  for (const d of decoded())
    for (const inst of extractBindings(d))
      for (const b of inst.bindings) {
        assert.notEqual(b.status, "INCONSISTENT", `${d.file} #${inst.instanceId} ${b.key}: ${b.note}`);
        if (b.expandedKey !== null) checked++;
      }
  assert.ok(checked > 1000);
});

test("TAG strings are preserved byte-exact", { skip }, () => {
  const d = decoded().find((x) => x.file.startsWith("1311"))!;
  const tags = extractBindings(d).map((b) => b.primaryTag).filter(Boolean);
  assert.ok(tags.includes("131HS-M106"));
  assert.ok(tags.includes("131AC-105"));
});

test("RULE-TPL-001 templates are external and each instance becomes a placeholder", { skip }, () => {
  for (const d of decoded()) {
    const t = analyzeTemplates(d);
    assert.ok(t.templates.every((x) => x.status === "EXTERNAL_UNRESOLVED"));
    const s = buildSceneGraph(d);
    const nInst = d.records.filter((r) => r.className === "ModInst").length;
    assert.equal(s.nodes.filter((n) => n.kind === "placeholder").length, nInst, d.file);
    for (const n of s.nodes) if (n.kind === "placeholder") assert.ok(n.templateName.length > 0);
  }
});

test("scene graph has no render issues and every node traces to a record", { skip }, () => {
  for (const d of decoded()) {
    const s = buildSceneGraph(d);
    assert.deepEqual(s.issues, [], d.file);
    for (const n of s.nodes) assert.equal(d.records[n.objectId - 1].offset, n.offset);
  }
});

test("logic graph only references existing records", { skip }, () => {
  for (const d of decoded()) {
    const g = buildLogicGraph(d);
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) assert.ok(ids.has(e.from) && ids.has(e.to));
    for (const r of g.roots) assert.equal(r.ownerClass, "ModInst");
  }
});
