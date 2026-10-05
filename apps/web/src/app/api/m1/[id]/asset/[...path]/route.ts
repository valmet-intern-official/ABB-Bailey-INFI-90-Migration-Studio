import fs from "node:fs";
import path from "node:path";
import { isValidSessionId, resolvePackagePath } from "@/lib/m1-session";

export const runtime = "nodejs";

const TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".pdf": "application/pdf",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".m1": "application/octet-stream",
};

export async function GET(req: Request, ctx: { params: Promise<{ id: string; path: string[] }> }) {
  const { id, path: parts } = await ctx.params;
  if (!isValidSessionId(id)) return new Response("invalid session", { status: 400 });
  const rel = parts.map(decodeURIComponent).join("/");
  const file = resolvePackagePath(id, rel);
  if (!file) return new Response("not found", { status: 404 });
  const ext = path.extname(file).toLowerCase();
  const download = new URL(req.url).searchParams.has("download");
  return new Response(new Uint8Array(fs.readFileSync(file)), {
    headers: {
      "content-type": TYPES[ext] ?? "application/octet-stream",
      ...(download ? { "content-disposition": `attachment; filename="${path.basename(file).replace(/"/g, "")}"` } : {}),
      "cache-control": "private, max-age=300",
    },
  });
}
