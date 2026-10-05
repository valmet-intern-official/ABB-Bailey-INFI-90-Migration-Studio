import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeM1 } from "../decoder/scanner";
import type { DecodedM1 } from "../decoder/types";
import { normalizeSubmodel } from "./gms";

export interface TemplateLibrary {
  /** Directory roots that were indexed, in search order. */
  roots: string[];
  /** Decode the submodel named by a ModInst template, or null when it is not in the library. */
  get(name: string): DecodedM1 | null;
  has(name: string): boolean;
}

const DISPLAY = path.join("Guiding Material", "Raw Data from Controller", "Display");
const SUBMODEL_DIRS = [
  path.join("Power Palnt", "submodels"),
  path.join("Fiber Line", "submodels"),
];

function findDisplayRoot(start: string): string | null {
  let dir = path.resolve(start);
  for (let i = 0; i < 8; i++) {
    const hit = path.join(dir, DISPLAY);
    if (fs.existsSync(hit)) return hit;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/** Locate the display submodel directories that ship with this repository. */
export function defaultLibraryDirs(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const starts = [process.cwd(), path.resolve(here, "../../../..")];
  const roots = new Set<string>();
  for (const start of starts) {
    const display = findDisplayRoot(start);
    if (!display) continue;
    for (const rel of SUBMODEL_DIRS) {
      const dir = path.join(display, rel);
      if (fs.existsSync(dir)) roots.add(dir);
    }
  }
  return [...roots];
}

/**
 * Index submodel `.m1` files by template name. Power Plant is searched before
 * Fiber Line, and the first file for a name wins. Files are decoded on first use.
 */
export function loadTemplateLibrary(dirs: string[] = defaultLibraryDirs()): TemplateLibrary | null {
  const index = new Map<string, string>();
  const roots: string[] = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    roots.push(dir);
    for (const name of fs.readdirSync(dir)) {
      if (!/\.m1$/i.test(name)) continue;
      const key = name.replace(/\.m1$/i, "").toLowerCase();
      if (!index.has(key)) index.set(key, path.join(dir, name));
    }
  }
  if (!index.size) return null;
  const cache = new Map<string, DecodedM1 | null>();
  return {
    roots,
    has: (name) => index.has(name.toLowerCase()),
    get(name) {
      const key = name.toLowerCase();
      if (cache.has(key)) return cache.get(key) ?? null;
      const file = index.get(key);
      if (!file) {
        cache.set(key, null);
        return null;
      }
      try {
        const decoded = decodeM1(normalizeSubmodel(fs.readFileSync(file)), path.basename(file), { strict: false });
        cache.set(key, decoded);
        return decoded;
      } catch {
        cache.set(key, null);
        return null;
      }
    },
  };
}
