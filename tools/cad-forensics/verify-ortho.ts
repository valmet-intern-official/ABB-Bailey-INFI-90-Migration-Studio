import fs from "node:fs";

const svg = fs.readFileSync("tools/cad-forensics/out/v2/3070561A.svg", "utf8");
console.log("engine attr", /data-engine="([^"]+)"/.exec(svg)?.[1]);
console.log("footer engine", /engine:(v[12])/.exec(svg)?.[1]);
console.log("bg", /fill="(#[^"]+)"/.exec(svg)?.[1]);

let diag = 0;
let segs = 0;
for (const m of svg.matchAll(/points="([^"]+)"/g)) {
  const pts = m[1].split(/\s+/).map((p) => {
    const [x, y] = p.split(",").map(Number);
    return { x, y };
  });
  for (let i = 1; i < pts.length; i++) {
    segs++;
    const a = pts[i - 1];
    const b = pts[i];
    if (Math.abs(a.x - b.x) > 0.51 && Math.abs(a.y - b.y) > 0.51) diag++;
  }
}
for (const m of svg.matchAll(
  /x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"/g
)) {
  segs++;
  const x1 = +m[1];
  const y1 = +m[2];
  const x2 = +m[3];
  const y2 = +m[4];
  if (Math.abs(x1 - x2) > 0.51 && Math.abs(y1 - y2) > 0.51) diag++;
}
console.log({ segs, diag });
