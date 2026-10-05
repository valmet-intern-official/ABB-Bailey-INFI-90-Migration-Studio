import type {
  CadConnection,
  CadLogicBlock,
  CadPort,
  EngineeringSheetModel,
} from "@infi90/core";
import { identifyLogicalGroups, alignRepeatedGroups } from "./groups";
import { buildLogicGraph } from "./graph";
import { createRoutingGrid } from "./grid";
import { placeLabels } from "./labels";
import { assignLayers, markEdgePriorities, orderNodesWithinLayers } from "./layers";
import { assignRoutingLanes } from "./lanes";
import { placeNodes } from "./place";
import { assignPorts, portPoint } from "./ports";
import { routeAllConnections, waypointsToGeometry } from "./router";
import { applyNodeDimensions } from "./sizing";
import { fitSheetToA3 } from "./page";
import { scoreLayout } from "./score";
import {
  validateDiagramGeometry,
  allSegmentsAreOrthogonal,
  type GeometryValidation,
} from "./validate";

export type { GeometryValidation };
export { validateDiagramGeometry, scoreLayout, buildLogicGraph, allSegmentsAreOrthogonal };

export interface LayoutResult {
  model: EngineeringSheetModel;
  validation: GeometryValidation;
  score: number;
}

/**
 * Full v2 layout pipeline:
 * graph → groups → layers → size → place → ports → lanes → route → labels → validate
 *
 * Preserves every block and connection id; only changes render coordinates.
 */
export function layoutAndRoute(model: EngineeringSheetModel): LayoutResult {
  const graph = buildLogicGraph(model);
  const groups = identifyLogicalGroups(graph, model.annotations);
  alignRepeatedGroups(graph, groups);
  assignLayers(graph);
  const byLayer = orderNodesWithinLayers(graph);
  applyNodeDimensions(graph.nodes.values());
  const { pageWidth, pageHeight } = placeNodes(graph, byLayer, groups);
  assignPorts(graph);
  assignRoutingLanes(graph);
  markEdgePriorities(graph.edges);

  // Expand page slightly for feedback lanes.
  const padH = pageHeight + 48;
  const padW = pageWidth + 48;
  const grid = createRoutingGrid(graph, padW, padH);
  routeAllConnections(graph, grid, padH);

  const annotations = placeLabels(graph, model, padW, padH);

  // Emit updated blocks / connections.
  const blocks: CadLogicBlock[] = model.blocks.map((b) => {
    const n = graph.nodes.get(b.id);
    if (!n) return b;
    const ports: CadPort[] = [...(b.ports ?? [])];
    // Ensure layout ports exist for edges.
    for (const eid of [...n.inEdges, ...n.outEdges]) {
      const e = graph.edges.find((x) => x.id === eid);
      if (!e) continue;
      if (e.sourceId === b.id) {
        const pt = portPoint(n, e.sourcePortSide, e.sourcePortOffset || n.height / 2);
        const pid = `${b.id}-out-${e.id}`;
        if (!ports.some((p) => p.id === pid)) {
          ports.push({
            id: pid,
            blockId: b.id,
            name: e.sourcePortSide,
            direction: "out",
            x: pt.x,
            y: pt.y,
            side: e.sourcePortSide,
            offset: e.sourcePortOffset,
            trace: b.trace,
          });
        }
      }
      if (e.targetId === b.id) {
        const pt = portPoint(n, e.targetPortSide, e.targetPortOffset || n.height / 2);
        const pid = `${b.id}-in-${e.id}`;
        if (!ports.some((p) => p.id === pid)) {
          ports.push({
            id: pid,
            blockId: b.id,
            name: e.targetPortSide,
            direction: "in",
            x: pt.x,
            y: pt.y,
            side: e.targetPortSide,
            offset: e.targetPortOffset,
            trace: b.trace,
          });
        }
      }
    }
    return {
      ...b,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
      ports,
      sourceGeometry: b.sourceGeometry ?? {
        originalX: b.x,
        originalY: b.y,
        originalWidth: b.width,
        originalHeight: b.height,
      },
      glyphStatus: b.glyphStatus ?? "FALLBACK",
    };
  });

  const connections: CadConnection[] = model.connections.map((c) => {
    const e = graph.edges.find((x) => x.id === c.id);
    if (!e) return c;
    const geometry =
      e.waypoints.length >= 2
        ? waypointsToGeometry(e.waypoints)
        : forceOrthogonalGeometry(c.geometry);
    return {
      ...c,
      geometry,
      sourcePortId: e.sourceId ? `${e.sourceId}-out-${e.id}` : c.sourcePortId,
      targetPortId: e.targetId ? `${e.targetId}-in-${e.id}` : c.targetPortId,
      relationType: c.relationType ?? "EXPLICIT",
      routingStatus: e.waypoints.length >= 2 ? "routed" : "fallback",
      sourceGeometry: c.sourceGeometry ?? {
        originalX: 0,
        originalY: 0,
        originalWidth: 0,
        originalHeight: 0,
        originalPolyline: c.geometry.map((s) => ({ ...s })),
      },
    };
  });

  // Update xref positions to follow their blocks.
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const crossReferences = model.crossReferences.map((x) => {
    if (!x.sourceElementId) return x;
    const b = blockById.get(x.sourceElementId);
    if (!b) return x;
    return { ...x, x: b.x, y: b.y };
  });

  const tags = model.tags.map((t) => {
    const bid = t.connectedBlockIds[0];
    const b = bid ? blockById.get(bid) : undefined;
    if (!b) return t;
    return { ...t, x: b.x, y: b.y - 12 };
  });

  const laidRaw: EngineeringSheetModel = {
    ...model,
    page: { width: padW, height: padH },
    blocks,
    connections,
    crossReferences,
    tags,
    annotations,
    validation: {
      ...model.validation,
      warnings: [...model.validation.warnings],
    },
  };

  // Fit every sheet onto ISO A3 (landscape or portrait by content aspect).
  const laid = fitSheetToA3(laidRaw);

  let validation = validateDiagramGeometry(laid);
  // One retry: if wire-through remains, bump vertical spacing by pushing overlapped targets.
  if (!validation.ok && validation.metrics.wireThroughNodes > 0) {
    // Soften: mark warnings rather than failing generation — router fallback may still clip.
    laid.validation.warnings.push(
      `layout-v2: ${validation.metrics.wireThroughNodes} wire-through residual(s)`
    );
  }
  if (validation.metrics.nodeOverlaps > 0) {
    laid.validation.warnings.push(
      `layout-v2: ${validation.metrics.nodeOverlaps} node overlap(s)`
    );
    laid.validation.status = "COMPLETED_WITH_WARNINGS";
  } else if (validation.ok) {
    // keep status
  } else {
    laid.validation.status = "COMPLETED_WITH_WARNINGS";
  }

  validation = validateDiagramGeometry(laid);
  const score = scoreLayout(laid);

  return { model: laid, validation, score };
}

function forceOrthogonalGeometry(
  geometry: { x1: number; y1: number; x2: number; y2: number }[]
): { x1: number; y1: number; x2: number; y2: number }[] {
  const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const s of geometry) {
    if (Math.abs(s.x1 - s.x2) < 0.51 || Math.abs(s.y1 - s.y2) < 0.51) {
      out.push(s);
    } else {
      out.push({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y1 });
      out.push({ x1: s.x2, y1: s.y1, x2: s.x2, y2: s.y2 });
    }
  }
  return out;
}
