import crypto from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newDb } from "pg-mem";
import { migrate } from "../src/server/db.js";

const migrationsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "server",
  "migrations"
);

export async function testPool({ through } = {}) {
  const memory = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
  memory.public.registerFunction({ name: "now", returns: "timestamptz", implementation: () => new Date() });
  memory.public.registerFunction({ name: "gen_random_uuid", returns: "uuid", implementation: () => crypto.randomUUID() });
  const adapter = memory.adapters.createPg();
  const pool = new adapter.Pool();
  if (through) {
    await migrateThrough(pool, through);
  } else {
    await migrate(pool);
  }
  return pool;
}

async function migrateThrough(pool, finalMigration) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const files = (await readdir(migrationsDir))
    .filter(name => name.endsWith(".sql") && name <= finalMigration)
    .sort();
  for (const name of files) {
    await pool.query(await readFile(path.join(migrationsDir, name), "utf8"));
    await pool.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
  }
}
