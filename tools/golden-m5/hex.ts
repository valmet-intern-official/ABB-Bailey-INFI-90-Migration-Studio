import fs from "node:fs";

const [file, startArg = "0", lenArg = "512"] = process.argv.slice(2);
const buf = fs.readFileSync(file);
const start = Number(startArg);
const len = Number(lenArg);
for (let at = start; at < Math.min(buf.length, start + len); at += 16) {
  const row = buf.subarray(at, Math.min(at + 16, buf.length));
  const hex = [...row].map((b) => b.toString(16).padStart(2, "0")).join(" ");
  const words = [];
  for (let i = 0; i + 1 < row.length; i += 2) words.push(row.readUInt16LE(i).toString().padStart(5));
  const asc = [...row].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("");
  console.log(`${at.toString().padStart(7)} ${hex.padEnd(48)} ${words.join(" ").padEnd(48)} ${asc}`);
}
