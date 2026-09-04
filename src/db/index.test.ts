import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  POSTGRES_CONNECT_TIMEOUT_SECONDS,
  POSTGRES_IDLE_TIMEOUT_SECONDS,
  POSTGRES_MAX_LIFETIME_SECONDS,
  POSTGRES_POOL_MAX,
  POSTGRES_STATEMENT_TIMEOUT_MS,
  postgresClientOptions,
} from "./index";

describe("production Postgres client", () => {
  it("bounds pooler connections and query time below the Vercel 300s timeout", () => {
    const options = postgresClientOptions();
    expect(options.max).toBe(POSTGRES_POOL_MAX);
    expect(options.max).toBeGreaterThanOrEqual(6);
    expect(options.prepare).toBe(false);
    expect(options.connect_timeout).toBe(POSTGRES_CONNECT_TIMEOUT_SECONDS);
    expect(options.idle_timeout).toBe(POSTGRES_IDLE_TIMEOUT_SECONDS);
    expect(options.max_lifetime).toBe(POSTGRES_MAX_LIFETIME_SECONDS);
    expect(options.connection.statement_timeout).toBe(POSTGRES_STATEMENT_TIMEOUT_MS);
    expect(options.connect_timeout + options.connection.statement_timeout / 1000).toBeLessThan(300);
  });

  it("does not run migrations from getDb or liveness recovery", () => {
    const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const liveness = readFileSync(new URL("./liveness.ts", import.meta.url), "utf8");
    expect(index).not.toMatch(/applyMigrations|migrateSql|commissionsMigrated/);
    expect(liveness).not.toMatch(/applyMigrations|migrateSql|commissionsMigrated/);
    expect(index).toMatch(/ensureLiveClient/);
    expect(index).toMatch(/export async function getDb/);
  });
});
