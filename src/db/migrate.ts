import fs from "node:fs";
import path from "node:path";

export type SqlExecutor = {
  exec(sql: string): Promise<unknown>;
  query<T = { filename: string }>(sql: string, params?: unknown[]): Promise<T[]>;
};

function migrationDirectory() {
  return path.join(process.cwd(), "migrations");
}

function migrationFiles() {
  return fs
    .readdirSync(migrationDirectory())
    .filter((file) => file.endsWith(".sql") && !file.startsWith("."))
    .sort();
}

export async function applyMigrations(executor: SqlExecutor) {
  await executor.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    (await executor.query<{ filename: string }>("SELECT filename FROM schema_migrations")).map((row) => row.filename),
  );

  for (const filename of migrationFiles()) {
    if (applied.has(filename)) continue;
    const sql = fs.readFileSync(path.join(migrationDirectory(), filename), "utf8");
    await executor.exec(sql);
    await executor.query("INSERT INTO schema_migrations (filename, applied_at) VALUES ($1, $2)", [
      filename,
      new Date().toISOString(),
    ]);
  }
}
