import { execSync } from "child_process";

/** Rebuilds the test database from the Prisma schema before the run. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set. Copy .env.example to .env and start the database.");
  }
  // This wipes the database, so refuse anything not plainly a test database.
  if (!/test/i.test(new URL(url).pathname)) {
    throw new Error("TEST_DATABASE_URL must point at a database with 'test' in its name");
  }
  execSync("npx prisma db push --force-reset --skip-generate", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
  });
}
