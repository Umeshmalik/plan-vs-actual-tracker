import { revalidateTag } from "next/cache";
import type { NextRequest, NextResponse } from "next/server";
import type { ScopedRepo } from "@/domain/repo";
import { requireRepo } from "./auth";
import { AppError, toResponse } from "./errors";
import { logRequest } from "./logger";
import { userTag } from "./reads";

/** ~25,000 CSV rows. The only large body this API takes. */
export const MAX_BODY_BYTES = 1024 * 1024;

// ponytail: Content-Length only — a chunked request with no length slips past.
// Upgrade to counting bytes off the stream if this ever takes third-party uploads.
function guardBodySize(req: NextRequest) {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES)
    throw new AppError(
      "VALIDATION_FAILED",
      "That upload is too large. The limit is 1 MB — split the file and import it in parts."
    );
}

/** no-store: every response is one tenant's data behind a session cookie. */
function stamp(res: NextResponse, requestId: string): NextResponse {
  res.headers.set("cache-control", "no-store");
  res.headers.set("x-request-id", requestId);
  return res;
}

// The freshness half of lib/reads.ts: any succeeding non-GET expires that
// tenant's reads, here, once — so a new route cannot forget to invalidate.
function invalidateReads(method: string, status: number, userId?: string) {
  if (method === "GET" || status >= 400 || !userId) return;
  revalidateTag(userTag(userId), { expire: 0 });
}

/** Authenticated route: the handler gets a ScopedRepo, never a raw session. */
export function withRoute<C = unknown>(
  handler: (req: NextRequest, repo: ScopedRepo, ctx: C) => Promise<NextResponse>
): (req: NextRequest, ctx?: C) => Promise<NextResponse> {
  return (req, ctx) => {
    const who: { userId?: string } = {};
    return run(req, who, async () => {
      const repo = await requireRepo();
      who.userId = String(repo.uid); // only set once auth has actually succeeded
      return handler(req, repo, ctx as C);
    });
  };
}

/** Same line, no auth — /api/health has to answer before anyone signs in. */
export function withPublicRoute<C = unknown>(
  handler: (req: NextRequest, ctx: C) => Promise<NextResponse>
): (req: NextRequest, ctx?: C) => Promise<NextResponse> {
  return (req, ctx) => run(req, {}, () => handler(req, ctx as C));
}

async function run(req: NextRequest, who: { userId?: string }, exec: () => Promise<NextResponse>) {
  // Honour an upstream id so one request is one id end to end.
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const t0 = Date.now();
  let status = 500;
  try {
    guardBodySize(req);
    const res = await exec();
    status = res.status;
    return stamp(res, requestId);
  } catch (err) {
    const res = toResponse(err);
    status = res.status;
    return stamp(res, requestId);
  } finally {
    invalidateReads(req.method, status, who.userId);
    logRequest({
      requestId,
      route: req.nextUrl.pathname,
      method: req.method,
      status,
      ms: Date.now() - t0,
      userId: who.userId,
    });
  }
}
