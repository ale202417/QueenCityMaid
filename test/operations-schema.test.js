import assert from "node:assert/strict";
import crypto from "node:crypto";
import { describe, it } from "node:test";
import { testPool } from "./helpers.js";

describe("operations schema", () => {
  it("installs operational tables and enforces core money rules", async () => {
    const pool = await testPool();
    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'`
    );
    const names = new Set(tables.rows.map(row => row.table_name));
    for (const name of ["leads", "quotes", "bookings", "routes", "payments", "payroll_periods"]) {
      assert.equal(names.has(name), true, `missing ${name}`);
    }

    const organizationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const customerId = crypto.randomUUID();
    await pool.query("INSERT INTO organizations (id, name) VALUES ($1, $2)", [organizationId, "Queen City Maid"]);
    await pool.query(
      `INSERT INTO users (id, organization_id, email, name, role, password_hash)
       VALUES ($1, $2, $3, $4, 'manager', 'hash')`,
      [userId, organizationId, "manager@example.com", "Manager"]
    );
    await pool.query(
      `INSERT INTO customers (id, organization_id, type, name, phone)
       VALUES ($1, $2, 'residential', 'Client', '555-0100')`,
      [customerId, organizationId]
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO payments
         (id, organization_id, customer_id, recorded_by, method, amount_cents, paid_at)
         VALUES ($1, $2, $3, $4, 'zelle', -1, now())`,
        [crypto.randomUUID(), organizationId, customerId, userId]
      )
    );
    await pool.end();
  });
});
