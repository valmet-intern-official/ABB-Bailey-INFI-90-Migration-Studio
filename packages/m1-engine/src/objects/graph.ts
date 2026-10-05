import type { DecodedM1, M1Record } from "../decoder/types";

export type Severity = "ERROR" | "WARNING" | "INFO";

export interface GraphIssue {
  severity: Severity;
  code: string;
  message: string;
  objectId?: number;
  offset?: number;
}

export interface ReferenceEdge {
  from: number;
  to: number;
  field: string;
  role: string;
}

export interface RoleEvidence {
  sourceClass: string;
  role: string;
  field: string;
  count: number;
  targets: Record<string, number>;
}

export interface ObjectGraph {
  byId: Map<number, M1Record>;
  edges: ReferenceEdge[];
  referrers: Map<number, ReferenceEdge[]>;
  /** Owner = the record whose serialization first allocated this id. */
  owner: Map<number, number>;
  /** Structural parent through child/geometry/transform/property ownership. */
  parent: Map<number, number>;
  roleEvidence: RoleEvidence[];
  idAllocation: {
    rule: string;
    checked: number;
    violations: { recordId: number; field: string; expected: number; got: number }[];
  };
  issues: GraphIssue[];
  rootId: number;
}

export function buildObjectGraph(m1: DecodedM1): ObjectGraph {
  const byId = new Map<number, M1Record>();
  for (const r of m1.records) byId.set(r.id, r);
  const edges: ReferenceEdge[] = [];
  const referrers = new Map<number, ReferenceEdge[]>();
  const issues: GraphIssue[] = [];

  for (const r of m1.records) {
    for (const ref of r.refs) {
      const e: ReferenceEdge = { from: r.id, to: ref.targetId, field: ref.field, role: ref.role };
      edges.push(e);
      if (!byId.has(ref.targetId)) {
        issues.push({
          severity: "ERROR",
          code: "REF_MISSING",
          message: `${r.className}#${r.id}.${ref.field} → ${ref.targetId} does not exist`,
          objectId: r.id,
          offset: r.offset,
        });
        continue;
      }
      const list = referrers.get(ref.targetId) ?? [];
      list.push(e);
      referrers.set(ref.targetId, list);
    }
  }

  // RULE-ID-001: ids are allocated breadth-first in stream order. Walking the
  // records in order, every reference to a not-yet-allocated id must equal
  // the next free id.
  let maxAllocated = 1;
  const violations: ObjectGraph["idAllocation"]["violations"] = [];
  const owner = new Map<number, number>();
  let checked = 0;
  for (const r of m1.records) {
    if (r.id > maxAllocated) {
      violations.push({ recordId: r.id, field: "(self)", expected: maxAllocated + 1, got: r.id });
      maxAllocated = r.id;
    }
    for (const ref of r.refs) {
      checked++;
      if (ref.targetId > maxAllocated) {
        if (ref.targetId !== maxAllocated + 1) {
          violations.push({ recordId: r.id, field: ref.field, expected: maxAllocated + 1, got: ref.targetId });
        }
        maxAllocated = ref.targetId;
        owner.set(ref.targetId, r.id);
      }
    }
  }
  if (violations.length) {
    issues.push({
      severity: "ERROR",
      code: "ID_ALLOCATION",
      message: `${violations.length} reference(s) break breadth-first id allocation`,
    });
  }

  // Evidence table: which classes each (class, role) actually points at.
  const evidenceMap = new Map<string, RoleEvidence>();
  for (const e of edges) {
    const src = byId.get(e.from)!;
    const tgt = byId.get(e.to);
    const fieldKey = e.field.replace(/\[\d+\]/g, "[]");
    const key = `${src.className}|${e.role}|${fieldKey}`;
    const ev = evidenceMap.get(key) ?? {
      sourceClass: src.className,
      role: e.role,
      field: fieldKey,
      count: 0,
      targets: {},
    };
    ev.count++;
    const t = tgt ? tgt.className : "(missing)";
    ev.targets[t] = (ev.targets[t] ?? 0) + 1;
    evidenceMap.set(key, ev);
  }

  // Structural parent: every non-root object must be owned by exactly one referrer.
  const parent = new Map<number, number>();
  for (const [id, refs] of referrers) {
    const distinct = [...new Set(refs.map((e) => e.from))];
    if (distinct.length > 1) {
      issues.push({
        severity: "WARNING",
        code: "SHARED_OBJECT",
        message: `object ${id} (${byId.get(id)?.className}) referenced by ${distinct.join(", ")}`,
        objectId: id,
      });
    }
    parent.set(id, owner.get(id) ?? distinct[0]);
  }
  const childRefs = edges.filter((e) => e.role === "child");
  const childParents = new Map<number, number[]>();
  for (const e of childRefs) {
    const l = childParents.get(e.to) ?? [];
    l.push(e.from);
    childParents.set(e.to, l);
  }
  for (const [id, ps] of childParents) {
    if (ps.length > 1) {
      issues.push({
        severity: "ERROR",
        code: "DUPLICATE_PARENT",
        message: `object ${id} is a child of ${ps.join(", ")}`,
        objectId: id,
      });
    }
  }

  // Cycle check over child edges.
  const state = new Map<number, 1 | 2>();
  const adj = new Map<number, number[]>();
  for (const e of childRefs) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
  const visit = (n: number, stack: number[]): void => {
    state.set(n, 1);
    for (const m of adj.get(n) ?? []) {
      if (state.get(m) === 1) {
        issues.push({
          severity: "ERROR",
          code: "GROUP_CYCLE",
          message: `cycle ${[...stack, n, m].join(" → ")}`,
          objectId: m,
        });
      } else if (!state.has(m)) visit(m, [...stack, n]);
    }
    state.set(n, 2);
  };
  const rootId = m1.records.find((r) => r.className === "Model")?.id ?? 1;
  visit(rootId, []);

  for (const r of m1.records) {
    if (r.id !== rootId && !referrers.has(r.id)) {
      issues.push({
        severity: "WARNING",
        code: "ORPHAN",
        message: `${r.className}#${r.id} is not referenced by any object`,
        objectId: r.id,
        offset: r.offset,
      });
    }
  }

  return {
    byId,
    edges,
    referrers,
    owner,
    parent,
    roleEvidence: [...evidenceMap.values()].sort((a, b) =>
      `${a.sourceClass}${a.field}`.localeCompare(`${b.sourceClass}${b.field}`)
    ),
    idAllocation: { rule: "RULE-ID-001 breadth-first allocation in stream order", checked, violations },
    issues,
    rootId,
  };
}
