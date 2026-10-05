/**
 * Golden-master digest of a module build: per-collection counts and content
 * hashes of the structured outputs (entities, function blocks, specs,
 * terminals, sub-blocks, wires, connections, references, channels,
 * unresolved, drawn annotations). Plot stamps are excluded because they
 * come from archive metadata, which differs between a ZIP and a folder.
 */
import crypto from "node:crypto";
import type { EngineeringDocument } from "./render/document";
import type { SceneGraph } from "./types";
import type { Defect } from "./verify";

const sha = (v: unknown) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");

export interface GoldenDigest {
  module: string;
  counts: Record<string, number>;
  hashes: Record<string, string>;
  terminal_methods: Record<string, number>;
  annotations: Record<string, number>;
  coverage: Array<{ category: string; parsed: number; rendered_drawing: number; rendered_detail: number; listed_annex: number; not_rendered_anywhere: number }>;
  defects: number;
}

export function goldenDigest(scene: SceneGraph, doc: EngineeringDocument, defects: Defect[]): GoldenDigest {
  const ann = doc.annotations.filter((a) => a.kind !== "plot_stamp");
  const sets = {
    entities: scene.entities,
    function_blocks: scene.function_blocks,
    specifications: scene.specifications,
    terminals: scene.terminals,
    sub_blocks: scene.sub_blocks,
    wires: scene.wires,
    connections: scene.connections,
    references: scene.references,
    channels: scene.channels,
    unresolved: scene.unresolved.filter((u) => u.kind !== "plot_stamp"),
    annotations: ann,
  };
  return {
    module: scene.module.name,
    counts: Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, v.length])),
    hashes: Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, sha(v)])),
    terminal_methods: scene.terminal_validation.by_method,
    annotations: ann.reduce<Record<string, number>>((a, r) => ((a[`${r.kind}|${r.layer}`] = (a[`${r.kind}|${r.layer}`] ?? 0) + 1), a), {}),
    coverage: doc.coverage.filter((r) => r.category !== "plot_stamp" && r.category !== "unresolved").map(({ category, parsed, rendered_drawing, rendered_detail, listed_annex, not_rendered_anywhere }) => ({ category, parsed, rendered_drawing, rendered_detail, listed_annex, not_rendered_anywhere })),
    defects: defects.length,
  };
}
