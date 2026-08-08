/**
 * db.ts — THE connection singleton. Next dev reloads modules on every edit,
 * so the promise is cached on globalThis: one pool, not one per hot reload.
 */
import mongoose from "mongoose";

/**
 * Query-selector injection, closed at the driver.
 *
 * Defence in depth, not the defence: every request body and query string is
 * parsed by a Zod schema first (domain/schemas.ts), and ScopedRepo builds each
 * filter itself out of those validated scalars — a caller-supplied object has
 * no route into a filter today. This is the belt to that pair of braces. If a
 * future handler ever forwards a raw value through, `{$ne: null}` is wrapped in
 * `$eq` and matches nothing instead of matching everything.
 *
 * Set at module scope so it is on before the first query, whichever entry point
 * (route, server component, health check) pulls the connection up first.
 *
 * The flip side: a filter that *means* to use operators has to say so with
 * `mongoose.trusted()`, or sanitizeFilter wraps it too. The two month-range
 * reads in repo.ts are the only ones, and they are marked.
 */
mongoose.set("sanitizeFilter", true);

declare global {
  var __pvaMongoose: Promise<typeof mongoose> | undefined;
}

export function connectDb(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose);
  if (!globalThis.__pvaMongoose) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI is not set (see .env.example)");
    // Serverless inverts the pooling maths. One long-lived container can afford
    // a real pool; a fleet of Vercel function instances cannot — each holds its
    // own, and Atlas M0 caps the whole cluster at 500 connections, so a wide
    // pool per instance is how a free-tier cluster runs out. Small pool, no idle
    // sockets, and the globalThis cache above still keeps a warm instance's
    // connection across invocations.
    const serverless = Boolean(process.env.VERCEL);

    globalThis.__pvaMongoose = mongoose.connect(uri, {
      maxPoolSize: serverless ? 3 : 10,
      // A container keeps one socket warm so the first request after an idle
      // spell skips the TCP + TLS + auth handshake. A function instance that is
      // about to be frozen should hold nothing.
      minPoolSize: serverless ? 0 : 1,
      // Fail fast rather than hang: a request that cannot find a primary in 8s
      // becomes a 500 the caller can retry, not a socket held open for minutes.
      serverSelectionTimeoutMS: 8_000,
      // Reap a stalled socket well before any upstream idle timeout can strand
      // it. Comfortably above the slowest query here (the report aggregation).
      socketTimeoutMS: 45_000,
    });
  }
  return globalThis.__pvaMongoose;
}
