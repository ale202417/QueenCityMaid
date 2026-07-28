import assert from "node:assert/strict";
import crypto from "node:crypto";
import { describe, it } from "node:test";
import { migrate } from "../src/server/db.js";
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
        "008_financial_operations.sql",
        "009_default_service_types.sql",
        "010_search_indexes.sql",
        "011_customer_cancellations.sql",
        "012_booking_cancellation_reason.sql",
        "013_finance_corrections.sql",
        "014_admin_automation.sql"
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

  it("upgrades previous-release records without losing finance or account data", async () => {
    const pool = await testPool({ through: "012_booking_cancellation_reason.sql" });
    await seed(pool, { password: "manager123!" });
    const context = (await pool.query(`
      SELECT
        o.id AS organization_id,
        u.id AS user_id,
        u.email,
        c.id AS customer_id,
        b.id AS booking_id
      FROM organizations o
      JOIN users u ON u.organization_id = o.id AND u.role = 'manager'
      JOIN customers c ON c.organization_id = o.id
      JOIN bookings b ON b.customer_id = c.id
      ORDER BY u.created_at
      LIMIT 1
    `)).rows[0];
    const paymentId = crypto.randomUUID();
    const expenseId = crypto.randomUUID();
    const tipId = crypto.randomUUID();

    await pool.query(
      `INSERT INTO payments
       (id, organization_id, customer_id, recorded_by, method, amount_cents, paid_at, reference)
       VALUES ($1, $2, $3, $4, 'check', 22000, now(), 'previous release')`,
      [paymentId, context.organization_id, context.customer_id, context.user_id]
    );
    await pool.query(
      `INSERT INTO business_expenses
       (id, organization_id, spent_on, category, description, amount_cents, recorded_by)
       VALUES ($1, $2, CURRENT_DATE, 'supplies', 'Previous release expense', 4500, $3)`,
      [expenseId, context.organization_id, context.user_id]
    );
    await pool.query(
      `INSERT INTO tips
       (id, organization_id, booking_id, amount_cents, source, recorded_by)
       VALUES ($1, $2, $3, 2000, 'manager', $4)`,
      [tipId, context.organization_id, context.booking_id, context.user_id]
    );

    await migrate(pool);

    const [payment, expense, tip, user] = await Promise.all([
      pool.query("SELECT amount_cents FROM payments WHERE id = $1", [paymentId]),
      pool.query("SELECT amount_cents FROM business_expenses WHERE id = $1", [expenseId]),
      pool.query("SELECT amount_cents FROM tips WHERE id = $1", [tipId]),
      pool.query("SELECT email FROM users WHERE id = $1", [context.user_id])
    ]);
    assert.equal(payment.rows[0].amount_cents, 22000);
    assert.equal(expense.rows[0].amount_cents, 4500);
    assert.equal(tip.rows[0].amount_cents, 2000);
    assert.equal(user.rows[0].email, context.email);
    await assert.rejects(
      pool.query(
        `INSERT INTO tips
         (id, organization_id, booking_id, amount_cents, source, recorded_by)
         VALUES ($1, $2, $3, 1000, 'manager', $4)`,
        [crypto.randomUUID(), context.organization_id, context.booking_id, context.user_id]
      )
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO users
         (id, organization_id, email, name, role, password_hash)
         VALUES ($1, $2, $3, 'Duplicate manager', 'manager', 'hash')`,
        [crypto.randomUUID(), context.organization_id, context.email.toUpperCase()]
      )
    );
    await pool.end();
  });
});

async function migrateAgain(pool) {
  const { migrate } = await import("../src/server/db.js");
  await migrate(pool);
}
