import type {
  CadConnection,
  CadLogicBlock,
  EngineeringSheetModel,
} from "@infi90/core";
import { classifySymbol, type SymbolRole } from "../semantic/classify";

export type LayoutRole =
  | "input"
  | "logic"
  | "output"
  | "junction"
  | "io"
  | "other";

export interface LogicNode {
  id: string;
  block: CadLogicBlock;
  role: LayoutRole;
  layer: number;
  order: number;
  groupId?: string;
  width: number;
  height: number;
  x: number;
  y: number;
  /** Incoming / outgoing edge ids. */
  inEdges: string[];
  outEdges: string[];
  isFeedback: boolean;
}

export interface LogicEdge {
  id: string;
  connection: CadConnection;
  sourceId?: string;
  targetId?: string;
  priority: number;
  isFeedback: boolean;
  sourcePortSide: "left" | "right" | "top" | "bottom";
  targetPortSide: "left" | "right" | "top" | "bottom";
  sourcePortOffset: number;
  targetPortOffset: number;
  waypoints: { x: number; y: number }[];
}

export interface LogicGraph {
  nodes: Map<string, LogicNode>;
  edges: LogicEdge[];
  /** Stable node id order for determinism. */
  nodeOrder: string[];
}

export function roleOf(block: CadLogicBlock): LayoutRole {
  if (block.type === "Junction") return "junction";
  const role: SymbolRole = classifySymbol(block.functionCode);
  if (role === "input-ref") return "input";
  if (role === "output-ref") return "output";
  if (role === "io-module") return "io";
  if (role === "logic") return "logic";
  if (role === "connector") return "junction";
  return "other";
}

/**
 * Build a layout graph from the engineering model without dropping any
 * block or connection. Drawing-rule polylines without endpoints stay as edges
 * with missing ends (routed as decorative or skipped by the router).
 */
export function buildLogicGraph(model: EngineeringSheetModel): LogicGraph {
  const nodes = new Map<string, LogicNode>();
  const nodeOrder: string[] = [];

  for (const block of model.blocks) {
    const role = roleOf(block);
    const node: LogicNode = {
      id: block.id,
      block,
      role,
      layer: 0,
      order: 0,
      width: block.width,
      height: block.height,
      x: block.x,
      y: block.y,
      inEdges: [],
      outEdges: [],
      isFeedback: false,
    };
    nodes.set(block.id, node);
    nodeOrder.push(block.id);
  }

  // Deterministic order: by source Y then X then id.
  nodeOrder.sort((a, b) => {
    const na = nodes.get(a)!;
    const nb = nodes.get(b)!;
    const syA = na.block.sourceGeometry?.originalY ?? na.block.y;
    const syB = nb.block.sourceGeometry?.originalY ?? nb.block.y;
    if (syA !== syB) return syA - syB;
    const sxA = na.block.sourceGeometry?.originalX ?? na.block.x;
    const sxB = nb.block.sourceGeometry?.originalX ?? nb.block.x;
    if (sxA !== sxB) return sxA - sxB;
    return a.localeCompare(b);
  });

  const edges: LogicEdge[] = [];
  for (const conn of model.connections) {
    // Skip pure drawing furniture (no endpoints) from logic routing, but keep
    // them in the model; layout pipeline filters these separately.
    const edge: LogicEdge = {
      id: conn.id,
      connection: conn,
      sourceId: conn.sourceBlockId,
      targetId: conn.targetBlockId,
      priority: 2,
      isFeedback: false,
      sourcePortSide: "right",
      targetPortSide: "left",
      sourcePortOffset: 0,
      targetPortOffset: 0,
      waypoints: [],
    };
    edges.push(edge);
    if (conn.sourceBlockId && nodes.has(conn.sourceBlockId)) {
      nodes.get(conn.sourceBlockId)!.outEdges.push(conn.id);
    }
    if (conn.targetBlockId && nodes.has(conn.targetBlockId)) {
      nodes.get(conn.targetBlockId)!.inEdges.push(conn.id);
    }
  }

  // Stable edge order.
  edges.sort((a, b) => a.id.localeCompare(b.id));

  return { nodes, edges, nodeOrder };
}

/** Edges that participate in logic routing (have at least one endpoint). */
export function routableEdges(graph: LogicGraph): LogicEdge[] {
  return graph.edges.filter((e) => e.sourceId || e.targetId);
}
