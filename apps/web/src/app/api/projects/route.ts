import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Sessions are ephemeral — no project library is exposed. */
export async function GET() {
  return NextResponse.json(
    { error: "Project listing is disabled. Upload a ZIP to start a session." },
    { status: 410 }
  );
}
