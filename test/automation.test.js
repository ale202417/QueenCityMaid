import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { afterEach, describe, it } from "node:test";
import {
  createAutomationRouter,
  runDueAutomations,
  runOrganizationAutomation
} from "../src/server/automation.js";
import { errorHandler } from "../src/server/http.js";
import { testPool } from "./helpers.js";

const cleanups = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

async function fixture() {
  const pool = await testPool();
  const ids = Object.fromEntries(
    ["organization", "manager", "customer", "property", "service", "booking"]
      .map((key) => [key, crypto.randomUUID()])
  );
  await pool.query(
    "INSERT INTO organizations (id, name) VALUES ($1, 'Queen City Maid')",
    [ids.organization]
  );
  await pool.query(
    `INSERT INTO business_settings
     (organization_id, schedule_automation_enabled,
      service_reminder_automation_enabled, payment_reminder_automation_enabled,
      payment_reminder_days, automation_run_time)
     VALUES ($1, true, true, true, 7, '05:00')`,
    [ids.organization]
  );
  await pool.query(
    `INSERT INTO users (id, organization_id, email, name, role, password_hash)
     VALUES ($1, $2, 'manager@test.local', 'Manager', 'manager', 'hash')`,
    [ids.manager, ids.organization]
  );
  await pool.query(
    `INSERT INTO customers (id, organization_id, type, name, phone, status)
     VALUES ($1, $2, 'residential', 'Jordan Ellis', '7045552000', 'active')`,
    [ids.customer, ids.organization]
  );
  await pool.query(
    `INSERT INTO properties
     (id, organization_id, customer_id, address_line1, city, postal_code)
     VALUES ($1, $2, $3, '1427 Queens Road', 'Charlotte', '28207')`,
    [ids.property, ids.organization, ids.customer]
  );
  await pool.query(
    `INSERT INTO service_types (id, organization_id, name, category)
     VALUES ($1, $2, 'Regular Cleaning', 'residential')`,
    [ids.service, ids.organization]
  );
  await pool.query(
    `INSERT INTO bookings
     (id, organization_id, customer_id, property_id, service_type_id, status,
      scheduled_start, service_date, expected_duration_minutes, price_cents)
     VALUES ($1, $2, $3, $4, $5, 'confirmed',
             '2026-08-03T13:00:00Z', '2026-08-03', 180, 22000)`,
    [ids.booking, ids.organization, ids.customer, ids.property, ids.service]
  );
  await pool.query(
    `INSERT INTO text_consents
     (id, organization_id, customer_id, phone, status, source, recorded_by)
     VALUES ($1, $2, $3, '7045552000', 'granted', 'customer reply', $4)`,
    [crypto.randomUUID(), ids.organization, ids.customer, ids.manager]
  );
  await pool.query(
    `INSERT INTO customer_charges
     (id, organization_id, customer_id, type, description, amount_cents, status, charged_on)
     VALUES ($1, $2, $3, 'service', 'Regular cleaning', 22000, 'unpaid', '2026-07-01')`,
    [crypto.randomUUID(), ids.organization, ids.customer]
  );
  cleanups.push(() => pool.end());
  return { pool, ids };
}

describe("admin automations", () => {
  it("runs enabled steps once and safely reuses a completed run", async () => {
    const { pool, ids } = await fixture();
    const now = new Date("2026-07-28T14:00:00.000Z");
    const first = await runOrganizationAutomation(pool, {
      organizationId: ids.organization,
      actorUserId: ids.manager,
      now,
      runKey: "test:once"
    });
    assert.equal(first.duplicate, false);
    assert.equal(first.run.status, "completed");
    assert.equal(first.run.summary.serviceReminders.queued, 1);
    assert.equal(first.run.summary.paymentReminders.queued, 1);
    assert.equal(
      (await pool.query(
        "SELECT COUNT(*)::integer AS count FROM notifications WHERE organization_id = $1",
        [ids.organization]
      )).rows[0].count,
      2
    );

    const duplicate = await runOrganizationAutomation(pool, {
      organizationId: ids.organization,
      actorUserId: ids.manager,
      now,
      runKey: "test:once"
    });
    assert.equal(duplicate.duplicate, true);
    assert.equal(
      (await pool.query(
        "SELECT COUNT(*)::integer AS count FROM notifications WHERE organization_id = $1",
        [ids.organization]
      )).rows[0].count,
      2
    );

    await runDueAutomations(pool, now);
    await runDueAutomations(pool, now);
    const scheduled = await pool.query(
      `SELECT COUNT(*)::integer AS count
       FROM automation_runs
       WHERE organization_id = $1 AND trigger = 'scheduled'`,
      [ids.organization]
    );
    assert.equal(scheduled.rows[0].count, 1);
  });

  it("retries a failed daily run and skips customers without text consent", async () => {
    const { pool, ids } = await fixture();
    await pool.query(
      "UPDATE organizations SET timezone = 'Invalid/Timezone' WHERE id = $1",
      [ids.organization]
    );
    await assert.rejects(
      runOrganizationAutomation(pool, {
        organizationId: ids.organization,
        now: new Date("2026-07-28T14:00:00.000Z"),
        runKey: "test:retry"
      })
    );
    assert.equal(
      (await pool.query(
        "SELECT status FROM automation_runs WHERE organization_id = $1 AND run_key = 'test:retry'",
        [ids.organization]
      )).rows[0].status,
      "failed"
    );

    await pool.query(
      "UPDATE organizations SET timezone = 'America/New_York' WHERE id = $1",
      [ids.organization]
    );
    await pool.query(
      `INSERT INTO text_consents
       (id, organization_id, customer_id, phone, status, source, recorded_by)
       VALUES ($1, $2, $3, '7045552000', 'revoked', 'customer reply', $4)`,
      [crypto.randomUUID(), ids.organization, ids.customer, ids.manager]
    );
    const retried = await runOrganizationAutomation(pool, {
      organizationId: ids.organization,
      now: new Date("2026-07-28T14:00:00.000Z"),
      runKey: "test:retry"
    });
    assert.equal(retried.run.status, "completed");
    assert.equal(retried.run.summary.serviceReminders.skippedNoConsent, 1);
    assert.equal(retried.run.summary.paymentReminders.skippedNoConsent, 1);
  });

  it("exposes manager-only status and keeps another company private", async () => {
    const { pool, ids } = await fixture();
    const otherOrganization = crypto.randomUUID();
    await pool.query(
      "INSERT INTO organizations (id, name) VALUES ($1, 'Other Company')",
      [otherOrganization]
    );
    await pool.query(
      "INSERT INTO business_settings (organization_id) VALUES ($1)",
      [otherOrganization]
    );
    await pool.query(
      `INSERT INTO automation_runs
       (id, organization_id, run_key, trigger, status)
       VALUES ($1, $2, 'secret', 'manual', 'completed')`,
      [crypto.randomUUID(), otherOrganization]
    );

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.auth = {
        id: ids.manager,
        organizationId: ids.organization,
        role: req.headers["x-test-role"] || "manager"
      };
      next();
    });
    app.use("/api", createAutomationRouter({
      pool,
      sender: { configured: false }
    }));
    app.use(errorHandler);
    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    cleanups.push(() => new Promise((resolve) => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (path, options = {}) => {
      const response = await fetch(`${base}${path}`, {
        ...options,
        headers: { "content-type": "application/json", ...options.headers }
      });
      return { response, body: await response.json() };
    };

    const status = await request("/api/automations");
    assert.equal(status.response.status, 200);
    assert.equal(status.body.data.providerConfigured, false);
    assert.equal(status.body.data.runs.length, 0);
    const denied = await request("/api/automations", {
      headers: { "x-test-role": "cleaner" }
    });
    assert.equal(denied.response.status, 403);
    const invalid = await request("/api/automations/run", {
      method: "POST",
      body: JSON.stringify({ unexpected: true })
    });
    assert.equal(invalid.response.status, 400);
    const deniedRun = await request("/api/automations/run", {
      method: "POST",
      body: "{}",
      headers: { "x-test-role": "cleaner" }
    });
    assert.equal(deniedRun.response.status, 403);
    const run = await request("/api/automations/run", {
      method: "POST",
      body: "{}"
    });
    assert.equal(run.response.status, 201);
    assert.equal(run.body.data.run.status, "completed");
    const refreshed = await request("/api/automations");
    assert.equal(refreshed.body.data.runs.length, 1);
    assert.equal(refreshed.body.data.runs[0].id, run.body.data.run.id);
  });
});
