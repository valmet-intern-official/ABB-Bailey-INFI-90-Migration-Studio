import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeM1 } from "../src/decoder/scanner";
import type { DecodedM1 } from "../src/decoder/types";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "../../..");
export const CORPUS_DIR = path.join(REPO_ROOT, "Guiding Material/Test 1 Data - Graphics/M10");
export const GOLDEN_DIR = path.join(here, "golden");

export const corpusAvailable = fs.existsSync(CORPUS_DIR);

export function corpusFiles(): { name: string; data: Buffer }[] {
  if (!corpusAvailable) return [];
  return fs
    .readdirSync(CORPUS_DIR)
    .filter((f) => /\.m1$/i.test(f))
    .sort()
    .map((name) => ({ name, data: fs.readFileSync(path.join(CORPUS_DIR, name)) }));
}

const cache = new Map<string, DecodedM1>();
export function decoded(): DecodedM1[] {
  return corpusFiles().map((f) => {
    let d = cache.get(f.name);
    if (!d) {
      d = decodeM1(f.data, f.name);
      cache.set(f.name, d);
    }
    return d;
  });
}

export const skip = corpusAvailable ? false : "reference corpus not present";
