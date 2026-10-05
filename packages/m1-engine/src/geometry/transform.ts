/** x' = a*x + b*y + e ; y' = c*x + d*y + f  (world units, y-up). */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const FIXED_ONE = 65536;
export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** RULE-XF-001: Scal2d = [tx, ty, sx, sy]; translations are 16.16 raw units. */
export function fromScal2d(s: { tx: number; ty: number; sx: number; sy: number }): Affine {
  return { a: s.sx, b: 0, c: 0, d: s.sy, e: s.tx / FIXED_ONE, f: s.ty / FIXED_ONE };
}

/** RULE-XF-002: Mat2x3 = [a, b, tx, c, d, ty]; translations are 16.16 raw units. */
export function fromMat2x3(m: { a: number; b: number; tx: number; c: number; d: number; ty: number }): Affine {
  return { a: m.a, b: m.b, c: m.c, d: m.d, e: m.tx / FIXED_ONE, f: m.ty / FIXED_ONE };
}

/** outer ∘ inner: apply inner first. */
export function compose(outer: Affine, inner: Affine): Affine {
  return {
    a: outer.a * inner.a + outer.b * inner.c,
    b: outer.a * inner.b + outer.b * inner.d,
    c: outer.c * inner.a + outer.d * inner.c,
    d: outer.c * inner.b + outer.d * inner.d,
    e: outer.a * inner.e + outer.b * inner.f + outer.e,
    f: outer.c * inner.e + outer.d * inner.f + outer.f,
  };
}

export function apply(t: Affine, [x, y]: readonly [number, number]): [number, number] {
  return [t.a * x + t.b * y + t.e, t.c * x + t.d * y + t.f];
}

export function isIdentity(t: Affine): boolean {
  return t.a === 1 && t.b === 0 && t.c === 0 && t.d === 1 && t.e === 0 && t.f === 0;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function bboxOf(points: readonly (readonly [number, number])[]): BBox | null {
  if (!points.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function unionBBox(a: BBox | null, b: BBox | null): BBox | null {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}
