import crypto from "node:crypto";
import { analyzeM1 } from "../src/pipeline/analyze";
import { layoutScene } from "../src/render/layout";
import { renderSvg } from "../src/render/svg";
import { fallbackPalette } from "../src/render/palette";
import { fieldsCsv, linksCsv, propertiesCsv, recordsCsv } from "../src/package/exports";
import { DECODER_REVISION } from "../src/decoder/scanner";

const sha = (s: string | Buffer) => crypto.createHash("sha256").update(s).digest("hex");

/** Golden-master fingerprint: independent of the reference PDF and palette calibration. */
export function fingerprint(name: string, data: Buffer) {
  const a = analyzeM1(name, data);
  const classes: Record<string, number> = {};
  for (const r of a.decoded.records) classes[r.className] = (classes[r.className] ?? 0) + 1;
  const svg = renderSvg(layoutScene(a.scene, { palette: fallbackPalette() }), { marking: true });
  return {
    decoderRevision: DECODER_REVISION,
    file: name,
    inputSha256: a.decoded.sha256,
    records: a.decoded.records.length,
    classes,
    fieldStatusBytes: a.fieldStats.bytes,
    sceneNodes: a.scene.nodes.length,
    placeholders: a.scene.nodes.filter((n) => n.kind === "placeholder").length,
    tags: a.tagIndex.length,
    digests: {
      records: sha(recordsCsv(a.decoded)),
      fields: sha(fieldsCsv(a.decoded)),
      links: sha(linksCsv(a)),
      properties: sha(propertiesCsv(a)),
      svg: sha(svg),
    },
  };
}
