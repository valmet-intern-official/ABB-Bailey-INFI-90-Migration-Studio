import type { DecodedM1 } from "../decoder/types";

export type TemplateStatus = "EXTERNAL_UNRESOLVED" | "EMBEDDED";

export interface TemplateInfo {
  name: string;
  status: TemplateStatus;
  instanceCount: number;
  instances: number[];
  inModelRegistry: boolean;
  inMarkerSymbolList: boolean;
  propertyKeys: string[];
  evidence: string[];
}

export interface TemplateReport {
  modelRegistry: string[];
  markerSymbols: string[];
  templates: TemplateInfo[];
  externalDependencies: string[];
}

/**
 * Templates referenced by ModInst are resolved against geometry embedded in
 * this file. The supplied corpus contains no template definition records, so
 * every template is EXTERNAL_UNRESOLVED unless a definition is found.
 */
export function analyzeTemplates(m1: DecodedM1): TemplateReport {
  const model = m1.records.find((r) => r.className === "Model");
  const modelRegistry = ((model?.decoded as { templates?: string[] })?.templates ?? []).slice();
  const markerSymbols = m1.records
    .filter((r) => r.className === "Marker")
    .flatMap((r) => (r.decoded as { symbolNames?: string[] }).symbolNames ?? []);
  const embeddedDefinitions = new Set<string>();

  const byName = new Map<string, TemplateInfo>();
  for (const r of m1.records) {
    if (r.className !== "ModInst") continue;
    const d = r.decoded as { templateName: string; props: { key: string }[] };
    const t = byName.get(d.templateName) ?? {
      name: d.templateName,
      status: embeddedDefinitions.has(d.templateName) ? "EMBEDDED" : "EXTERNAL_UNRESOLVED",
      instanceCount: 0,
      instances: [],
      inModelRegistry: modelRegistry.includes(d.templateName),
      inMarkerSymbolList: markerSymbols.includes(d.templateName),
      propertyKeys: [],
      evidence: [],
    };
    t.instanceCount++;
    t.instances.push(r.id);
    for (const p of d.props) if (!t.propertyKeys.includes(p.key)) t.propertyKeys.push(p.key);
    byName.set(d.templateName, t);
  }
  for (const t of byName.values()) {
    if (t.status === "EXTERNAL_UNRESOLVED") t.evidence.push("no definition record for this template exists in the file");
    if (t.inModelRegistry) t.evidence.push("listed in the Model template registry");
    if (t.inMarkerSymbolList) t.evidence.push("listed in a Marker _FP$SN_ external symbol list");
    t.propertyKeys.sort();
  }
  const templates = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  return {
    modelRegistry,
    markerSymbols,
    templates,
    externalDependencies: templates.filter((t) => t.status === "EXTERNAL_UNRESOLVED").map((t) => t.name),
  };
}
