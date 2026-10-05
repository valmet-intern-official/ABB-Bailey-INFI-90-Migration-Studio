import type { DecodedM1 } from "../decoder/types";

export interface LogicNode {
  id: number;
  className: string;
  label: string;
  offset: number;
  status: "DECODED_STRUCTURE" | "UNRESOLVED_SEMANTICS";
}

export interface LogicEdge {
  from: number;
  to: number;
  role: string;
}

export interface LogicGraph {
  nodes: LogicNode[];
  edges: LogicEdge[];
  /** DynProp roots with the object that owns them. */
  roots: { dynPropId: number; ownerId: number | null; ownerClass: string | null }[];
  notes: string[];
}

const LOGIC_CLASSES = new Set([
  "G_DynProp_30",
  "G_EVap_30",
  "G_Svap_30",
  "G_Cvap_30",
  "G_Action_30X",
  "G_FctnCall_30",
  "G_UnExpr_30",
  "G_RelExpr_30",
  "G_VarRef_30",
]);

/**
 * Expression structure is decoded exactly (operators and operands by reference).
 * Operator codes and action codes are kept as raw numbers because their
 * meaning is not proven from the corpus.
 */
export function buildLogicGraph(m1: DecodedM1): LogicGraph {
  const get = (id: number) => m1.records[id - 1];
  const inLogic = new Set<number>();
  const visit = (id: number) => {
    if (inLogic.has(id)) return;
    const r = get(id);
    if (!r) return;
    inLogic.add(id);
    for (const ref of r.refs) {
      const t = get(ref.targetId);
      if (t && (LOGIC_CLASSES.has(t.className) || /Const/.test(t.className))) visit(t.id);
    }
  };
  const roots: LogicGraph["roots"] = [];
  for (const r of m1.records) {
    if (r.className === "G_DynProp_30") {
      visit(r.id);
      const owner = m1.records.find((o) => o.refs.some((x) => x.role === "dynamic" && x.targetId === r.id));
      roots.push({ dynPropId: r.id, ownerId: owner?.id ?? null, ownerClass: owner?.className ?? null });
    } else if (LOGIC_CLASSES.has(r.className)) {
      visit(r.id);
    }
  }
  const nodes: LogicNode[] = [...inLogic].sort((a, b) => a - b).map((id) => {
    const r = get(id);
    const d = r.decoded as Record<string, unknown>;
    let label = r.className;
    if (r.className === "G_FctnCall_30") label = `${d.function}()`;
    else if (r.className === "G_VarRef_30") label = `var ${d.name}`;
    else if (r.className === "G_StrConst_30") label = JSON.stringify(d.value);
    else if (r.className === "G_IntConst_30") label = String(d.value);
    else if ("op" in d) label = `${r.className} op=${d.op}`;
    else if ("actionCode" in d) label = `action code=${d.actionCode}`;
    const semantic = /Const|VarRef|FctnCall/.test(r.className);
    return { id, className: r.className, label, offset: r.offset, status: semantic ? "DECODED_STRUCTURE" : "UNRESOLVED_SEMANTICS" };
  });
  const edges: LogicEdge[] = [];
  for (const id of inLogic) for (const ref of get(id).refs) if (inLogic.has(ref.targetId)) edges.push({ from: id, to: ref.targetId, role: ref.role });
  return {
    nodes,
    edges,
    roots,
    notes: [
      "Operator/action numeric codes are preserved raw; their semantics are UNRESOLVED.",
      "Expressions are not evaluated — no runtime state is invented.",
    ],
  };
}
