import type { CadAnnotation } from "@infi90/core";
import type { LogicGraph, LogicNode } from "./graph";

export interface LayoutGroup {
  id: string;
  label: string;
  /** Source Y band used to associate nodes. */
  sourceY: number;
  nodeIds: string[];
}

const STEP_RE = /\bSTEP\s*[-_]?\s*(\d+)\b/i;

/**
 * Detect STEP annotations and cluster nearby logic nodes by source Y so
 * repeated sequences share geometry. Does not invent STEP order — uses
 * annotation text and source coordinates only.
 */
export function identifyLogicalGroups(
  graph: LogicGraph,
  annotations: CadAnnotation[]
): LayoutGroup[] {
  const steps: { label: string; y: number; order: number }[] = [];
  for (const a of annotations) {
    const m = a.text.match(STEP_RE);
    if (!m) continue;
    const n = Number(m[1]);
    steps.push({
      label: `STEP ${n}`,
      y: a.y,
      order: Number.isFinite(n) ? n : 0,
    });
  }
  // Preserve source placement order (by Y), not fabricated sequence.
  steps.sort((a, b) => a.y - b.y || a.order - b.order);

  if (steps.length === 0) {
    // Fall back: cluster logic nodes by source Y gaps into pseudo-groups.
    return clusterBySourceY(graph);
  }

  const groups: LayoutGroup[] = steps.map((s, i) => ({
    id: `step-${i}-${s.label.replace(/\s+/g, "")}`,
    label: s.label,
    sourceY: s.y,
    nodeIds: [],
  }));

  const logicNodes = graph.nodeOrder
    .map((id) => graph.nodes.get(id)!)
    .filter((n) => n.role === "logic" || n.role === "other" || n.role === "junction");

  for (const n of logicNodes) {
    const sy = n.block.sourceGeometry?.originalY ?? n.block.y;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < groups.length; i++) {
      const d = Math.abs(sy - groups[i].sourceY);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    groups[best].nodeIds.push(n.id);
    n.groupId = groups[best].id;
  }

  return groups.filter((g) => g.nodeIds.length > 0);
}

function clusterBySourceY(graph: LogicGraph): LayoutGroup[] {
  const logic = graph.nodeOrder
    .map((id) => graph.nodes.get(id)!)
    .filter((n) => n.role === "logic" || n.role === "other")
    .sort((a, b) => {
      const ya = a.block.sourceGeometry?.originalY ?? a.block.y;
      const yb = b.block.sourceGeometry?.originalY ?? b.block.y;
      return ya - yb;
    });

  if (logic.length === 0) return [];

  const GAP = 80;
  const groups: LayoutGroup[] = [];
  let current: LayoutGroup = {
    id: "grp-0",
    label: "GROUP 1",
    sourceY: logic[0].block.sourceGeometry?.originalY ?? logic[0].block.y,
    nodeIds: [],
  };
  groups.push(current);
  let prevY = current.sourceY;

  for (const n of logic) {
    const y = n.block.sourceGeometry?.originalY ?? n.block.y;
    if (y - prevY > GAP && current.nodeIds.length > 0) {
      current = {
        id: `grp-${groups.length}`,
        label: `GROUP ${groups.length + 1}`,
        sourceY: y,
        nodeIds: [],
      };
      groups.push(current);
    }
    current.nodeIds.push(n.id);
    n.groupId = current.id;
    prevY = y;
  }
  return groups;
}

/** Align corresponding ordinals across groups to the same relative order slots. */
export function alignRepeatedGroups(graph: LogicGraph, groups: LayoutGroup[]): void {
  if (groups.length < 2) return;
  // Within each group, sort by layer then source X then id — assign local index.
  const templates = groups.map((g) => {
    const ids = [...g.nodeIds].sort((a, b) => {
      const na = graph.nodes.get(a)!;
      const nb = graph.nodes.get(b)!;
      if (na.layer !== nb.layer) return na.layer - nb.layer;
      const xa = na.block.sourceGeometry?.originalX ?? na.block.x;
      const xb = nb.block.sourceGeometry?.originalX ?? nb.block.x;
      if (xa !== xb) return xa - xb;
      return a.localeCompare(b);
    });
    return ids;
  });
  // Use max length as template; order field within layer already set — reinforce group-local order.
  for (const ids of templates) {
    ids.forEach((id, i) => {
      const n = graph.nodes.get(id);
      if (n) n.order = i;
    });
  }
}
