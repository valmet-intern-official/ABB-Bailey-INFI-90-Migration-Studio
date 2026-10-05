import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

export interface InventoryEntry {
  path: string;
  size: number;
  sha256: string;
  kind: "m1" | "pdf" | "other";
  magicOk: boolean | null;
}

export interface ArchiveInventory {
  source: string;
  sourceKind: "zip" | "directory" | "file";
  sha256: string | null;
  entries: InventoryEntry[];
  m1Count: number;
}

export interface SourceFile {
  name: string;
  data: Buffer;
}

const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const MAGIC = Buffer.from("m1gms4u\n", "latin1");

function classify(name: string, data: Buffer): InventoryEntry {
  const isM1 = /\.m1$/i.test(name);
  return {
    path: name,
    size: data.length,
    sha256: sha(data),
    kind: isM1 ? "m1" : /\.pdf$/i.test(name) ? "pdf" : "other",
    magicOk: isM1 ? data.subarray(0, 8).equals(MAGIC) : null,
  };
}

/** Load every file from a zip, directory, or single file, and inventory it. */
export function loadSources(input: string | { name: string; data: Buffer }[]): { inventory: ArchiveInventory; m1: SourceFile[] } {
  let files: SourceFile[] = [];
  let sourceKind: ArchiveInventory["sourceKind"] = "file";
  let sourceHash: string | null = null;
  let source = "(buffers)";
  if (typeof input === "string") {
    source = input;
    const st = fs.statSync(input);
    if (st.isDirectory()) {
      sourceKind = "directory";
      const walk = (d: string, rel: string) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) walk(p, rel + e.name + "/");
          else files.push({ name: rel + e.name, data: fs.readFileSync(p) });
        }
      };
      walk(input, "");
    } else {
      const data = fs.readFileSync(input);
      sourceHash = sha(data);
      if (/\.zip$/i.test(input)) {
        sourceKind = "zip";
        files = expandZip(data);
      } else files = [{ name: path.basename(input), data }];
    }
  } else {
    for (const f of input) {
      if (/\.zip$/i.test(f.name)) files.push(...expandZip(f.data));
      else files.push(f);
    }
    sourceKind = input.some((f) => /\.zip$/i.test(f.name)) ? "zip" : "file";
  }
  const entries = files.map((f) => classify(f.name, f.data));
  const m1 = files.filter((f) => /\.m1$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
  return { inventory: { source, sourceKind, sha256: sourceHash, entries, m1Count: m1.length }, m1 };
}

function expandZip(data: Buffer): SourceFile[] {
  const zip = new AdmZip(data);
  return zip
    .getEntries()
    .filter((e) => !e.isDirectory)
    .map((e) => ({ name: e.entryName, data: e.getData() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
