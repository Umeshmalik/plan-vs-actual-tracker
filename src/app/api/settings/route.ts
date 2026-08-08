/**
 * The signed-in user's own reporting preferences — today just where their
 * fiscal year starts. The canonical handler shape: parse, call the domain,
 * respond. withRoute supplies auth, the error envelope, and the cache
 * invalidation that makes the header pick the new label up on the next render.
 */
import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/domain/users";
import { withRoute } from "@/lib/route";

export const dynamic = "force-dynamic"; // the response; the data is cached in lib/reads.ts

export const GET = withRoute(async (_req, repo) => NextResponse.json(await getSettings(String(repo.uid))));

export const PUT = withRoute(async (req, repo) =>
  NextResponse.json(await updateSettings(String(repo.uid), await req.json()))
);
