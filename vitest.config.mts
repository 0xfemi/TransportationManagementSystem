import path from "path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const testDatabaseUrl = env.TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? "";
  // globalSetup runs in this process, not in a test worker.
  process.env.TEST_DATABASE_URL = testDatabaseUrl;
  return {
    resolve: { alias: { "@": path.resolve(process.cwd()) } },
    test: {
      environment: "node",
      include: ["tests/**/*.test.ts"],
      globalSetup: ["tests/setup/global.ts"],
      // Integration tests share one database.
      fileParallelism: false,
      testTimeout: 60_000,
      hookTimeout: 120_000,
      env: {
        // Tests only ever see the test database.
        DATABASE_URL: testDatabaseUrl,
        DIRECT_URL: testDatabaseUrl,
        TEST_DATABASE_URL: testDatabaseUrl,
        AUTH_SECRET: "test-secret-test-secret-test-secret-0000",
        ROUTING_PROVIDER: "haversine",
        // A developer's own access link in .env must not leak into tests,
        // which switch it on and off themselves.
        ADMIN_ACCESS_KEY: "",
        ADMIN_ACCESS_EMAIL: "",
      },
    },
  };
});
