/**
 * Layout engine unit tests — orthogonal routing, no overlaps, determinism,
 * connectivity preservation.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EngineeringSheetModel, Traceability } from "@infi90/core";
import {
  layoutAndRoute,
  allSegmentsAreOrthogonal,
  validateDiagramGeometry,
} from "./pipeline.ts";

function trace(text = "t"): Traceability {
  return {
    sourceFilename: "test.CAD",
    sourceMethod: "CAD_NATIVE",
    sourceText: text,
    sourceIndex: 0,
    confidence: 1,
    validationStatus: "verified",
  };
}

function block(
  id: string,
  fc: string,
  x: number,
  y: number,
  type: "LogicBlock" | "CrossReference" | "Junction" | "TimingBlock" = "LogicBlock"
): EngineeringSheetModel["blocks"][0] {
  return {
    id,
    type,
    functionCode: fc,
    x,
    y,
    width: 60,
    height: 40,
    parameters: {},
    ports: [],
    inputRefs: [],
    outputRefs: [],
    deviceTags: [],
    sourceGeometry: { originalX: x, originalY: y, originalWidth: 60, originalHeight: 40 },
    trace: trace(fc),
  };
}

function conn(
  id: string,
  a: string,
  b: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): EngineeringSheetModel["connections"][0] {
  return {
    id,
    sourceBlockId: a,
    targetBlockId: b,
    geometry: [{ x1, y1, x2, y2 }],
    referenceType: "local",
    resolved: true,
    relationType: "EXPLICIT",
    trace: trace("wire"),
  };
}

function model(
  blocks: EngineeringSheetModel["blocks"],
  connections: EngineeringSheetModel["connections"],
  annotations: EngineeringSheetModel["annotations"] = []
): EngineeringSheetModel {
  return {
    version: "1.0",
    filename: "test.CAD",
    page: { width: 800, height: 600 },
    blocks,
    connections,
    crossReferences: [],
    tags: [],
    annotations,
    layers: [],
    stats: {
      blockCount: blocks.length,
      connectionCount: connections.length,
      tagCount: 0,
      crossRefCount: 0,
      unresolvedConnections: 0,
    },
    validation: { status: "READY", warnings: [] },
  };
}

describe("layout v2 — basic", () => {
  it("routes two connected nodes orthogonally without overlap", () => {
    const m = model(
      [block("a", "OR2", 10, 10), block("b", "AND2", 200, 80)],
      [conn("c1", "a", "b", 70, 30, 200, 100)]
    );
    const { model: out, validation } = layoutAndRoute(m);
    assert.equal(out.blocks.length, 2);
    assert.equal(out.connections.length, 1);
    assert.ok(allSegmentsAreOrthogonal(out));
    assert.equal(validation.metrics.diagonalSegments, 0);
    assert.equal(validation.metrics.nodeOverlaps, 0);
  });

  it("lays out a three-node chain", () => {
    const m = model(
      [
        block("a", "IREF", 0, 0, "CrossReference"),
        block("b", "OR2", 100, 0),
        block("c", "OREF", 200, 0, "CrossReference"),
      ],
      [conn("c1", "a", "b", 0, 0, 100, 0), conn("c2", "b", "c", 100, 0, 200, 0)]
    );
    const { model: out } = layoutAndRoute(m);
    assert.equal(out.connections.length, 2);
    assert.ok(allSegmentsAreOrthogonal(out));
    // Input left of logic left of output (by layer placement).
    const a = out.blocks.find((x) => x.id === "a")!;
    const b = out.blocks.find((x) => x.id === "b")!;
    const c = out.blocks.find((x) => x.id === "c")!;
    assert.ok(a.x < b.x);
    assert.ok(b.x < c.x);
  });

  it("handles fan-out", () => {
    const m = model(
      [block("s", "OR2", 0, 50), block("t1", "AND2", 200, 0), block("t2", "AND2", 200, 100)],
      [conn("c1", "s", "t1", 0, 0, 1, 1), conn("c2", "s", "t2", 0, 0, 1, 1)]
    );
    const { model: out, validation } = layoutAndRoute(m);
    assert.equal(out.connections.length, 2);
    assert.equal(validation.metrics.diagonalSegments, 0);
  });

  it("handles fan-in", () => {
    const m = model(
      [block("a", "OR2", 0, 0), block("b", "OR2", 0, 80), block("t", "AND2", 200, 40)],
      [conn("c1", "a", "t", 0, 0, 1, 1), conn("c2", "b", "t", 0, 0, 1, 1)]
    );
    const { validation } = layoutAndRoute(m);
    assert.equal(validation.metrics.diagonalSegments, 0);
  });

  it("aligns repeated STEP groups", () => {
    const m = model(
      [
        block("s3a", "OR2", 50, 100),
        block("s3b", "SR", 150, 100),
        block("s4a", "OR2", 50, 300),
        block("s4b", "SR", 150, 300),
      ],
      [
        conn("c1", "s3a", "s3b", 0, 0, 1, 1),
        conn("c2", "s4a", "s4b", 0, 0, 1, 1),
      ],
      [
        {
          id: "ann1",
          text: "STEP 3",
          kind: "label",
          x: 10,
          y: 100,
          trace: trace("STEP 3"),
        },
        {
          id: "ann2",
          text: "STEP 4",
          kind: "label",
          x: 10,
          y: 300,
          trace: trace("STEP 4"),
        },
      ]
    );
    const { model: out } = layoutAndRoute(m);
    const s3a = out.blocks.find((b) => b.id === "s3a")!;
    const s4a = out.blocks.find((b) => b.id === "s4a")!;
    // Same column X for corresponding OR2 blocks.
    assert.ok(Math.abs(s3a.x - s4a.x) < 1);
  });

  it("routes feedback without diagonals", () => {
    const m = model(
      [block("a", "SR", 0, 0), block("b", "AND2", 200, 0)],
      [conn("fwd", "a", "b", 0, 0, 1, 1), conn("fb", "b", "a", 0, 0, 1, 1)]
    );
    const { model: out } = layoutAndRoute(m);
    assert.ok(allSegmentsAreOrthogonal(out));
  });

  it("is deterministic", () => {
    const m = model(
      [block("a", "NOT", 0, 0), block("b", "TD-DIG", 100, 50)],
      [conn("c1", "a", "b", 0, 0, 1, 1)]
    );
    const r1 = layoutAndRoute(m);
    const r2 = layoutAndRoute(m);
    assert.deepEqual(
      r1.model.blocks.map((b) => ({ id: b.id, x: b.x, y: b.y, w: b.width, h: b.height })),
      r2.model.blocks.map((b) => ({ id: b.id, x: b.x, y: b.y, w: b.width, h: b.height }))
    );
    assert.deepEqual(r1.model.connections.map((c) => c.geometry), r2.model.connections.map((c) => c.geometry));
  });

  it("fits every sheet onto ISO A3 with content-driven orientation", () => {
    const wide = model(
      [
        block("a", "AND2", 0, 0),
        block("b", "OR2", 400, 0),
        block("c", "NOT", 800, 20),
      ],
      [
        conn("c1", "a", "b", 0, 0, 1, 1),
        conn("c2", "b", "c", 0, 0, 1, 1),
      ]
    );
    const tall = model(
      [
        block("a", "AND2", 0, 0),
        block("b", "OR2", 0, 200),
        block("c", "NOT", 0, 400),
        block("d", "SR", 0, 600),
      ],
      [
        conn("c1", "a", "b", 0, 0, 1, 1),
        conn("c2", "b", "c", 0, 0, 1, 1),
        conn("c3", "c", "d", 0, 0, 1, 1),
      ]
    );
    const { model: outW } = layoutAndRoute(wide);
    const { model: outT } = layoutAndRoute(tall);
    assert.equal(outW.page.paperSize, "A3");
    assert.equal(outT.page.paperSize, "A3");
    assert.ok(outW.page.orientation === "landscape" || outW.page.orientation === "portrait");
    assert.ok(outT.page.orientation === "landscape" || outT.page.orientation === "portrait");
    // A3 px at 96dpi: 1587 × 1123 (or swapped)
    const dims = new Set([
      `${outW.page.width}x${outW.page.height}`,
      `${outT.page.width}x${outT.page.height}`,
    ]);
    for (const d of dims) {
      assert.ok(d === "1587x1123" || d === "1123x1587", `unexpected A3 size ${d}`);
    }
  });

  it("preserves connectivity ids", () => {
    const m = model(
      [block("a", "AND2", 0, 0), block("b", "OR2", 100, 0)],
      [conn("keep-me", "a", "b", 0, 0, 1, 1)]
    );
    const { model: out } = layoutAndRoute(m);
    assert.ok(out.connections.some((c) => c.id === "keep-me"));
    assert.equal(out.connections[0].sourceBlockId, "a");
    assert.equal(out.connections[0].targetBlockId, "b");
  });

  it("sizes long labels wider", () => {
    const long = block("a", "OR2", 0, 0);
    long.label = "VERY-LONG-ENGINEERING-TAG-NAME-XYZ";
    const m = model([long, block("b", "AND2", 200, 0)], [conn("c1", "a", "b", 0, 0, 1, 1)]);
    const { model: out } = layoutAndRoute(m);
    const a = out.blocks.find((b) => b.id === "a")!;
    assert.ok(a.width >= 72);
  });

  it("validateDiagramGeometry rejects diagonals", () => {
    const m = model(
      [block("a", "OR2", 0, 0), block("b", "AND2", 100, 100)],
      [conn("c1", "a", "b", 0, 0, 100, 100)]
    );
    // Don't layout — raw diagonal.
    const v = validateDiagramGeometry(m);
    assert.ok(v.metrics.diagonalSegments >= 1);
  });
});
