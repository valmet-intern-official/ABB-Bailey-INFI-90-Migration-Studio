import { LAYOUT_CONFIG } from "./config";
import type { LogicNode } from "./graph";

/**
 * Size a node from its engineering content (label, params, port count).
 */
export function calculateNodeDimensions(node: LogicNode): { width: number; height: number } {
  const { minBlockWidth, minBlockHeight, portSpacing, charWidth } = LAYOUT_CONFIG;

  if (node.role === "junction") {
    return { width: 8, height: 8 };
  }

  const fc = node.block.functionCode ?? "BLOCK";
  const label = node.block.label ?? "";
  const bn = node.block.blockNumber ? `#${node.block.blockNumber}` : "";
  const params = Object.entries(node.block.parameters)
    .filter(([k]) => k.startsWith("S") || k === "TO" || /^TO=/i.test(k))
    .map(([k, v]) => `${k}=${v}`);
  // Timer text often lives as raw annotation; also surface S-params briefly.
  const paramLine = params.slice(0, 2).join(" ");

  const lines = [fc, bn, label, paramLine].filter(Boolean);
  const maxChars = Math.max(...lines.map((l) => l.length), 6);
  const portCount = Math.max(
    1,
    node.inEdges.length,
    node.outEdges.length,
    node.block.ports?.length ?? 0
  );

  const width = Math.max(minBlockWidth, Math.ceil(maxChars * charWidth + 16));
  const height = Math.max(
    minBlockHeight,
    Math.ceil(portCount * portSpacing + 16),
    Math.ceil(lines.filter(Boolean).length * 14 + 10)
  );

  return { width, height };
}

export function applyNodeDimensions(nodes: Iterable<LogicNode>): void {
  for (const n of nodes) {
    const d = calculateNodeDimensions(n);
    n.width = d.width;
    n.height = d.height;
  }
}
