import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { seed } from "../src/server/seed-data.js";
import { testPool } from "./helpers.js";

describe("database foundation", () => {
  it("applies the schema once and enforces organization ownership", async () => {
    const pool = await testPool();
    await migrateAgain(pool);
    const migrations = await pool.query("SELECT name FROM schema_migrations");
    assert.deepEqual(
      migrations.rows.map(row => row.name).sort(),
      [
        "001_foundation.sql",
        "002_operations.sql",
        "003_security.sql",
        "004_twilio_sms.sql",
        "005_customer_preferences.sql",
        "006_schedule_planner.sql",
        "007_payroll_workflow.sql",
        "008_financial_operations.sql"
      ]
    );

    await assert.rejects(
      pool.query(
        "INSERT INTO users (id, organization_id, email, name, role, password_hash) VALUES ($1, $2, $3, $4, $5, $6)",
        ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002", "x@example.com", "X", "manager", "hash"]
      )
    );
    await pool.end();
  });

  it("seeds an idempotent development workspace", async () => {
    const pool = await testPool();
    assert.equal((await seed(pool, { password: "manager123!" })).created, true);
    assert.equal((await seed(pool, { password: "manager123!" })).created, false);

    const counts = await Promise.all([
      pool.query("SELECT count(*)::int AS count FROM organizations"),
      pool.query("SELECT count(*)::int AS count FROM employees"),
      pool.query("SELECT count(*)::int AS count FROM teams"),
      pool.query("SELECT count(*)::int AS count FROM service_types")
    ]);
    assert.deepEqual(counts.map(result => result.rows[0].count), [1, 4, 2, 5]);
    await pool.end();
  });
});

async function migrateAgain(pool) {
  const { migrate } = await import("../src/server/db.js");
  await migrate(pool);
}
