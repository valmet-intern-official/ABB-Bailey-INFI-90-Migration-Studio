import fs from "node:fs";
import { decodeCadSheet, layoutAndRoute } from "../../packages/cad-engine/src/index.ts";

const buf = fs.readFileSync("Input/M5/3070561A.CAD");
const decoded = decodeCadSheet(buf, "3070561A.CAD");
const { model, validation } = layoutAndRoute(decoded);
console.log("page", model.page);
console.log("metrics", validation.metrics);
console.log("sample errors", validation.errors.slice(0, 6));

const blocks = model.blocks.filter((b) => b.type !== "Junction");
let hitConns = 0;
for (const c of model.connections) {
  if (!c.sourceBlockId && !c.targetBlockId) continue;
  let hit = false;
  for (const seg of c.geometry) {
    for (const b of blocks) {
      if (b.id === c.sourceBlockId || b.id === c.targetBlockId) continue;
      const pad = 3;
      const rx1 = b.x + pad;
      const ry1 = b.y + pad;
      const rx2 = b.x + b.width - pad;
      const ry2 = b.y + b.height - pad;
      if (rx2 <= rx1 || ry2 <= ry1) continue;
      if (Math.abs(seg.y1 - seg.y2) < 0.51) {
        const y = seg.y1;
        if (y > ry1 && y < ry2) {
          const lo = Math.min(seg.x1, seg.x2);
          const hi = Math.max(seg.x1, seg.x2);
          if (Math.min(hi, rx2) - Math.max(lo, rx1) > 6) {
            hit = true;
            console.log(
              "H-hit",
              c.id.slice(0, 18),
              "thru",
              b.functionCode,
              "segY",
              y,
              "box",
              b.x,
              b.y,
              b.width,
              b.height,
              "seg",
              seg
            );
            break;
          }
        }
      } else if (Math.abs(seg.x1 - seg.x2) < 0.51) {
        const x = seg.x1;
        if (x > rx1 && x < rx2) {
          const lo = Math.min(seg.y1, seg.y2);
          const hi = Math.max(seg.y1, seg.y2);
          if (Math.min(hi, ry2) - Math.max(lo, ry1) > 6) {
            hit = true;
            console.log(
              "V-hit",
              c.id.slice(0, 18),
              "thru",
              b.functionCode,
              "segX",
              x,
              "box",
              b.x,
              b.y,
              b.width,
              b.height
            );
            break;
          }
        }
      }
    }
    if (hit) break;
  }
  if (hit) {
    hitConns++;
    if (hitConns >= 5) break;
  }
}
console.log("hitConns sampled", hitConns);
