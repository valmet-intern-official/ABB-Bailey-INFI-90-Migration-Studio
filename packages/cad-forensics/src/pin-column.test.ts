/**
 * The reference sheets from the M10 vendor plot: every output address stays
 * on its own pin, in manual order, and the wire on that pin keeps its signal
 * and destination. Skips when the extract is not on disk.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildScene } from "./scene";
import type { SceneGraph, Terminal } from "./types";

const ROOT = path.resolve(import.meta.dirname, "../../..");

function findExtract(): string | null {
  const hinted = process.env.M10_EXTRACT;
  if (hinted && fs.existsSync(path.join(hinted, "2071000C.CAD"))) return hinted;
  const work = path.join(ROOT, "data/work");
  if (!fs.existsSync(work)) return null;
  for (const name of fs.readdirSync(work)) {
    const dir = path.join(work, name, "extract", "M10");
    if (fs.existsSync(path.join(dir, "2071000C.CAD"))) return dir;
  }
  return null;
}

const extract = findExtract();

function load(): SceneGraph {
  const names = ["2071000C.CAD", "2071003C.CAD", "2071005C.CAD"];
  const cads = names.map((name) => ({ name, data: fs.readFileSync(path.join(extract!, name)) }));
  return buildScene({ module: "M10", cads, extractDir: extract! }).scene;
}

function outputs(scene: SceneGraph, file: string, address: number): Terminal[] {
  const b = scene.function_blocks.find((x) => x.file === file && x.block_address === address);
  assert.ok(b, `${file} block ${address}`);
  return scene.terminals
    .filter((t) => t.block_id === b!.id && t.side === "output" && t.label && t.source_xy)
    .sort((a, c) => c.source_xy![1] - a.source_xy![1]);
}

describe("pin column on the reference sheets", { skip: !extract && "M10 extract not present" }, () => {
  const scene = extract ? load() : (null as unknown as SceneGraph);

  it("places executive 10..14 and segment 15..19, 1025..1029, 9000..9004 top to bottom", () => {
    const ex = scene.function_blocks.find((b) => b.file === "2071000C.CAD" && b.block_address === 10)!;
    assert.equal(ex.function_code, 81);
    for (const [address, count] of [[10, 5], [15, 5], [1025, 5], [9000, 5]] as const) {
      const rows = outputs(scene, "2071000C.CAD", address);
      assert.deepEqual(rows.map((t) => address + (t.label === "N" ? 0 : Number(t.label!.slice(2)))), Array.from({ length: count }, (_, i) => address + i), `block ${address}`);
      for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].source_xy![1] > rows[i].source_xy![1]);
    }
  });

  it("places AIS 4055 then 4050..4054, with 4050 on the first wired pin", () => {
    const rows = outputs(scene, "2071003C.CAD", 4050);
    assert.deepEqual(rows.map((t) => t.label), ["N+5", "N", "N+1", "N+2", "N+3", "N+4"]);
    const wired = rows.filter((t) => t.wired);
    assert.deepEqual(wired.map((t) => 4050 + (t.label === "N" ? 0 : Number(t.label!.slice(2)))), [4050, 4051, 4052, 4053, 4054]);
  });

  it("places DIGRP 4090..4097, including the unwired last pin, each on its own row", () => {
    const rows = outputs(scene, "2071005C.CAD", 4090);
    assert.deepEqual(rows.map((t) => 4090 + (t.label === "N" ? 0 : Number(t.label!.slice(2)))), [4090, 4091, 4092, 4093, 4094, 4095, 4096, 4097]);
    const ys = rows.map((t) => t.source_xy![1]);
    assert.deepEqual(ys.slice(1).map((y, i) => ys[i] - y), [100, 100, 100, 100, 100, 100, 100]);
  });

  it("keeps each AIS pin's signal and destination", () => {
    const b = scene.function_blocks.find((x) => x.file === "2071003C.CAD" && x.block_address === 4050)!;
    const rows = outputs(scene, "2071003C.CAD", 4050);
    const expect: Record<string, { signal: string; dest: string } | null> = {
      "N+5": null,
      N: { signal: "AI1-3/131LT103", dest: "AD47-06.07" },
      "N+1": { signal: "AI2-3/131AT104", dest: "AD48-05.07" },
      // The connector record stores AD95-12.07. AD50-09.07 and AD49-08.07 are
      // separate text records on the same wire and are asserted below.
      "N+2": { signal: "AI3-SL3/131AI-254", dest: "AD95-12.07" },
      "N+3": { signal: "AI4-3/131WT120", dest: "AD54-09.07" },
      "N+4": { signal: "AI5-SL3/131TT-456", dest: "ADC4-09.07" },
    };
    for (const row of rows) {
      const want = expect[row.label!];
      const hits = scene.references.filter((r) => r.file === "2071003C.CAD" && r.connected_blocks.some((c) => c.block === b.block_address && c.terminal === row.label));
      if (want == null) {
        assert.equal(hits.length, 0, `${row.label} has no signal`);
        continue;
      }
      assert.ok(hits.some((h) => h.signal === want.signal && h.label === want.dest), `${row.label} -> ${hits.map((h) => `${h.signal} ${h.label}`).join(" | ")}`);
    }
    const texts = scene.entities.filter((e) => e.file === "2071003C.CAD" && e.type === "text").map((e) => e.text);
    assert.ok(texts.includes("AD50-09.07"));
    assert.ok(texts.includes("AD49-08.07"));
  });

  it("keeps each DIGRP pin's signal and destination", () => {
    const b = scene.function_blocks.find((x) => x.file === "2071005C.CAD" && x.block_address === 4090)!;
    const rows = outputs(scene, "2071005C.CAD", 4090);
    const expect: Record<number, [string, string] | null> = {
      4090: ["DI1-5A/131ZSH121", "AD55-08.07"],
      4091: ["DI2-5A/131ZSL121", "AD55-10.07"],
      4092: ["DI3-5A/131LSL123A", "AD56-08.07"],
      4093: ["DI4-5A/131ZSO156", "AD75-08.07"],
      4094: ["DI5-5A/131ZSC156", "AD75-11.07"],
      4095: ["DI6-5A/131ZSO180A", "AD86-08.07"],
      4096: ["DI7-5A/131ZSO180B", "AD87-08.07"],
      4097: null,
    };
    for (const row of rows) {
      const address = 4090 + (row.label === "N" ? 0 : Number(row.label!.slice(2)));
      const want = expect[address];
      const hit = scene.references.find((r) => r.file === "2071005C.CAD" && r.connected_blocks.some((c) => c.block === b.block_address && c.terminal === row.label));
      if (want == null) {
        assert.equal(hit, undefined, `terminal ${address} has no signal`);
        continue;
      }
      assert.ok(hit, `terminal ${address} is connected`);
      assert.equal(hit.signal, want[0]);
      assert.equal(hit.label, want[1]);
    }
  });
});
