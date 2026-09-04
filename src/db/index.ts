import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { applyMigrations } from "./migrate";
import * as schema from "./schema";

export type AppDatabase = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as {
  commissionsSql?: ReturnType<typeof postgres>;
  commissionsDb?: AppDatabase;
  commissionsMigrated?: Promise<void>;
};

function databaseUrl() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is required. See .env.example and DEPLOYMENT.md.");
  }
  return url;
}

function createSql() {
  return postgres(databaseUrl(), {
    // Supabase transaction pooler (6543) hangs if one postgres.js client pipelines 4+ queries.
    // After inspect the browser fires statements/carriers/preview/groups/LOBs/agents together.
    max: 10,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: process.env.DATABASE_SSL === "disable" ? false : "require",
  });
}

async function migrateSql(sql: ReturnType<typeof postgres>) {
  await sql.begin(async (transaction) => {
    await transaction.unsafe("SELECT pg_advisory_xact_lock(724031911)");
    await applyMigrations({
      exec: async (statement) => {
        await transaction.unsafe(statement);
      },
      query: async <T = { filename: string }>(statement: string, params: unknown[] = []) => {
        return await transaction.unsafe(statement, params as never[]) as unknown as T[];
      },
    });
  });
}

export async function getDb(): Promise<AppDatabase> {
  if (!globalForDb.commissionsSql) {
    globalForDb.commissionsSql = createSql();
  }
  if (!globalForDb.commissionsMigrated) {
    globalForDb.commissionsMigrated = migrateSql(globalForDb.commissionsSql);
  }
  await globalForDb.commissionsMigrated;
  if (!globalForDb.commissionsDb) {
    globalForDb.commissionsDb = drizzle(globalForDb.commissionsSql, { schema });
  }
  return globalForDb.commissionsDb;
}

export async function resolveDb(db?: AppDatabase) {
  return db ?? await getDb();
}
