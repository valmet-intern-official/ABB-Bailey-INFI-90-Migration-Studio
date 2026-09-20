import { NextRequest, NextResponse } from "next/server";

/**
 * CORS for /api/* when the UI is hosted on a different origin (Vercel → Render).
 * Origins are read from CORS_ORIGINS / FRONTEND_ORIGIN (comma-separated).
 * Production never falls back to "*".
 */
export function middleware(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  const origin = req.headers.get("origin");
  const allowedList = (
    process.env.CORS_ORIGINS ||
    process.env.FRONTEND_ORIGIN ||
    ""
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let allowOrigin: string | null = null;
  if (origin && allowedList.includes(origin)) {
    allowOrigin = origin;
  } else if (
    origin &&
    allowedList.length === 0 &&
    process.env.NODE_ENV !== "production" &&
    (origin.startsWith("http://localhost:") ||
      origin.startsWith("http://127.0.0.1:"))
  ) {
    allowOrigin = origin;
  }

  if (req.method === "OPTIONS") {
    const res = new NextResponse(null, { status: 204 });
    if (allowOrigin) {
      res.headers.set("Access-Control-Allow-Origin", allowOrigin);
      res.headers.set("Vary", "Origin");
      res.headers.set("Access-Control-Allow-Credentials", "true");
      res.headers.set(
        "Access-Control-Allow-Methods",
        "GET,POST,PUT,PATCH,DELETE,OPTIONS"
      );
      res.headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Requested-With"
      );
      res.headers.set("Access-Control-Max-Age", "86400");
    }
    return res;
  }

  const res = NextResponse.next();
  if (allowOrigin) {
    res.headers.set("Access-Control-Allow-Origin", allowOrigin);
    res.headers.set("Vary", "Origin");
    res.headers.set("Access-Control-Allow-Credentials", "true");
  }
  return res;
}

export const config = {
  matcher: ["/api/:path*"],
};
