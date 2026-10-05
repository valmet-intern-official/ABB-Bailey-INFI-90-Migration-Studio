import fs from "node:fs";

const [file, ...needles] = process.argv.slice(2);
const buf = fs.readFileSync(file);
for (const n of needles) {
  const pat = Buffer.from(n.padEnd(8, " "), "latin1");
  const hits: number[] = [];
  for (let i = buf.indexOf(pat); i !== -1; i = buf.indexOf(pat, i + 1)) hits.push(i);
  console.log(`${n.padEnd(10)} ${hits.length} hits: ${hits.slice(0, 12).map((h) => `${h}(blk ${Math.floor(h / 512) + 1}+${h % 512})`).join(" ")}`);
}
