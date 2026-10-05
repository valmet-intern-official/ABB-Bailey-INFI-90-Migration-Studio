import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  runExtraction,
  runSummaryFiles,
  writeFilePackage,
  writeOutputFiles,
  type ExtractionResult,
  type FileFailure,
} from "@infi90/m1-engine";
import { ensureDataRoot } from "@/lib/store";

export interface M1SessionIndex {
  id: string;
  createdAt: string;
  referenceUsed: boolean;
  paletteSource: ExtractionResult["paletteSource"];
  files: { name: string; sourceFile: string }[];
  /** Files skipped because they could not be decoded or rendered. */
  failures?: FileFailure[];
  failedGateItems?: string[];
}

export interface M1JobStatus {
  id: string;
  state: "running" | "done" | "failed";
  total: number | null;
  done: number;
  current: string | null;
  failures: FileFailure[];
  error?: string;
  startedAt: string;
  updatedAt: string;
}

/** A running job that has not reported progress for this long was interrupted (e.g. server restart). */
const STALE_MS = 3 * 60 * 1000;
const MAX_CONCURRENT_JOBS = 2;
const jobs = ((globalThis as { __m1Jobs?: Set<string> }).__m1Jobs ??= new Set<string>());

const ID_RE = /^[a-f0-9]{16}$/;

export function isValidSessionId(id: string) {
  return ID_RE.test(id);
}

export function m1SessionDir(id: string) {
  if (!isValidSessionId(id)) throw new Error("invalid session id");
  return path.join(ensureDataRoot(), "sessions", `m1-${id}`);
}

export function m1PackageDir(id: string) {
  return path.join(m1SessionDir(id), "package");
}

export class M1BusyError extends Error {}

function statusPath(id: string) {
  return path.join(m1SessionDir(id), "status.json");
}

function writeStatus(s: M1JobStatus) {
  const p = statusPath(s.id);
  fs.writeFileSync(`${p}.tmp`, JSON.stringify(s));
  fs.renameSync(`${p}.tmp`, p);
}

/**
 * Start decoding in the background and return immediately. Each graphic is
 * written to disk as soon as it is rendered, so memory stays flat regardless
 * of how many M1 files the upload contains. Poll `loadM1Status` for progress.
 */
export function startM1Session(uploads: { name: string; data: Buffer }[], reference: Buffer | null): { id: string } {
  if (jobs.size >= MAX_CONCURRENT_JOBS) {
    throw new M1BusyError("Another M1 decode is already running. Try again when it finishes.");
  }
  const id = crypto.randomBytes(8).toString("hex");
  fs.mkdirSync(m1SessionDir(id), { recursive: true });
  const now = new Date().toISOString();
  const status: M1JobStatus = { id, state: "running", total: null, done: 0, current: null, failures: [], startedAt: now, updatedAt: now };
  writeStatus(status);
  jobs.add(id);
  void runM1Job(id, uploads, reference, status).finally(() => jobs.delete(id));
  return { id };
}

async function runM1Job(id: string, uploads: { name: string; data: Buffer }[], reference: Buffer | null, status: M1JobStatus) {
  const pkg = m1PackageDir(id);
  const files: M1SessionIndex["files"] = [];
  let lastWrite = 0;
  const touch = (force = false) => {
    const t = Date.now();
    if (!force && t - lastWrite < 500) return;
    lastWrite = t;
    status.updatedAt = new Date(t).toISOString();
    writeStatus(status);
  };
  const started = Date.now();
  try {
    // Let the upload response go out before the synchronous ZIP expansion starts.
    await new Promise((r) => setImmediate(r));
    const result = await runExtraction(uploads, {
      reference: reference ?? undefined,
      retainFiles: false,
      onFile: (f) => {
        writeFilePackage(pkg, f);
        files.push({ name: f.name, sourceFile: f.analysis.decoded.file });
      },
      onFileProgress: (done, total, file) => {
        status.done = done;
        status.total = total;
        status.current = file.split("/").pop() ?? file;
        touch();
      },
    });
    writeOutputFiles(pkg, runSummaryFiles(result));
    const index: M1SessionIndex = {
      id,
      createdAt: status.startedAt,
      referenceUsed: Boolean(reference),
      paletteSource: result.paletteSource,
      files,
      failures: result.failures,
      failedGateItems: result.qualityGate.filter((g) => g.status === "FAIL").map((g) => g.item),
    };
    fs.writeFileSync(path.join(m1SessionDir(id), "session.json"), JSON.stringify(index, null, 2));
    status.state = "done";
    status.failures = result.failures;
    status.current = null;
    touch(true);
    console.info(JSON.stringify({ event: "m1.extract.complete", id, files: files.length, failed: result.failures.length, ms: Date.now() - started, reference: Boolean(reference) }));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ event: "m1.extract.failed", id, error }));
    fs.rmSync(pkg, { recursive: true, force: true });
    status.state = "failed";
    status.error = error;
    status.current = null;
    touch(true);
  }
}

export function loadM1Status(id: string): M1JobStatus | null {
  const p = statusPath(id);
  if (!fs.existsSync(p)) {
    // Sessions created before background jobs existed have only session.json.
    const index = loadM1Index(id);
    if (!index) return null;
    return { id, state: "done", total: index.files.length, done: index.files.length, current: null, failures: index.failures ?? [], startedAt: index.createdAt, updatedAt: index.createdAt };
  }
  const s = JSON.parse(fs.readFileSync(p, "utf8")) as M1JobStatus;
  if (s.state === "running" && !jobs.has(id) && Date.now() - Date.parse(s.updatedAt) > STALE_MS) {
    return { ...s, state: "failed", error: "Decoding was interrupted (the server restarted). Please upload again." };
  }
  return s;
}

export function loadM1Index(id: string): M1SessionIndex | null {
  const p = path.join(m1SessionDir(id), "session.json");
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as M1SessionIndex) : null;
}

export interface M1Category {
  id: string;
  name: string;
  /** M1 file names (`M1SessionIndex.files[].name`), in session order. */
  files: string[];
}

const CATEGORY_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_CATEGORY_NAME = 80;

function categoriesPath(id: string) {
  return path.join(m1SessionDir(id), "categories.json");
}

export function loadM1Categories(id: string): M1Category[] {
  const p = categoriesPath(id);
  if (!fs.existsSync(p)) return [];
  const raw = JSON.parse(fs.readFileSync(p, "utf8")) as { categories?: M1Category[] };
  return raw.categories ?? [];
}

/**
 * Validate and persist the full category list. Unknown file names, duplicate ids
 * and blank names are rejected rather than silently dropped.
 */
export function saveM1Categories(id: string, input: unknown): M1Category[] {
  const index = loadM1Index(id);
  if (!index) throw new Error("session not found");
  if (!Array.isArray(input)) throw new Error("categories must be an array");
  const order = new Map(index.files.map((f, i) => [f.name, i]));
  const ids = new Set<string>();
  const names = new Set<string>();
  const out: M1Category[] = input.map((c, i) => {
    const cat = c as Partial<M1Category>;
    if (typeof cat.id !== "string" || !CATEGORY_ID_RE.test(cat.id)) throw new Error(`category ${i + 1}: invalid id`);
    if (ids.has(cat.id)) throw new Error(`category ${i + 1}: duplicate id`);
    ids.add(cat.id);
    const name = typeof cat.name === "string" ? cat.name.trim() : "";
    if (!name) throw new Error(`category ${i + 1}: name is required`);
    if (name.length > MAX_CATEGORY_NAME) throw new Error(`category "${name.slice(0, 20)}…": name too long`);
    if (names.has(name.toLowerCase())) throw new Error(`category "${name}" already exists`);
    names.add(name.toLowerCase());
    if (!Array.isArray(cat.files)) throw new Error(`category "${name}": files must be an array`);
    const files = [...new Set(cat.files)];
    for (const f of files) {
      if (typeof f !== "string" || !order.has(f)) throw new Error(`category "${name}": unknown file ${String(f)}`);
    }
    files.sort((a, b) => order.get(a)! - order.get(b)!);
    return { id: cat.id, name, files };
  });
  fs.writeFileSync(categoriesPath(id), JSON.stringify({ categories: out }, null, 2));
  return out;
}

/** Resolve a package-relative path, refusing anything outside the package. */
export function resolvePackagePath(id: string, rel: string): string | null {
  const root = path.resolve(m1PackageDir(id));
  const target = path.resolve(root, rel);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return fs.existsSync(target) && fs.statSync(target).isFile() ? target : null;
}