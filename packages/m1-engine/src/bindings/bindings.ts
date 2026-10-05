import type { DecodedM1, M1Record } from "../decoder/types";

export type BindingStatus = "RESOLVED" | "UNRESOLVED" | "INCONSISTENT" | "LITERAL";

export interface PropertyValue {
  key: string;
  valueRef: number;
  valueClass: string | null;
  value: string | number | null;
}

export interface Binding {
  instanceId: number;
  key: string;
  rawValue: string | number | null;
  valueRef: number;
  /** Key after substituting the instance parameters (e.g. $TAG$ → 131AC-105). */
  expandedKey: string | null;
  tag: string | null;
  atom: string | null;
  kind: "tag" | "tag-atom" | "tag-dot-atom" | "navigation" | "color" | "number" | "text";
  status: BindingStatus;
  note?: string;
}

export interface InstanceBindings {
  instanceId: number;
  templateName: string;
  instanceExpression: string;
  parameters: Record<string, string>;
  properties: PropertyValue[];
  bindings: Binding[];
  primaryTag: string | null;
}

/** RULE-BIND-001: `%#1#% NAME "value" [NAME "value"…] %#1#%`. */
export function parseInstanceExpression(expr: string): Record<string, string> {
  const params: Record<string, string> = {};
  const m = expr.match(/%#1#%([\s\S]*)%#1#%/);
  if (!m) return params;
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s+"([^"]*)"/g;
  let x: RegExpExecArray | null;
  while ((x = re.exec(m[1]))) params[x[1]] = x[2];
  return params;
}

export function expandKey(key: string, params: Record<string, string>): string | null {
  let unresolved = false;
  const out = key.replace(/\$([A-Za-z_][A-Za-z0-9_]*)\$/g, (_, name: string) => {
    if (name in params) return params[name];
    unresolved = true;
    return `$${name}$`;
  });
  return unresolved ? null : out;
}

function valueOf(rec: M1Record | undefined): { cls: string | null; value: string | number | null } {
  if (!rec) return { cls: null, value: null };
  const d = rec.decoded as { value?: string | number } | null;
  return { cls: rec.className, value: d?.value ?? null };
}

export function extractBindings(m1: DecodedM1): InstanceBindings[] {
  const get = (id: number) => m1.records[id - 1];
  const out: InstanceBindings[] = [];
  for (const r of m1.records) {
    if (r.className !== "ModInst") continue;
    const d = r.decoded as {
      instanceExpression: string;
      templateName: string;
      props: { key: string; valueRef: number }[];
    };
    const parameters = parseInstanceExpression(d.instanceExpression);
    const properties: PropertyValue[] = d.props.map((p) => {
      const v = valueOf(get(p.valueRef));
      return { key: p.key, valueRef: p.valueRef, valueClass: v.cls, value: v.value };
    });
    const bindings: Binding[] = properties.map((p) => classify(r.id, p, parameters));
    out.push({
      instanceId: r.id,
      templateName: d.templateName,
      instanceExpression: d.instanceExpression,
      parameters,
      properties,
      bindings,
      primaryTag: parameters.TAG ?? parameters.Tag ?? null,
    });
  }
  return out;
}

function classify(instanceId: number, p: PropertyValue, params: Record<string, string>): Binding {
  const base = { instanceId, key: p.key, rawValue: p.value, valueRef: p.valueRef };
  if (p.key.includes("$")) {
    const expandedKey = expandKey(p.key, params);
    const raw = typeof p.value === "string" ? p.value : null;
    const [tag, atom] = raw && raw.includes("#d") ? raw.split("#d", 2) : [raw, null];
    if (expandedKey === null) {
      return { ...base, expandedKey, tag, atom, kind: atom ? "tag-atom" : "tag", status: "UNRESOLVED", note: "key references a parameter absent from the instance expression" };
    }
    const consistent = expandedKey === raw;
    return {
      ...base,
      expandedKey,
      tag,
      atom,
      kind: atom ? "tag-atom" : "tag",
      status: consistent ? "RESOLVED" : "INCONSISTENT",
      note: consistent ? undefined : `expanded key "${expandedKey}" ≠ stored value "${raw}"`,
    };
  }
  if (typeof p.value === "string" && /^graphic:\d+$/.test(p.value)) {
    return { ...base, expandedKey: null, tag: null, atom: null, kind: "navigation", status: "LITERAL" };
  }
  if (typeof p.value === "string" && /^[^\s.]+\.[A-Za-z_][A-Za-z0-9_]*$/.test(p.value) && /tag|atom|limit/i.test(p.key)) {
    const [tag, atom] = p.value.split(".", 2);
    return { ...base, expandedKey: null, tag, atom, kind: "tag-dot-atom", status: "RESOLVED" };
  }
  if (typeof p.value === "number") {
    return { ...base, expandedKey: null, tag: null, atom: null, kind: /color/i.test(p.key) ? "color" : "number", status: "LITERAL" };
  }
  return { ...base, expandedKey: null, tag: null, atom: null, kind: "text", status: "LITERAL" };
}

export interface TagIndexEntry {
  tag: string;
  atoms: string[];
  instances: number[];
  templates: string[];
}

export function buildTagIndex(all: InstanceBindings[]): TagIndexEntry[] {
  const map = new Map<string, { atoms: Set<string>; instances: Set<number>; templates: Set<string> }>();
  const add = (tag: string, atom: string | null, inst: InstanceBindings) => {
    const e = map.get(tag) ?? { atoms: new Set(), instances: new Set(), templates: new Set() };
    if (atom) e.atoms.add(atom);
    e.instances.add(inst.instanceId);
    e.templates.add(inst.templateName);
    map.set(tag, e);
  };
  for (const inst of all) {
    if (inst.primaryTag) add(inst.primaryTag, null, inst);
    for (const b of inst.bindings) if (b.tag) add(b.tag, b.atom, inst);
  }
  return [...map.entries()]
    .map(([tag, e]) => ({ tag, atoms: [...e.atoms].sort(), instances: [...e.instances].sort((a, b) => a - b), templates: [...e.templates].sort() }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}
