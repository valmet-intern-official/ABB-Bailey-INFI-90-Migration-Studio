/**
 * Data fetched by the processing page just before it opens a result page, so the result page
 * can render immediately instead of showing a loading state. In-memory and tab-local only.
 */
const cache = new Map<string, unknown>();

export const resultKey = {
  cadSession: (id: string) => `cad:${id}`,
  cadSvg: (id: string, sheet: string) => `cad-svg:${id}:${sheet}`,
  cadBlocks: (id: string, sheet: string) => `cad-blocks:${id}:${sheet}`,
  m1Index: (id: string) => `m1:${id}`,
  m1Categories: (id: string) => `m1-cats:${id}`,
  m1Svg: (url: string) => `m1-svg:${url}`,
};

export function primeResult(key: string, value: unknown) {
  cache.set(key, value);
}

export function peekResult<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}
