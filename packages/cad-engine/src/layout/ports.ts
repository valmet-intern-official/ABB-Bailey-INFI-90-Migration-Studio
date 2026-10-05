import { LAYOUT_CONFIG } from "./config";
import type { LogicEdge, LogicGraph } from "./graph";

/**
 * Assign connection ports on block faces and distribute multiple edges evenly.
 */
export function assignPorts(graph: LogicGraph): void {
  // Count edges per side per node.
  const inCount = new Map<string, LogicEdge[]>();
  const outCount = new Map<string, LogicEdge[]>();

  for (const e of graph.edges) {
    if (!e.sourceId && !e.targetId) continue;
    if (e.sourceId) {
      if (!outCount.has(e.sourceId)) outCount.set(e.sourceId, []);
      outCount.get(e.sourceId)!.push(e);
    }
    if (e.targetId) {
      if (!inCount.has(e.targetId)) inCount.set(e.targetId, []);
      inCount.get(e.targetId)!.push(e);
    }
  }

  // Sort for determinism.
  for (const [, list] of inCount) list.sort((a, b) => a.id.localeCompare(b.id));
  for (const [, list] of outCount) list.sort((a, b) => a.id.localeCompare(b.id));

  for (const e of graph.edges) {
    if (!e.sourceId || !e.targetId) {
      // Dangling: still assign a default side.
      e.sourcePortSide = "right";
      e.targetPortSide = "left";
      continue;
    }
    const s = graph.nodes.get(e.sourceId)!;
    const t = graph.nodes.get(e.targetId)!;

    if (e.isFeedback) {
      e.sourcePortSide = "bottom";
      e.targetPortSide = "bottom";
    } else {
      // Prefer left/right ports so stubs leave on the face, not through the body.
      if (t.x + t.width / 2 < s.x) {
        e.sourcePortSide = "left";
        e.targetPortSide = "right";
      } else {
        e.sourcePortSide = "right";
        e.targetPortSide = "left";
      }
    }
  }

  // Distribute offsets along each face.
  distributeSide(graph, outCount, "out");
  distributeSide(graph, inCount, "in");
}

function distributeSide(
  graph: LogicGraph,
  map: Map<string, LogicEdge[]>,
  dir: "in" | "out"
): void {
  const spacing = LAYOUT_CONFIG.portSpacing;
  for (const [nodeId, edges] of map) {
    const n = graph.nodes.get(nodeId);
    if (!n) continue;

    // Group by the side this node uses for these edges.
    const bySide = new Map<string, LogicEdge[]>();
    for (const e of edges) {
      const side = dir === "out" ? e.sourcePortSide : e.targetPortSide;
      if (!bySide.has(side)) bySide.set(side, []);
      bySide.get(side)!.push(e);
    }

    for (const [side, list] of bySide) {
      list.sort((a, b) => {
        // Order by opposite node Y for visual parallel.
        const otherId = dir === "out" ? a.targetId : a.sourceId;
        const otherIdB = dir === "out" ? b.targetId : b.sourceId;
        const oa = otherId ? graph.nodes.get(otherId)?.y ?? 0 : 0;
        const ob = otherIdB ? graph.nodes.get(otherIdB)?.y ?? 0 : 0;
        if (oa !== ob) return oa - ob;
        return a.id.localeCompare(b.id);
      });

      const along = side === "left" || side === "right" ? n.height : n.width;
      const count = list.length;
      const total = (count - 1) * spacing;
      const start = Math.max(spacing / 2, (along - total) / 2);

      list.forEach((e, i) => {
        const offset = Math.min(along - 2, Math.max(2, start + i * spacing));
        if (dir === "out") e.sourcePortOffset = offset;
        else e.targetPortOffset = offset;
      });
    }
  }
}

export function portPoint(
  node: { x: number; y: number; width: number; height: number },
  side: "left" | "right" | "top" | "bottom",
  offset: number
): { x: number; y: number } {
  switch (side) {
    case "left":
      return { x: node.x, y: node.y + offset };
    case "right":
      return { x: node.x + node.width, y: node.y + offset };
    case "top":
      return { x: node.x + offset, y: node.y };
    case "bottom":
      return { x: node.x + offset, y: node.y + node.height };
  }
}
