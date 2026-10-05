type SharpFactory = (input: Buffer, opts?: Record<string, unknown>) => {
  png(): { toBuffer(): Promise<Buffer> };
};

let cached: SharpFactory | null = null;

/**
 * sharp ships with Next.js and is hoisted to the repo root. It must stay a
 * runtime import: bundlers rewrite createRequire(), and the web app lists
 * sharp in serverExternalPackages.
 */
export async function loadSharp(): Promise<SharpFactory> {
  if (cached) return cached;
  try {
    const mod = (await import("sharp")) as unknown as { default?: SharpFactory } & SharpFactory;
    cached = mod.default ?? mod;
    return cached;
  } catch (err) {
    throw new Error(`sharp is not resolvable; PNG rendering unavailable (${err instanceof Error ? err.message : err})`);
  }
}

export async function svgToPng(svg: string): Promise<Buffer> {
  const sharp = await loadSharp();
  return sharp(Buffer.from(svg, "utf8"), { density: 72 }).png().toBuffer();
}
