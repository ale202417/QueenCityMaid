import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bootstrapAdmin } from "../src/server/bootstrap-admin.js";
import { verifyPassword } from "../src/server/passwords.js";
import { testPool } from "./helpers.js";

describe("production manager bootstrap", () => {
  it("creates only the organization, settings, and manager once", async () => {
    const pool = await testPool();
    try {
      const input = {
        organizationName: "Queen City Maid",
        managerEmail: "owner@queencitymaid.test",
        managerName: "Owner",
        managerPassword: "a-strong-production-password"
      };
      const created = await bootstrapAdmin(pool, input);
      assert.equal(created.created, true);
      const repeated = await bootstrapAdmin(pool, input);
      assert.equal(repeated.created, false);

      const users = await pool.query(
        "SELECT role, password_hash FROM users WHERE organization_id = $1",
        [created.organizationId]
      );
      assert.equal(users.rowCount, 1);
      assert.equal(users.rows[0].role, "manager");
      assert.equal(await verifyPassword(input.managerPassword, users.rows[0].password_hash), true);
      assert.equal(
        Number((await pool.query("SELECT COUNT(*) AS count FROM customers")).rows[0].count),
        0
      );
      assert.equal(
        Number((await pool.query("SELECT COUNT(*) AS count FROM business_settings")).rows[0].count),
        1
      );
    } finally {
      await pool.end();
    }
  });

  it("rejects weak credentials", async () => {
    const pool = await testPool();
    try {
      await assert.rejects(
        () => bootstrapAdmin(pool, {
          organizationName: "Queen City Maid",
          managerEmail: "invalid",
          managerName: "Owner",
          managerPassword: "short"
        }),
        /email|String must contain/i
      );
    } finally {
      await pool.end();
    }
  });
});
