/**
 * Health — App Runner's health check and the deploy smoke test. Unauthenticated
 * by design, and it actually opens the DB connection rather than reporting on a
 * connection nobody made yet: a green check has to mean the DB is reachable.
 */
import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { withPublicRoute } from "@/lib/route"; // same log line, no auth

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
  return NextResponse.json({ ok, db, version: process.env.GIT_SHA ?? "dev" }, { status: ok ? 200 : 503 });
});
