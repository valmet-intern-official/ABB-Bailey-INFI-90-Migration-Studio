import { test } from "node:test";
import assert from "node:assert/strict";
import { decoded, skip } from "./corpus";
import { buildObjectGraph } from "../src/objects/graph";

test("RULE-ID-001 object id = ordinal + 1 and breadth-first allocation", { skip }, () => {
  for (const d of decoded()) {
    d.records.forEach((r, i) => assert.equal(r.id, i + 1));
    assert.equal(d.records[0].className, "Model", d.file);
    const g = buildObjectGraph(d);
    assert.ok(g.idAllocation.checked > 0);
    assert.deepEqual(g.idAllocation.violations, [], d.file);
  }
});

test("RULE-HDR-002 / graph integrity: no orphans, missing refs, duplicate parents or cycles", { skip }, () => {
  for (const d of decoded()) {
    const g = buildObjectGraph(d);
    assert.deepEqual(g.issues, [], `${d.file}: ${g.issues.map((i) => i.message).join("; ")}`);
  }
});

test("RULE-HDR-002 header slot 0 references only G_DynProp_30", { skip }, () => {
  for (const d of decoded())
    for (const r of d.records)
      for (const ref of r.refs.filter((x) => x.field === "hdr.dynPropRef")) assert.equal(d.records[ref.targetId - 1].className, "G_DynProp_30");
});

test("RULE-REF-001 reference roles target single class families", { skip }, () => {
  const allowed: Record<string, string[]> = {
    geometry: ["PtArray", "Point"],
    anchor: ["Point"],
    transform: ["Scal2d", "Mat2x3"],
    property: ["G_StrConst_30", "G_IntConst_30"],
    dynamic: ["G_DynProp_30"],
    "link-first": ["LinkRef"],
    "link-second": ["Point"],
    "spline-part": ["LinkRef"],
  };
  for (const d of decoded()) {
    const g = buildObjectGraph(d);
    for (const e of g.edges) {
      const ok = allowed[e.role];
      if (!ok) continue;
      assert.ok(ok.includes(g.byId.get(e.to)!.className), `${d.file} #${e.from}.${e.field} → ${g.byId.get(e.to)!.className}`);
    }
  }
});
