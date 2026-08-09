/** The signed-in user's own reporting preferences. */
import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/domain/users";
import { withRoute } from "@/lib/route";

export const dynamic = "force-dynamic"; // the response; the data is cached in lib/reads.ts

export const GET = withRoute(async (_req, repo) => NextResponse.json(await getSettings(String(repo.uid))));

export const PUT = withRoute(async (req, repo) =>
  NextResponse.json(await updateSettings(String(repo.uid), await req.json()))
);
