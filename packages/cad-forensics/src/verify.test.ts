/**
 * Mutation tests: one engineering item is removed or corrupted in the
 * rendered document and the verifier must report exactly that item.
 * Runs on the M10 module when its extracted CAD files are present.
 */
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { RenderItem as Item } from "@infi90/cad-engine";
import { buildScene } from "./scene";
import { buildDocument, type EngineeringDocument } from "./render/document";
import { verifyDocument, type Defect } from "./verify";
import { goldenDigest } from "./golden";
import type { SceneGraph } from "./types";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const M10 = process.env.M10_EXTRACT ?? path.join(ROOT, "data/work/1790926362758/extract");
const have = fs.existsSync(M10);
const GOLDEN = path.join(import.meta.dirname, "../golden/M10.digest.json");

const walk = (d: string): string[] =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.cad$/i.test(e.name) ? [path.join(d, e.name)] : []));

let scene: SceneGraph;
let doc: EngineeringDocument;
let densePage: number;
let denseFile: string;

function mutate(pageIndex: number, fn: (items: Item[]) => Item[]): EngineeringDocument {
  return { ...doc, pages: doc.pages.map((p, i) => (i === pageIndex ? { ...p, items: fn(p.items.slice()) } : p)) };
}
/** Apply fn to every page that holds an item with this src. */
function mutateSrc(src: string, fn: (items: Item[]) => Item[]): EngineeringDocument {
  return { ...doc, pages: doc.pages.map((p) => (p.items.some((it) => it.src === src) ? { ...p, items: fn(p.items.slice()) } : p)) };
}
const drawingIndex = (file: string) => doc.pageMap.drawing.find((d) => d.file === file)!.page - 1;
const expectDefect = (defects: Defect[], kind: Defect["kind"], id: string) =>
  assert.ok(defects.some((d) => d.kind === kind && d.id === id), `expected ${kind} for ${id}; got ${JSON.stringify(defects.slice(0, 5))}`);

describe("cad-forensics verification (M10)", { skip: !have && "M10 extract not present" }, () => {
  before(() => {
    const cads = walk(M10).map((p) => ({ name: path.basename(p), data: fs.readFileSync(p) }));
    const built = buildScene({ module: "M10", cads, extractDir: M10 });
    scene = built.scene;
    doc = buildDocument(scene, built.reconstructed);
    const perFile = new Map<string, number>();
    for (const a of doc.annotations) if (a.kind !== "plot_stamp") perFile.set(a.id.split(":")[0], (perFile.get(a.id.split(":")[0]) ?? 0) + 1);
    denseFile = [...perFile].sort((a, b) => b[1] - a[1])[0][0];
    densePage = drawingIndex(denseFile);
  });

  it("clean document has no defects", () => {
    assert.deepEqual(verifyDocument(scene, doc), []);
  });

  for (const label of ["S1", "S2", "S3"]) {
    it(`detects a missing ${label} label on the densest page`, () => {
      const a = doc.annotations.find((x) => x.kind === "s_label" && x.text === label && x.id.startsWith(denseFile)) ?? doc.annotations.find((x) => x.kind === "s_label" && x.text === label)!;
      const d = mutateSrc(`scene:${a.id}`, (items) => items.filter((it) => it.src !== `scene:${a.id}`));
      expectDefect(verifyDocument(scene, d), "ANNOTATION_MISSING", a.id);
    });
  }

  it("detects a missing S36 specification row", () => {
    const s = scene.specifications.find((x) => x.label === "S36");
    assert.ok(s, "module has an S36 specification");
    const d = mutateSrc(s.id, (items) => items.filter((it) => it.src !== s.id));
    expectDefect(verifyDocument(scene, d), "SPEC_NOT_LISTED", s.id);
  });

  it("detects a missing specification value", () => {
    const s = scene.specifications.find((x) => x.actual_value != null && x.id.startsWith(denseFile))!;
    const d = mutateSrc(s.id, (items) => items.map((it) => (it.src === s.id && it.t === "text" && it.text.startsWith(`${s.label} `) ? { ...it, text: `${s.label.padEnd(5)}${"".padEnd(16)}${it.text.slice(21)}` } : it)));
    expectDefect(verifyDocument(scene, d), "SPEC_VALUE", s.id);
  });

  it("detects a missing block number", () => {
    const b = scene.function_blocks.find((x) => x.file === denseFile && x.glyph === "FALLBACK" && x.block_address != null)!;
    const src = b.source_entities.find((s) => /@\d+$/.test(s))!;
    const addr = String(b.block_address);
    const ann = doc.annotations.find((a) => a.kind === "sub_block_number" && a.text === addr && a.id.startsWith(`${b.id}.`));
    const d = mutate(densePage, (items) => items.filter((it) => !(it.src === src && it.cls === "block-number") && !(ann && it.src === `scene:${ann.id}`)));
    expectDefect(verifyDocument(scene, d), "BLOCK_NUMBER_MISSING", b.id);
  });

  it("detects a missing sub-block (N+k) address on the drawing and on the detail page", () => {
    const a = doc.annotations.find((x) => x.kind === "sub_block_number")!;
    const d1 = mutateSrc(`scene:${a.id}`, (items) => items.filter((it) => it.src !== `scene:${a.id}`));
    expectDefect(verifyDocument(scene, d1), "ANNOTATION_MISSING", a.id);
    const d2 = mutateSrc(a.id, (items) => items.filter((it) => it.src !== a.id));
    expectDefect(verifyDocument(scene, d2), "SUB_BLOCK_NOT_LISTED", a.id);
  });

  it("detects a moved label", () => {
    const a = doc.annotations.find((x) => x.kind === "s_label" && x.id.startsWith(denseFile))!;
    const d = mutate(densePage, (items) => items.map((it) => (it.src === `scene:${a.id}` && it.t === "text" ? { ...it, y: it.y - 4.25 } : it)));
    expectDefect(verifyDocument(scene, d), "ANNOTATION_MOVED", a.id);
  });

  it("detects a missing wire and a wrong wire endpoint", () => {
    const w = scene.wires.find((x) => x.file === denseFile)!;
    const src = w.source_entity_ids[0];
    const d1 = mutate(densePage, (items) => items.filter((it) => !(it.src === src && it.t === "path")));
    expectDefect(verifyDocument(scene, d1), "WIRE_MISSING", w.id);
    const d2 = mutate(densePage, (items) => items.map((it) => (it.src === src && it.t === "path" ? { ...it, pts: [...it.pts.slice(0, -1), [it.pts[it.pts.length - 1][0] + 4.25, it.pts[it.pts.length - 1][1]] as [number, number]] } : it)));
    expectDefect(verifyDocument(scene, d2), "WIRE_ENDPOINT", w.id);
  });

  for (const type of ["IREF", "OREF"] as const) {
    it(`detects a missing ${type}`, () => {
      const r = scene.references.find((x) => x.type === type)!;
      const page = drawingIndex(r.file);
      const d = mutate(page, (items) => items.filter((it) => !r.source_entities.includes(it.src)));
      expectDefect(verifyDocument(scene, d), "REFERENCE_MISSING", r.id);
    });
  }

  it("detects a stripped channel suffix", () => {
    const c = scene.channels.find((x) => /[/A-Z]$/.test(x.text) && x.text.length > 4)!;
    const page = drawingIndex(c.file);
    const d = mutate(page, (items) => items.map((it) => (c.source_entities.includes(it.src) && it.t === "text" && it.text.trim() === c.text ? { ...it, text: c.text.slice(0, -1) } : it)));
    expectDefect(verifyDocument(scene, d), "CHANNEL_TEXT", c.id);
  });

  it("detects a missing cross-page connection and a dropped target sheet", () => {
    const c = scene.connections.find((x) => x.cross_page && x.target_file)!;
    const d1 = mutateSrc(c.id, (items) => items.filter((it) => it.src !== c.id));
    expectDefect(verifyDocument(scene, d1), "CONNECTION_NOT_LISTED", c.id);
    const d2 = mutateSrc(c.id, (items) => items.map((it) => (it.src === c.id && it.t === "text" ? { ...it, text: it.text.split(c.target_file!).join("?") } : it)));
    expectDefect(verifyDocument(scene, d2), "CROSS_PAGE_TARGET", c.id);
  });

  it("matches the golden-master digest", { skip: !fs.existsSync(GOLDEN) && "no golden digest" }, () => {
    const want = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
    const got = goldenDigest(scene, doc, verifyDocument(scene, doc));
    assert.deepEqual(got.counts, want.counts);
    assert.deepEqual(got.coverage, want.coverage);
    assert.deepEqual(got.annotations, want.annotations);
    assert.deepEqual(got.hashes, want.hashes);
  });

  it("loses nothing between the decoders and the scene graph", () => {
    const byType = (t: string) => scene.entities.filter((e) => e.type === t).length;
    const sheets = scene.sheets.length;
    assert.equal(sheets, walk(M10).length);
    assert.equal(byType("wire"), scene.wires.length);
    assert.equal(byType("IREF") + byType("OREF"), scene.references.length);
    assert.equal(scene.unresolved.filter((u) => u.kind === "unknown_record").length, byType("unknown"));
    const notListed = doc.coverage.filter((r) => r.not_rendered_anywhere > 0);
    assert.deepEqual(notListed, []);
  });
});
