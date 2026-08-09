/** One structured line per request: requestId, userId, route, status, ms. */
import pino from "pino";

export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "pva", version: process.env.GIT_SHA ?? "dev" },
});

export function logRequest(fields: {
  requestId: string;
  route: string;
  method: string;
  status: number;
  ms: number;
  userId?: string;
}) {
  log.info(fields, "request");
}
