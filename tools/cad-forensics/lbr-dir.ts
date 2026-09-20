/**
 * Decode the .LBR symbol directory and locate each symbol's body.
 *
 * Directory entries appear at a fixed 16-byte stride: an 8-byte padded name
 * followed by 8 bytes of metadata. This tool tests whether that metadata is an
 * offset/length pair by checking that it points at plausible file positions.
 */
import fs from "node:fs";
import path from "node:path";
import { ascii, lbrCorpus } from "./lib/walk";

const file = process.argv[2] ?? lbrCorpus()[0];
const buf = fs.readFileSync(file);
console.log(`${path.basename(file)}  ${buf.length} bytes\n`);

// Raw view of the directory region.
console.log("directory region +512..+848:");
for (let i = 512; i < 848; i += 16) {
  const row = buf.subarray(i, i + 16);
  const u16: string[] = [];
  const u32: string[] = [];
  for (let j = 0; j + 2 <= row.length; j += 2) u16.push(String(row.readUInt16LE(j)).padStart(6));
  for (let j = 0; j + 4 <= row.length; j += 4) u32.push(String(row.readUInt32LE(j)).padStart(9));
  console.log(`  +${String(i).padStart(6)}  |${ascii(row)}|`);
  console.log(`             u16:${u16.join("")}`);
  console.log(`             u32:${u32.join("")}`);
}

// Walk 16-byte entries while the name field looks like a name.
console.log("\nentries (name + metadata interpreted several ways):");
let count = 0;
for (let at = 528; at + 16 <= buf.length; at += 16) {
  const nameRaw = buf.subarray(at, at + 8).toString("latin1");
  if (!/^[\x20-\x7E]{8}$/.test(nameRaw)) break;
  const name = nameRaw.trim();
  if (name === "") break;
  const meta = buf.subarray(at + 8, at + 16);
  const a16 = meta.readUInt16LE(0);
  const b16 = meta.readUInt16LE(2);
  const c16 = meta.readUInt16LE(4);
  const d16 = meta.readUInt16LE(6);
  const a32 = meta.readUInt32LE(0);
  const b32 = meta.readUInt32LE(4);
  console.log(
    `  @${String(at).padStart(6)}  ${name.padEnd(9)} ` +
      `u16=[${a16},${b16},${c16},${d16}]  u32=[${a32},${b32}]  ` +
      `${a32 < buf.length ? "a32-in-file" : ""} ${b32 < buf.length ? "b32-in-file" : ""}`
  );
  count++;
  if (count > 40) break;
}
console.log(`\n${count} directory entries read`);
