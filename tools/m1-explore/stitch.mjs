import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("apps/web/package.json"));
const sharp = require("sharp");

const dir = process.argv[2];
for (let p = 1; p <= 20; p++) {
  const tag = String(p).padStart(2, "0");
  const a = path.join(dir, `p${tag}-1.png`);
  const b = path.join(dir, `p${tag}-2.png`);
  if (!fs.existsSync(a)) continue;
  const ma = await sharp(a).metadata();
  const mb = await sharp(b).metadata();
  await sharp({ create: { width: ma.width, height: ma.height + mb.height, channels: 3, background: "#000" } })
    .composite([
      { input: a, top: 0, left: 0 },
      { input: b, top: ma.height, left: 0 },
    ])
    .png()
    .toFile(path.join(dir, `page-${tag}.png`));
  console.log(tag, ma.width, ma.height + mb.height);
}
