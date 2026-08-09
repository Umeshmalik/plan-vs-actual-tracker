// THE connection singleton — cached on globalThis so Next's hot reload does not
// open a pool per edit.
import mongoose from "mongoose";

// Query-selector injection, closed at the driver. Module scope so it is on
// before the first query. A filter that MEANS to use operators must say so with
// mongoose.trusted() — the two month-range reads in repo.ts are the only ones.
mongoose.set("sanitizeFilter", true);

declare global {
  var __pvaMongoose: Promise<typeof mongoose> | undefined;
}

export function connectDb(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose);
  if (!globalThis.__pvaMongoose) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI is not set (see .env.example)");
    // Each function instance holds its own pool and Atlas M0 caps the cluster at
    // 500 connections, so serverless gets a small pool and no idle sockets.
    const serverless = Boolean(process.env.VERCEL);

    globalThis.__pvaMongoose = mongoose
      .connect(uri, {
        maxPoolSize: serverless ? 3 : 10,
        minPoolSize: serverless ? 0 : 1,
        serverSelectionTimeoutMS: 8_000,
        socketTimeoutMS: 45_000,
      })
      // Cache eviction, not error handling: a rejected promise left in the global
      // would 503 every later request on this instance.
      .catch(err => {
        globalThis.__pvaMongoose = undefined;
        throw err;
      });
  }
  return globalThis.__pvaMongoose;
}
