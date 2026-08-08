import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // mongodb-memory-server downloads/starts a real mongod on first run.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Each suite starts its own replica set; running the files one at a time
    // keeps memory sane and avoids port races. (Vitest 4 dropped `poolOptions`;
    // `fileParallelism: false` is the successor to forks/singleFork.)
    pool: "forks",
    fileParallelism: false,
  },
});
