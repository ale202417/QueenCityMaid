import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { afterEach, describe, it } from "node:test";
import { createAccountRouter } from "../src/server/accounts.js";
import { errorHandler } from "../src/server/http.js";
import { testPool } from "./helpers.js";

const cleanups = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

async function fixture(role = "manager") {
  const pool = await testPool();
  const ids = {
    organization: crypto.randomUUID(),
    manager: crypto.randomUUID(),
    employee: crypto.randomUUID()
  };
  await pool.query("INSERT INTO organizations (id, name) VALUES ($1, 'Queen City Maid')", [ids.organization]);
  await pool.query(
    `INSERT INTO users (id, organization_id, email, name, role, password_hash)
     VALUES ($1, $2, 'manager@test.local', 'Manager', 'manager', 'hash')`,
    [ids.manager, ids.organization]
  );
  await pool.query(
    `INSERT INTO employees
     (id, organization_id, first_name, last_name, phone, hourly_rate_cents)
     VALUES ($1, $2, 'Angela', 'Brooks', '7045551000', 1900)`,
    [ids.employee, ids.organization]
  );
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.auth = { id: ids.manager, organizationId: ids.organization, role };
    next();
  });
  app.use("/api", createAccountRouter({ pool }));
  app.use(errorHandler);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  cleanups.push(() => new Promise((resolve) => server.close(resolve)), () => pool.end());
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, options = {}) => {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: { "content-type": "application/json" }
    });
    return { response, body: await response.json() };
  };
  return { pool, ids, request };
}

describe("user account administration", () => {
  it("creates a cleaner account linked to an employee", async () => {
    const { pool, ids, request } = await fixture();
    const created = await request("/api/users", {
      method: "POST",
      body: JSON.stringify({
        email: "angela@example.com",
        name: "Angela Brooks",
        role: "cleaner",
        password: "temporary-pass-123",
        employeeId: ids.employee
      })
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.data.user.employeeId, ids.employee);
    const employee = await pool.query("SELECT user_id FROM employees WHERE id = $1", [ids.employee]);
    assert.equal(employee.rows[0].user_id, created.body.data.user.id);
    const list = await request("/api/users");
    assert.equal(list.body.data.users.length, 2);
  });

  it("validates cleaner links, prevents self-deactivation, and isolates users", async () => {
    const { ids, request } = await fixture();
    const invalid = await request("/api/users", {
      method: "POST",
      body: JSON.stringify({
        email: "cleaner@example.com",
        name: "Cleaner",
        role: "cleaner",
        password: "temporary-pass-123"
      })
    });
    assert.equal(invalid.response.status, 400);
    const self = await request(`/api/users/${ids.manager}`, {
      method: "PATCH", body: JSON.stringify({ active: false })
    });
    assert.equal(self.response.status, 409);
    const missing = await request(`/api/users/${crypto.randomUUID()}/reset-password`, {
      method: "POST", body: JSON.stringify({ password: "another-pass-1234" })
    });
    assert.equal(missing.response.status, 404);
  });

  it("rejects cleaner account administration", async () => {
    const { request } = await fixture("cleaner");
    const response = await request("/api/users");
    assert.equal(response.response.status, 403);
  });
});
