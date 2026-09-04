import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { DATABASE_LIVENESS_TIMEOUT_MS, ensureLiveClient } from "./liveness";
import * as schema from "./schema";

export type AppDatabase = PostgresJsDatabase<typeof schema>;

type SqlClient = ReturnType<typeof postgres>;

const globalForDb = globalThis as unknown as {
  commissionsSql?: SqlClient;
  commissionsDb?: AppDatabase;
  commissionsDbInFlight?: Promise<AppDatabase>;
};

export const POSTGRES_POOL_MAX = 10;
export const POSTGRES_CONNECT_TIMEOUT_SECONDS = 10;
export const POSTGRES_IDLE_TIMEOUT_SECONDS = 20;
export const POSTGRES_MAX_LIFETIME_SECONDS = 120;
export const POSTGRES_STATEMENT_TIMEOUT_MS = 15_000;

// Vercel + Supabase transaction pooler (6543): fail in tens of seconds, not the 300s platform timeout.
// max 10 covers the post-inspect request burst. statement_timeout aborts a stuck query at 15s.
// connect 10s covers pooler TLS. idle 20s and max_lifetime 120s release pooler slots on unused isolates.
export function postgresClientOptions() {
  return {
    max: POSTGRES_POOL_MAX,
    prepare: false as const,
    idle_timeout: POSTGRES_IDLE_TIMEOUT_SECONDS,
    connect_timeout: POSTGRES_CONNECT_TIMEOUT_SECONDS,
    max_lifetime: POSTGRES_MAX_LIFETIME_SECONDS,
    connection: {
      statement_timeout: POSTGRES_STATEMENT_TIMEOUT_MS,
    },
    ssl: process.env.DATABASE_SSL === "disable" ? false : "require" as const,
  };
}

function databaseUrl() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is required. See .env.example and DEPLOYMENT.md.");
  }
  return url;
}

function createSql() {
  return postgres(databaseUrl(), postgresClientOptions());
}

function holdSql(sql: SqlClient | undefined) {
  globalForDb.commissionsSql = sql;
  globalForDb.commissionsDb = sql ? drizzle(sql, { schema }) : undefined;
}

async function pingSql(sql: SqlClient) {
  await sql`SELECT 1`;
}

async function disposeSql(sql: SqlClient) {
  await sql.end({ timeout: 2 });
}

async function openLiveDb() {
  await ensureLiveClient({
    getCurrent: () => globalForDb.commissionsSql,
    setCurrent: holdSql,
    create: createSql,
    ping: pingSql,
    dispose: disposeSql,
    pingTimeoutMs: DATABASE_LIVENESS_TIMEOUT_MS,
  });
  return globalForDb.commissionsDb!;
}

export async function getDb(): Promise<AppDatabase> {
  if (!globalForDb.commissionsDbInFlight) {
    globalForDb.commissionsDbInFlight = openLiveDb().finally(() => {
      globalForDb.commissionsDbInFlight = undefined;
    });
  }
  return globalForDb.commissionsDbInFlight;
}

export async function resolveDb(db?: AppDatabase) {
  return db ?? await getDb();
}
