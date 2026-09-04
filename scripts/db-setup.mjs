import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(process.cwd(), ".env.local"));
loadEnvFile(path.join(process.cwd(), ".env"));

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL is missing. Copy .env.example to .env.local and add the Supabase URI.");
  process.exit(1);
}

const sql = postgres(url, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
  idle_timeout: 20,
  ssl: process.env.DATABASE_SSL === "disable" ? false : "require",
});

const directory = path.join(process.cwd(), "migrations");
const files = fs.readdirSync(directory).filter((file) => file.endsWith(".sql")).sort();

await sql.begin(async (transaction) => {
  await transaction.unsafe("SELECT pg_advisory_xact_lock(724031911)");
  await transaction.unsafe(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set((await transaction.unsafe("SELECT filename FROM schema_migrations")).map((row) => row.filename));
  for (const filename of files) {
    if (applied.has(filename)) continue;
    await transaction.unsafe(fs.readFileSync(path.join(directory, filename), "utf8"));
    await transaction.unsafe("INSERT INTO schema_migrations (filename, applied_at) VALUES ($1, $2)", [filename, new Date().toISOString()]);
    console.log(`applied ${filename}`);
  }
});

const [{ now }] = await sql.unsafe("SELECT now() AS now");
const [{ carriers }] = await sql.unsafe("SELECT count(*)::int AS carriers FROM carriers");
console.log(`connected: ${now}`);
console.log(`carriers table reachable (${carriers} rows)`);
await sql.end();
