import { test } from "node:test";
import assert from "node:assert/strict";
import { placeLabels } from "../src/scene/arrange";

test("labels that share a point are stepped apart and keep their own target", () => {
  const placed = placeLabels([
    { text: "131HS-M103", target: [40, 30], objectId: 2, nodeId: "o2" },
    { text: "131II-M103", target: [40.2, 30.1], objectId: 3, nodeId: "o3" },
    { text: "131TqI-130", target: [40.4, 29.8], objectId: 1, nodeId: "o1" },
  ]);
  assert.equal(placed.length, 3);
  const ats = placed.map((p) => p.at.join(","));
  assert.equal(new Set(ats).size, 3);
  for (const p of placed) {
    assert.notDeepEqual(p.at, p.target);
    assert.ok(Math.hypot(p.at[0] - p.target[0], p.at[1] - p.target[1]) < 12);
  }
});

test("a tag inside equipment is placed outside that shape", () => {
  const [p] = placeLabels([{ text: "131HS-M103", target: [40, 30], objectId: 4, nodeId: "o4" }], [{ minX: 30, minY: 22, maxX: 50, maxY: 38 }]);
  assert.ok(p.at[0] >= 50, `label x ${p.at[0]} should clear the equipment`);
  assert.deepEqual(p.target, [40, 30]);
});

test("an isolated tag stays beside its instance", () => {
  const [p] = placeLabels([{ text: "131HS-M106", target: [65.3, 23.41], objectId: 9, nodeId: "o9" }]);
  assert.ok(p.at[0] > p.target[0]);
  assert.ok(p.at[1] > p.target[1]);
});
