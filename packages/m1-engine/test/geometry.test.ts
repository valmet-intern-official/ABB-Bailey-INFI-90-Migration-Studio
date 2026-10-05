import { test } from "node:test";
import assert from "node:assert/strict";
import { decoded, skip } from "./corpus";
import { apply, compose, fromMat2x3, fromScal2d, IDENTITY } from "../src/geometry/transform";
import { FieldReader } from "../src/binary/reader";

test("RULE-GEOM-001 16.16 fixed point decoding", () => {
  const b = Buffer.alloc(8);
  b.writeInt32LE(Math.round(1.2 * 65536), 0);
  b.writeInt32LE(-65536 * 3, 4);
  const r = new FieldReader(b, 0, 8);
  assert.ok(Math.abs(r.fx("x") - 1.2) < 1e-4);
  assert.equal(r.fx("y"), -3);
});

test("RULE-GEOM-001 menu background spans the nominal page", { skip }, () => {
  const d = decoded().find((x) => x.file.startsWith("1302"))!;
  const pts = d.records.filter((r) => r.className === "PtArray").flatMap((r) => (r.decoded as { points: [number, number][] }).points);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  assert.ok(Math.min(...xs) >= 0 && Math.max(...xs) <= 100);
  assert.ok(Math.min(...ys) >= 0 && Math.max(...ys) <= 75);
});

test("RULE-XF-001 Scal2d maps with 16.16 translation", () => {
  const t = fromScal2d({ tx: 65536 * 2, ty: -65536, sx: 3, sy: 0.5 });
  assert.deepEqual(apply(t, [1, 4]), [5, 1]);
});

test("RULE-XF-002 Mat2x3 maps with 16.16 translation", () => {
  const t = fromMat2x3({ a: 0, b: -1, tx: 65536 * 10, c: 1, d: 0, ty: 0 });
  assert.deepEqual(apply(t, [2, 3]), [7, 2]);
  const c = compose(t, IDENTITY);
  assert.deepEqual(c, t);
});

test("RULE-XF-001 menu buttons fall on a 4-unit grid", { skip }, () => {
  const d = decoded().find((x) => x.file.startsWith("1302"))!;
  const ys: number[] = [];
  for (const r of d.records) {
    if (r.className !== "ModInst") continue;
    const t = d.records[(r.decoded as { transformRef: number }).transformRef - 1];
    const s = t.decoded as { tx: number; ty: number };
    if (Math.abs(s.tx / 65536 - 1.5625) < 1e-6) ys.push(s.ty / 65536);
  }
  ys.sort((a, b) => a - b);
  assert.ok(ys.length >= 8);
  for (let i = 1; i < ys.length; i++) assert.ok(Math.abs(ys[i] - ys[i - 1] - 4) < 1e-6, `step ${ys[i] - ys[i - 1]}`);
});

test("RULE-SHAPE-001 sector start angle equals atan2(start − centre)", { skip }, () => {
  let n = 0;
  for (const d of decoded())
    for (const r of d.records) {
      if (r.className !== "G_Sect_30") continue;
      const dec = r.decoded as { geometry: number[]; startAngle: number };
      const [c, s] = (d.records[dec.geometry[0] - 1].decoded as { points: [number, number][] }).points;
      let a = (Math.atan2(s[1] - c[1], s[0] - c[0]) * 180) / Math.PI;
      if (a < 0) a += 360;
      assert.ok(Math.abs(a - dec.startAngle) < 0.01, `${d.file} #${r.id}: ${a} vs ${dec.startAngle}`);
      n++;
    }
  assert.ok(n > 0);
});

test("RULE-STYLE-001 style block carries the 0x2710 constant", { skip }, () => {
  for (const d of decoded())
    for (const r of d.records) {
      const k = r.fields.find((f) => f.name === "style.k10000" || f.name === "fill.k10000");
      if (k) assert.equal(k.value, 10000, `${d.file} #${r.id}`);
    }
});
