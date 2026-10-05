import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { corpusFiles, skip } from "./corpus";
import { analyzeM1 } from "../src/pipeline/analyze";
import { layoutScene } from "../src/render/layout";
import { renderSvg } from "../src/render/svg";
import { fallbackPalette } from "../src/render/palette";
import { loadTemplateLibrary } from "../src/templates/library";
import { buildSceneGraph } from "../src/scene/scene";

const library = loadTemplateLibrary();
const libSkip = library ? skip : "symbol library not present";

test("symbol library resolves the Primary Clarifier templates", { skip: libSkip }, () => {
  assert.ok(library);
  const file = corpusFiles().find((f) => /1311/i.test(f.name));
  assert.ok(file);
  const plain = analyzeM1(file.name, file.data);
  const withLib = analyzeM1(file.name, file.data, { library });
  assert.ok(withLib.scene.instantiatedTemplates.includes("iiu_stain_pipe3d"));
  assert.ok(withLib.scene.instantiatedTemplates.includes("iiu_stain_L_3d"));
  assert.ok(withLib.scene.instantiatedTemplates.includes("iiu_stain_T_3d"));
  assert.ok(withLib.scene.instantiatedTemplates.includes("iiu_Control_valve_3d"));
  assert.ok(withLib.scene.nodes.filter((n) => n.kind === "shape").length > plain.scene.nodes.filter((n) => n.kind === "shape").length);
  assert.ok(withLib.scene.nodes.filter((n) => n.kind === "placeholder").length < plain.scene.nodes.filter((n) => n.kind === "placeholder").length);
  for (const n of withLib.scene.nodes) assert.equal(withLib.decoded.records[n.objectId - 1].offset, n.offset, n.nodeId);
});

test("instantiated graphic keeps tags and drops debug crosses", { skip: libSkip }, () => {
  const file = corpusFiles().find((f) => /1311/i.test(f.name));
  assert.ok(file);
  const scene = buildSceneGraph(analyzeM1(file.name, file.data, { library }).decoded, { library });
  const svg = renderSvg(layoutScene(scene, { palette: fallbackPalette(), mode: "NORMAL" }));
  assert.equal(svg.includes("#50d2dc"), false, "cyan anchor cross");
  assert.equal(svg.includes('class="placeholder"'), false, "debug placeholder cross");
  assert.equal(/iiu_stain_/.test(svg), false);
  assert.ok(svg.includes("131HS-M106"));
  assert.ok(svg.includes("PRIMARY CLARIFIER"));
  const marked = renderSvg(layoutScene(scene, { palette: fallbackPalette(), mode: "NORMAL" }), { marking: true });
  assert.ok(marked.includes('id="marking-tags"'));
  assert.ok(marked.includes("131HS-M106"));
});

test("menu submodel decodes to geometry", { skip: libSkip }, () => {
  assert.ok(library);
  const menu = library.get("dupont_MenuPB");
  assert.ok(menu, "dupont_MenuPB");
  const scene = buildSceneGraph(menu);
  assert.ok(scene.nodes.some((n) => n.kind === "shape" || n.kind === "text"));
});

test("library roots exist on disk", { skip: libSkip }, () => {
  assert.ok(library);
  for (const root of library.roots) assert.ok(fs.existsSync(root), root);
  assert.ok(library.roots.some((r) => r.includes(path.join("Power Palnt", "submodels"))));
});
