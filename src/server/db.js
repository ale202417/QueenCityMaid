import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_URL is required");
  return new pg.Pool({ connectionString });
}

export function createMigrationPool() {
  return createPool(process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL);
}

export async function withTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function migrate(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDir)).filter(name => name.endsWith(".sql")).sort();
  for (const name of files) {
    const applied = await pool.query("SELECT 1 FROM schema_migrations WHERE name = $1", [name]);
    if (applied.rowCount) continue;
    const sql = await readFile(path.join(migrationsDir, name), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
