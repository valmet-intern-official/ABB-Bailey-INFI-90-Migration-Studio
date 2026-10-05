import type { LogicEdge, LogicGraph } from "./graph";

/**
 * Assign hierarchical layers (columns):
 *   0 = inputs / IREF
 *   1..N = logic by longest-path depth from inputs (through junctions)
 *   max+1 = outputs / OREF
 */
export function assignLayers(graph: LogicGraph): void {
  const { nodes, edges, nodeOrder } = graph;

  for (const id of nodeOrder) {
    const n = nodes.get(id)!;
    if (n.role === "input" || n.role === "io") n.layer = 0;
    else if (n.role === "output") n.layer = 1000;
    else if (n.role === "junction") n.layer = 0;
    else n.layer = 1;
  }

  const logicIds = nodeOrder.filter((id) => {
    const r = nodes.get(id)!.role;
    return r === "logic" || r === "other";
  });

  // Longest-path: junctions carry layer without +1; logic advances +1.
  for (let pass = 0; pass < nodeOrder.length + 4; pass++) {
    let changed = false;
    for (const e of edges) {
      if (!e.sourceId || !e.targetId) continue;
      const s = nodes.get(e.sourceId);
      const t = nodes.get(e.targetId);
      if (!s || !t) continue;
      if (s.layer >= 1000) continue;

      if (t.role === "junction") {
        if (s.layer > t.layer) {
          t.layer = s.layer;
          changed = true;
        }
        continue;
      }
      if (t.role === "output") continue;
      if (t.role !== "logic" && t.role !== "other") continue;

      const advance = s.layer + 1;
      if (advance > t.layer && advance < 40) {
        t.layer = advance;
        changed = true;
      }
    }
    if (!changed) break;
  }

  let maxLogic = 1;
  for (const id of logicIds) {
    maxLogic = Math.max(maxLogic, nodes.get(id)!.layer);
  }
  for (const id of nodeOrder) {
    const n = nodes.get(id)!;
    if (n.role === "output") n.layer = maxLogic + 1;
    if (n.role === "input" || n.role === "io") n.layer = 0;
  }

  for (const e of edges) {
    if (!e.sourceId || !e.targetId) continue;
    const s = nodes.get(e.sourceId)!;
    const t = nodes.get(e.targetId)!;
    if (t.layer <= s.layer && s.role !== "junction" && t.role !== "junction") {
      e.isFeedback = true;
      e.priority = 5;
      t.isFeedback = true;
    } else if (s.role === "input" || t.role === "output") {
      e.priority = 1;
    } else {
      e.priority = 2;
    }
  }
}

/** Order nodes within each layer by source Y (deterministic). */
export function orderNodesWithinLayers(graph: LogicGraph): Map<number, string[]> {
  const byLayer = new Map<number, string[]>();
  for (const id of graph.nodeOrder) {
    const n = graph.nodes.get(id)!;
    if (!byLayer.has(n.layer)) byLayer.set(n.layer, []);
    byLayer.get(n.layer)!.push(id);
  }
  for (const [, ids] of byLayer) {
    ids.sort((a, b) => {
      const na = graph.nodes.get(a)!;
      const nb = graph.nodes.get(b)!;
      const ya = na.block.sourceGeometry?.originalY ?? na.block.y;
      const yb = nb.block.sourceGeometry?.originalY ?? nb.block.y;
      if (ya !== yb) return ya - yb;
      return a.localeCompare(b);
    });
    ids.forEach((id, i) => {
      graph.nodes.get(id)!.order = i;
    });
  }
  return byLayer;
}

export function markEdgePriorities(edges: LogicEdge[]): void {
  edges.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}
