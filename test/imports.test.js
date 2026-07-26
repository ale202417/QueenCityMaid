import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { afterEach, describe, it } from "node:test";
import { errorHandler } from "../src/server/http.js";
import { createImportRouter } from "../src/server/imports.js";
import { testPool } from "./helpers.js";

const cleanups = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

async function fixture() {
  const pool = await testPool();
  const organizationId = crypto.randomUUID();
  const managerId = crypto.randomUUID();
  await pool.query("INSERT INTO organizations (id, name) VALUES ($1, 'Queen City Maid')", [organizationId]);
  await pool.query(
    `INSERT INTO users (id, organization_id, email, name, role, password_hash)
     VALUES ($1, $2, 'manager@test.local', 'Manager', 'manager', 'hash')`,
    [managerId, organizationId]
  );
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.auth = { id: managerId, organizationId, role: "manager" };
    next();
  });
  app.use("/api", createImportRouter({ pool }));
  app.use(errorHandler);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  cleanups.push(() => new Promise((resolve) => server.close(resolve)), () => pool.end());
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, body) => {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    return { response, body: await response.json() };
  };
  return { pool, organizationId, request };
}

describe("onboarding imports", () => {
  it("creates and updates customers with properties", async () => {
    const { pool, organizationId, request } = await fixture();
    const row = {
      type: "residential",
      name: "Jordan Ellis",
      phone: "7045551000",
      serviceFrequency: "monthly",
      paymentMethod: "zelle",
      addressLine1: "1427 Queens Road",
      city: "Charlotte",
      postalCode: "28207"
    };
    const created = await request("/api/imports/customers", { rows: [row] });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.data.import.created, 1);
    assert.equal(created.body.data.import.propertiesCreated, 1);
    const updated = await request("/api/imports/customers", {
      rows: [{ ...row, name: "Jordan E. Ellis" }]
    });
    assert.equal(updated.body.data.import.updated, 1);
    const customer = await pool.query(
      `SELECT name, service_frequency AS "serviceFrequency",
              payment_method AS "paymentMethod"
       FROM customers WHERE organization_id = $1`,
      [organizationId]
    );
    assert.equal(customer.rows[0].name, "Jordan E. Ellis");
    assert.equal(customer.rows[0].serviceFrequency, "monthly");
    assert.equal(customer.rows[0].paymentMethod, "zelle");
  });

  it("imports employees and reports row validation errors", async () => {
    const { pool, organizationId, request } = await fixture();
    const result = await request("/api/imports/employees", {
      rows: [{
        firstName: "Angela",
        lastName: "Brooks",
        phone: "7045552000",
        hourlyRateCents: 1900,
        experienceLevel: "senior",
        canDrive: true
      }]
    });
    assert.equal(result.response.status, 201);
    const count = await pool.query(
      "SELECT COUNT(*)::integer AS count FROM employees WHERE organization_id = $1",
      [organizationId]
    );
    assert.equal(Number(count.rows[0].count), 1);
    const invalid = await request("/api/imports/customers", {
      rows: [{ name: "Missing phone", type: "residential" }]
    });
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.body.error.code, "validation_error");
  });
});
