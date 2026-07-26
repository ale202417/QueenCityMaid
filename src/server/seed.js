import { createMigrationPool, migrate } from "./db.js";
import { seed } from "./seed-data.js";

const pool = createMigrationPool();

try {
  await migrate(pool);
  if (!process.env.SEED_MANAGER_PASSWORD) throw new Error("SEED_MANAGER_PASSWORD is required");
  const result = await seed(pool, { password: process.env.SEED_MANAGER_PASSWORD });
  console.log(result.created ? "Seeded Queen City Maid" : "Seed already exists");
} finally {
  await pool.end();
}
