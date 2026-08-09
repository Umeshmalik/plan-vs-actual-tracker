/**
 * The health check and deploy smoke test. Unauthenticated, and it OPENS the
 * connection rather than reporting on one nobody made.
 */
import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { withPublicRoute } from "@/lib/route";

export const dynamic = "force-dynamic"; // a cached health check is a lie

export const GET = withPublicRoute(async () => {
  let db = "down";
  try {
    const m = await connectDb();
    if (m.connection.readyState === 1) db = "up";
  } catch {
    // stays "down" — the status code below is the alarm, not a 500
  }
  const ok = db === "up";
  // GIT_SHA is set by the CI deploy job; Vercel builds supply the commit instead.
  const version = process.env.GIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev";
  return NextResponse.json({ ok, db, version }, { status: ok ? 200 : 503 });
});
