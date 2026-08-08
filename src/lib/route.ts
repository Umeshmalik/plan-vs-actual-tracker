/**
 * route.ts — the wrapper every API route wears. It owns the three things no
 * handler should repeat: auth (requireRepo), the error envelope (toResponse),
 * and THE one structured log line per request the plan promises —
 * requestId, userId, route, status, ms — emitted on success AND on failure.
 * Handlers stay what they were: parse -> guard -> repo -> respond.
 */
import type { NextRequest, NextResponse } from "next/server";
import type { ScopedRepo } from "@/domain/repo";
import { requireRepo } from "./auth";
import { AppError, toResponse } from "./errors";
import { logRequest } from "./logger";

/**
 * The only large body this API takes is a pasted/uploaded CSV, and 1 MB of
 * "month,category,amount" is roughly 25,000 rows — orders past a year of one
 * team's spend. Checked here, in the wrapper, so /api/imports/preview and
 * /api/imports/commit share one limit and one wording instead of each growing
 * their own; every other route is far below it and never notices.
 */
export const MAX_BODY_BYTES = 1024 * 1024;

/**
 * ponytail: Content-Length only. A chunked request that sends no length slips
 * past this and is bounded only by whatever the platform enforces. The real
 * fix is counting bytes off the stream (or a size limit at the edge — App
 * Runner / a WAF rule) and that is worth doing the day this API takes uploads
 * from anyone but its own signed-in UI.
 */
function guardBodySize(req: NextRequest) {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES)
    throw new AppError(
      "VALIDATION_FAILED",
      "That upload is too large. The limit is 1 MB — split the file and import it in parts."
    );
}

/**
 * Every response, success or error. `no-store` because each one is one
 * tenant's data behind a session cookie: there is nothing here a shared cache
 * may ever hold. `x-request-id` is the same id that went into the log line, so
 * a support question ("my import failed at 14:02") maps to one CloudWatch row.
 */
function stamp(res: NextResponse, requestId: string): NextResponse {
  res.headers.set("cache-control", "no-store");
  res.headers.set("x-request-id", requestId);
  return res;
}

/**
 * Authenticated route: the handler gets a ScopedRepo, never a raw session.
 * `ctx` is optional and defaults to `unknown` so a route with no dynamic
 * segment can be declared — and called — with the request alone, while Next's
 * generated route validator (which hands every handler a context) still fits.
 */
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
  // Honour an upstream id (App Runner / load balancer) so one request is one
  // id end to end; mint one only when nobody upstream did. Resolved up front
  // now that the response echoes the same value the log line records.
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const t0 = Date.now();
  let status = 500;
  try {
    guardBodySize(req);
    const res = await exec();
    status = res.status;
    return stamp(res, requestId);
  } catch (err) {
    const res = toResponse(err); // the ONLY place a route error becomes a response
    status = res.status;
    return stamp(res, requestId);
  } finally {
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
