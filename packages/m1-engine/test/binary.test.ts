import { test } from "node:test";
import assert from "node:assert/strict";
import { corpusFiles, decoded, skip } from "./corpus";
import { CoverageError, decodeM1, HEADER_LENGTH } from "../src/decoder/scanner";

test("RULE-MAGIC-001 magic and header", { skip }, () => {
  const files = decoded();
  assert.equal(files.length, 10, "the supplied corpus has ten M1 files");
  for (const d of files) {
    assert.equal(d.header.magic, "m1gms4u\n", d.file);
    const [a, b, c] = d.header.fields.filter((f) => f.type === "u32").map((f) => f.value);
    assert.deepEqual([a, b, c], [0x10, 1, 0], d.file);
    assert.equal(d.header.length, HEADER_LENGTH);
  }
});

test("RULE-REC-001 records tile the file with no gaps or overlaps", { skip }, () => {
  for (const d of decoded()) {
    assert.ok(d.coverage.ok, `${d.file}: ${JSON.stringify(d.coverage.gaps)}`);
    assert.equal(d.records[0].offset, HEADER_LENGTH, d.file);
    for (let i = 1; i < d.records.length; i++) assert.equal(d.records[i].offset, d.records[i - 1].endOffset, `${d.file} record ${i}`);
    assert.equal(d.records[d.records.length - 1].endOffset, d.size, d.file);
  }
});

test("RULE-FIELD-001 typed fields tile every record (zero residual bytes)", { skip }, () => {
  for (const d of decoded()) {
    assert.equal(d.coverage.fieldLevel.unresolvedBytes, 0, d.file);
    assert.equal(d.coverage.fieldLevel.fieldGaps.length, 0, d.file);
    for (const r of d.records) {
      assert.equal(r.decodeError, undefined, `${d.file} #${r.id}`);
      let off = r.offset;
      for (const f of r.fields) {
        assert.equal(f.offset, off, `${d.file} #${r.id}.${f.name}`);
        off += f.length;
      }
      assert.equal(off, r.endOffset, `${d.file} #${r.id}`);
    }
  }
});

test("RULE-REC-002 preamble is 0 except PtArray (= 2 × count)", { skip }, () => {
  for (const d of decoded())
    for (const r of d.records) {
      const pre = r.fields[0];
      assert.equal(pre.name, "preamble");
      if (r.className === "PtArray") assert.equal(pre.value, 2 * (r.decoded as { count: number }).count, `${d.file} #${r.id}`);
      else assert.equal(pre.value, 0, `${d.file} #${r.id} ${r.className}`);
    }
});

test("every raw byte is preserved in field hex", { skip }, () => {
  for (const { name, data } of corpusFiles()) {
    const d = decodeM1(data, name);
    const rebuilt = Buffer.concat([
      ...d.header.fields.map((f) => Buffer.from(f.rawHex.replace(/\s+/g, ""), "hex")),
      ...d.records.flatMap((r) => r.fields.map((f) => Buffer.from(f.rawHex.replace(/\s+/g, ""), "hex"))),
    ]);
    assert.ok(rebuilt.equals(data), `${name}: concatenated field bytes must reproduce the file`);
  }
});

test("1311 marker inventory matches the specification", { skip }, () => {
  const d = decoded().find((x) => x.file.startsWith("1311"))!;
  const count = (c: string) => d.records.filter((r) => r.className === c).length;
  assert.deepEqual(
    {
      ModInst: count("ModInst"), Text: count("Text"), G_Line_30: count("G_Line_30"), G_Rect_30: count("G_Rect_30"),
      G_Circ_30: count("G_Circ_30"), PtArray: count("PtArray"), Point: count("Point"), Mat2x3: count("Mat2x3"),
      Scal2d: count("Scal2d"), LinkRef: count("LinkRef"), Group: count("Group"), G_StrConst_30: count("G_StrConst_30"),
      G_IntConst_30: count("G_IntConst_30"), G_VarRef_30: count("G_VarRef_30"),
    },
    { ModInst: 225, Text: 21, G_Line_30: 191, G_Rect_30: 179, G_Circ_30: 12, PtArray: 391, Point: 62, Mat2x3: 74, Scal2d: 173, LinkRef: 33, Group: 19, G_StrConst_30: 488, G_IntConst_30: 170, G_VarRef_30: 15 }
  );
});

test("strict mode fails loudly on truncated input", { skip }, () => {
  const { name, data } = corpusFiles()[0];
  const cut = data.subarray(0, data.length - 7);
  assert.throws(() => decodeM1(cut, name, { strict: true }), (e: unknown) => e instanceof CoverageError || e instanceof Error);
});

test("appended garbage is never silently dropped", { skip }, () => {
  const { name, data } = corpusFiles()[0];
  const bad = Buffer.concat([data, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9])]);
  const d = decodeM1(bad, name, { strict: false });
  const last = d.records[d.records.length - 1];
  const tail = last.fields.filter((f) => f.status === "UNRESOLVED").reduce((a, f) => a + f.length, 0);
  assert.ok(!d.coverage.ok || d.coverage.fieldLevel.unresolvedBytes > 0 || tail >= 9, "extra bytes must surface as a gap or UNRESOLVED bytes");
  assert.throws(() => decodeM1(bad, name, { strict: true }));
});

test("bad magic is rejected", () => {
  assert.throws(() => decodeM1(Buffer.from("not an m1 file at all....."), "x.m1", { strict: true }));
});
