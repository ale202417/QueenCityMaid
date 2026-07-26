import { createMigrationPool, migrate } from "./db.js";

const pool = createMigrationPool();

try {
  await migrate(pool);
  console.log("Database migrations complete");
} finally {
  await pool.end();
}
