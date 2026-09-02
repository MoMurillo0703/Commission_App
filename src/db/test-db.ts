import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { applyMigrations } from "./migrate";
import * as schema from "./schema";
import type { AppDatabase } from "./index";

export async function createTestDb(): Promise<AppDatabase> {
  const client = new PGlite();
  await applyMigrations({
    exec: async (sql) => {
      await client.exec(sql);
    },
    query: async <T = { filename: string }>(sql: string, params: unknown[] = []) => {
      const result = await client.query<T>(sql, params);
      return result.rows;
    },
  });
  return drizzle(client, { schema }) as unknown as AppDatabase;
}
