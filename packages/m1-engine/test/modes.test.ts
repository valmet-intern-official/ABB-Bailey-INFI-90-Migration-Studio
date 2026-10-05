import { test } from "node:test";
import assert from "node:assert/strict";
import { corpusFiles, skip } from "./corpus";
import { analyzeM1 } from "../src/pipeline/analyze";
import { layoutScene } from "../src/render/layout";
import { renderSvg } from "../src/render/svg";
import { fallbackPalette } from "../src/render/palette";

const FORBIDDEN = [/iiu_stain_[A-Za-z0-9_]+/, /dupont_MenuPB/, /iiu_dupont_Menu_bar/];

function texts(svg: string): string[] {
  return [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
}

function paths(svg: string): string[] {
  const g = svg.match(/<g id="graphics">([\s\S]*?)<\/g>/);
  return [...(g?.[1] ?? "").matchAll(/<path\b[^>]*\bd="([^"]*)"/g)].map((m) => m[1]);
}

test("NORMAL graphics do not paint template resource names", { skip }, () => {
  for (const { name, data } of corpusFiles()) {
    const a = analyzeM1(name, data);
    const layout = layoutScene(a.scene, { palette: fallbackPalette(), mode: "NORMAL" });
    const svg = renderSvg(layout, { title: name });
    const shown = texts(svg);
    for (const re of FORBIDDEN) {
      assert.equal(shown.some((t) => re.test(t)), false, `${name} shows ${re} in NORMAL`);
    }
    assert.equal(svg.includes('id="source-debug"'), false, name);
    assert.equal(svg.includes('id="marking-tags"'), false, name);
    const unresolved = a.scene.nodes.filter((n) => n.kind === "placeholder");
    if (unresolved.length) assert.ok(unresolved.every((n) => n.reason.includes("TEMPLATE_GEOMETRY_UNRESOLVED")), name);
  }
});

test("MARKING overlay does not move source geometry", { skip }, () => {
  for (const { name, data } of corpusFiles()) {
    const a = analyzeM1(name, data);
    const layout = layoutScene(a.scene, { palette: fallbackPalette(), mode: "NORMAL" });
    const plain = renderSvg(layout);
    const marked = renderSvg(layout, { marking: true });
    assert.deepEqual(paths(plain), paths(marked), name);
    if (layout.marking.length) assert.ok(marked.includes('id="marking-tags"'), name);
    for (const re of FORBIDDEN) assert.equal(texts(marked).some((t) => re.test(t)), false, name);
  }
});

test("NORMAL graphics show the source tags and menu labels", { skip }, () => {
  const file = corpusFiles().find((f) => /1311/i.test(f.name));
  assert.ok(file);
  const a = analyzeM1(file.name, file.data);
  const shown = texts(renderSvg(layoutScene(a.scene, { palette: fallbackPalette(), mode: "NORMAL" })));
  assert.ok(shown.includes("131HS-M106"), "instrument tag");
  assert.ok(shown.includes("PRIMARY CLARIFIER"), "page title");
  assert.ok(shown.includes("TRENDS") && shown.includes("DETAILS"), "menu labels");
  assert.equal(shown.some((t) => /iiu_stain_/.test(t)), false);
});

test("SOURCE_DEBUG is the only mode that shows template names", { skip }, () => {
  const file = corpusFiles().find((f) => /1311/i.test(f.name));
  assert.ok(file, "1311 fixture");
  const a = analyzeM1(file.name, file.data);
  const layout = layoutScene(a.scene, { palette: fallbackPalette(), mode: "NORMAL" });
  const debug = renderSvg(layout, { debug: true });
  assert.ok(texts(debug).some((t) => /iiu_stain_/.test(t)), "debug view shows stain template names");
  assert.ok(debug.includes('id="source-debug"'));
  assert.deepEqual(paths(renderSvg(layout)), paths(debug));
});
