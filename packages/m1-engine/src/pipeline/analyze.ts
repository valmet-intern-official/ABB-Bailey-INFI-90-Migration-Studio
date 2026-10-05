import { decodeM1 } from "../decoder/scanner";
import type { DecodedM1, FieldStatus } from "../decoder/types";
import { buildObjectGraph, type ObjectGraph } from "../objects/graph";
import { analyzeTemplates, type TemplateReport } from "../templates/templates";
import { buildTagIndex, extractBindings, type InstanceBindings, type TagIndexEntry } from "../bindings/bindings";
import { buildLogicGraph, type LogicGraph } from "../logic/logic";
import { buildSceneGraph, type SceneGraph } from "../scene/scene";
import type { TemplateLibrary } from "../templates/library";

export interface FieldStatusStats {
  bytes: Record<FieldStatus, number>;
  fields: Record<FieldStatus, number>;
}

export interface DecodeClaim {
  /** Never "FULLY_DECODED": semantics of UNRESOLVED fields and external templates are open. */
  bytes: "ALL_BYTES_TYPED" | "COVERAGE_FAILED";
  semantics: "PARTIAL";
  rendering: "COMPLETE_FOR_EMBEDDED_GEOMETRY" | "PARTIAL_EXTERNAL_TEMPLATES";
  reasons: string[];
}

export interface M1Analysis {
  decoded: DecodedM1;
  graph: ObjectGraph;
  templates: TemplateReport;
  bindings: InstanceBindings[];
  tagIndex: TagIndexEntry[];
  logic: LogicGraph;
  scene: SceneGraph;
  fieldStats: FieldStatusStats;
  claim: DecodeClaim;
}

export function fieldStatusStats(d: DecodedM1): FieldStatusStats {
  const bytes: Record<FieldStatus, number> = { KNOWN: 0, CANDIDATE: 0, UNRESOLVED: 0 };
  const fields: Record<FieldStatus, number> = { KNOWN: 0, CANDIDATE: 0, UNRESOLVED: 0 };
  for (const f of d.header.fields) {
    bytes[f.status] += f.length;
    fields[f.status]++;
  }
  for (const r of d.records)
    for (const f of r.fields) {
      bytes[f.status] += f.length;
      fields[f.status]++;
    }
  return { bytes, fields };
}

export function analyzeM1(file: string, data: Buffer, opts: { strict?: boolean; library?: TemplateLibrary | null } = {}): M1Analysis {
  const decoded = decodeM1(data, file, { strict: opts.strict ?? false });
  const graph = buildObjectGraph(decoded);
  const templates = analyzeTemplates(decoded);
  const bindings = extractBindings(decoded);
  const tagIndex = buildTagIndex(bindings);
  const logic = buildLogicGraph(decoded);
  const scene = buildSceneGraph(decoded, { library: opts.library });
  const fieldStats = fieldStatusStats(decoded);

  const reasons: string[] = [];
  const bytesOk = decoded.coverage.ok && decoded.coverage.fieldLevel.unresolvedBytes === 0;
  if (!decoded.coverage.ok) reasons.push(`record coverage failed: ${decoded.coverage.gaps.length} gap(s)/overlap(s)`);
  if (decoded.coverage.fieldLevel.unresolvedBytes) reasons.push(`${decoded.coverage.fieldLevel.unresolvedBytes} byte(s) not assigned to typed fields`);
  if (fieldStats.fields.UNRESOLVED) reasons.push(`${fieldStats.fields.UNRESOLVED} field(s) are typed but their meaning is UNRESOLVED`);
  if (templates.externalDependencies.length) reasons.push(`${templates.externalDependencies.length} template(s) are external: ${templates.externalDependencies.join(", ")}`);
  if (logic.nodes.some((n) => n.status === "UNRESOLVED_SEMANTICS")) reasons.push("logic operator/action codes are preserved raw (semantics unresolved)");
  return {
    decoded,
    graph,
    templates,
    bindings,
    tagIndex,
    logic,
    scene,
    fieldStats,
    claim: {
      bytes: bytesOk ? "ALL_BYTES_TYPED" : "COVERAGE_FAILED",
      semantics: "PARTIAL",
      rendering: templates.externalDependencies.length ? "PARTIAL_EXTERNAL_TEMPLATES" : "COMPLETE_FOR_EMBEDDED_GEOMETRY",
      reasons,
    },
  };
}
