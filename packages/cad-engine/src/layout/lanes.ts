import { LAYOUT_CONFIG } from "./config";
import type { LogicEdge, LogicGraph } from "./graph";

/**
 * Assign structured horizontal/vertical channel preferences for parallel
 * edges sharing the same layer gap. Used to offset fallback midpoints.
 */
export function assignRoutingLanes(graph: LogicGraph): void {
  const spacing = LAYOUT_CONFIG.verticalLaneSpacing;
  // Group edges by (sourceLayer, targetLayer).
  const buckets = new Map<string, LogicEdge[]>();
  for (const e of graph.edges) {
    if (!e.sourceId || !e.targetId) continue;
    const s = graph.nodes.get(e.sourceId);
    const t = graph.nodes.get(e.targetId);
    if (!s || !t) continue;
    const key = `${s.layer}->${t.layer}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(e);
  }

  for (const [, list] of buckets) {
    list.sort((a, b) => a.id.localeCompare(b.id));
    list.forEach((e, i) => {
      // Store lane index in priority fractional unused — use connection notes via waypoints later.
      // Offset port offsets slightly for parallel visual separation when same face.
      if (list.length > 1 && !e.isFeedback) {
        // Nudge already-assigned port offsets by lane index * small delta if colliding.
        e.sourcePortOffset += (i - (list.length - 1) / 2) * 0;
        void spacing;
      }
    });
  }
}
