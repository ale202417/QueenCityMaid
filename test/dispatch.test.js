import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { afterEach, describe, it } from "node:test";
import { createDispatchRouter } from "../src/server/dispatch.js";
import { errorHandler } from "../src/server/http.js";
import { testPool } from "./helpers.js";

const cleanups = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

async function fixture(role = "manager") {
  const pool = await testPool();
  const ids = Object.fromEntries([
    "organization", "user", "captainUser", "captain", "cleaner", "team",
    "customer", "property", "service", "booking"
  ].map((key) => [key, crypto.randomUUID()]));
  await pool.query("INSERT INTO organizations (id, name) VALUES ($1, 'Queen City Maid')", [ids.organization]);
  await pool.query(
    `INSERT INTO users (id, organization_id, email, name, role, password_hash)
     VALUES ($1, $2, 'manager@test.local', 'Manager', 'manager', 'hash'),
            ($3, $2, 'captain@test.local', 'Captain', 'cleaner', 'hash')`,
    [ids.user, ids.organization, ids.captainUser]
  );
  await pool.query(
    `INSERT INTO employees
     (id, organization_id, user_id, first_name, last_name, phone, hourly_rate_cents, can_drive)
     VALUES ($1, $2, $3, 'Angela', 'Brooks', '7045551000', 1900, true),
            ($4, $2, NULL, 'Maya', 'Collins', '7045551001', 1750, false)`,
    [ids.captain, ids.organization, ids.captainUser, ids.cleaner]
  );
  await pool.query("INSERT INTO teams (id, organization_id, name) VALUES ($1, $2, 'Crown')", [ids.team, ids.organization]);
  await pool.query(
    `INSERT INTO team_members (team_id, employee_id, is_captain, effective_from)
     VALUES ($1, $2, true, '2026-01-01'), ($1, $3, false, '2026-01-01')`,
    [ids.team, ids.captain, ids.cleaner]
  );
  await pool.query(
    `INSERT INTO customers (id, organization_id, type, name, phone)
     VALUES ($1, $2, 'residential', 'Jordan Ellis', '7045552000')`,
    [ids.customer, ids.organization]
  );
  await pool.query(
    `INSERT INTO properties
     (id, organization_id, customer_id, address_line1, city, postal_code)
     VALUES ($1, $2, $3, '1427 Queens Road', 'Charlotte', '28207')`,
    [ids.property, ids.organization, ids.customer]
  );
  await pool.query(
    `INSERT INTO service_types
     (id, organization_id, name, category, default_duration_minutes)
     VALUES ($1, $2, 'Regular Cleaning', 'residential', 180)`,
    [ids.service, ids.organization]
  );
  await pool.query(
    `INSERT INTO bookings
     (id, organization_id, customer_id, property_id, service_type_id, status,
      scheduled_start, expected_duration_minutes, price_cents)
     VALUES ($1, $2, $3, $4, $5, 'confirmed', '2026-07-27T13:00:00Z', 180, 22000)`,
    [ids.booking, ids.organization, ids.customer, ids.property, ids.service]
  );

  const auth = role === "manager"
    ? { id: ids.user, organizationId: ids.organization, role: "manager" }
    : { id: ids.captainUser, organizationId: ids.organization, role: "cleaner" };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.auth = auth;
    next();
  });
  app.use("/api", createDispatchRouter({ pool }));
  app.use(errorHandler);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  cleanups.push(() => new Promise((resolve) => server.close(resolve)), () => pool.end());
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, options = {}) {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: { "content-type": "application/json", ...(options.headers || {}) }
    });
    return { response, body: await response.json() };
  }
  return { pool, ids, request };
}

describe("dispatch and service day", () => {
  it("builds and finalizes a route with the full team assigned", async () => {
    const { ids, request, pool } = await fixture();
    const created = await request("/api/routes", {
      method: "POST",
      body: JSON.stringify({
        teamId: ids.team,
        serviceDate: "2026-07-27",
        stops: [{
          bookingId: ids.booking,
          stopOrder: 1,
          estimatedArrival: "2026-07-27T13:00:00.000Z",
          estimatedDeparture: "2026-07-27T16:00:00.000Z",
          travelMinutesFromPrevious: 0
        }]
      })
    });
    assert.equal(created.response.status, 201);
    const routeId = created.body.data.route.id;
    const assignments = await pool.query(
      "SELECT role FROM job_assignments WHERE booking_id = $1 ORDER BY role",
      [ids.booking]
    );
    assert.deepEqual(assignments.rows.map((row) => row.role), ["captain", "cleaner"]);

    const finalized = await request(`/api/routes/${routeId}/finalize`, {
      method: "POST",
      body: "{}"
    });
    assert.equal(finalized.response.status, 200);
    assert.equal(finalized.body.data.route.status, "finalized");
  });

  it("rejects invalid route input and unavailable crews", async () => {
    const { ids, request, pool } = await fixture();
    const invalid = await request("/api/routes", {
      method: "POST",
      body: JSON.stringify({ teamId: ids.team, serviceDate: "bad", stops: [] })
    });
    assert.equal(invalid.response.status, 400);

    await pool.query(
      `INSERT INTO availability_exceptions
       (id, organization_id, employee_id, starts_at, ends_at, reason, status)
       VALUES ($1, $2, $3, '2026-07-27T00:00:00Z', '2026-07-27T23:00:00Z', 'PTO', 'approved')`,
      [crypto.randomUUID(), ids.organization, ids.cleaner]
    );
    const unavailable = await request("/api/routes", {
      method: "POST",
      body: JSON.stringify({
        teamId: ids.team,
        serviceDate: "2026-07-27",
        stops: [{ bookingId: ids.booking, stopOrder: 1 }]
      })
    });
    assert.equal(unavailable.response.status, 409);
    assert.equal(unavailable.body.error.code, "team_unavailable");
  });

  it("lets the captain view the route and check the team in and out", async () => {
    const manager = await fixture();
    const created = await manager.request("/api/routes", {
      method: "POST",
      body: JSON.stringify({
        teamId: manager.ids.team,
        serviceDate: "2026-07-27",
        stops: [{ bookingId: manager.ids.booking, stopOrder: 1 }]
      })
    });
    const routeId = created.body.data.route.id;
    await manager.request(`/api/routes/${routeId}/finalize`, { method: "POST", body: "{}" });

    const auth = {
      id: manager.ids.captainUser,
      organizationId: manager.ids.organization,
      role: "cleaner"
    };
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.auth = auth; next(); });
    app.use("/api", createDispatchRouter({ pool: manager.pool }));
    app.use(errorHandler);
    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    cleanups.push(() => new Promise((resolve) => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (path, options = {}) => {
      const response = await fetch(`${base}${path}`, {
        ...options,
        headers: { "content-type": "application/json" }
      });
      return { response, body: await response.json() };
    };

    const view = await call("/api/my-route?date=2026-07-27");
    assert.equal(view.response.status, 200);
    assert.equal(view.body.data.stops.length, 1);
    assert.equal(view.body.data.route.isCaptain, true);

    const checkedIn = await call(`/api/routes/${routeId}/check-in`, {
      method: "POST",
      body: JSON.stringify({ occurredAt: "2026-07-27T12:55:00.000Z" })
    });
    assert.equal(checkedIn.body.data.employeeCount, 2);
    const checkedOut = await call(`/api/routes/${routeId}/check-out`, {
      method: "POST",
      body: JSON.stringify({ occurredAt: "2026-07-27T21:05:00.000Z" })
    });
    assert.equal(checkedOut.response.status, 200);
    const entries = await manager.pool.query(
      "SELECT status, paid_minutes FROM time_entries WHERE route_id = $1",
      [routeId]
    );
    assert.ok(entries.rows.every((entry) => entry.status === "submitted" && entry.paid_minutes === 490));
    const charges = await manager.pool.query(
      "SELECT amount_cents, status FROM customer_charges WHERE booking_id = $1",
      [manager.ids.booking]
    );
    assert.deepEqual(charges.rows, [{ amount_cents: 22000, status: "unpaid" }]);
  });

  it("creates extra-work charges only when a manager resolves an approved issue", async () => {
    const { ids, request, pool } = await fixture();
    const created = await request(`/api/bookings/${ids.booking}/issues`, {
      method: "POST",
      body: JSON.stringify({
        type: "extra_work",
        description: "Customer requested patio cleaning"
      })
    });
    assert.equal(created.response.status, 201);
    const issueId = created.body.data.issue.id;
    const open = await request("/api/job-issues?status=open");
    assert.equal(open.response.status, 200);
    assert.deepEqual(
      open.body.data.jobIssues.map((issue) => ({
        id: issue.id,
        customerName: issue.customerName,
        type: issue.type,
        resolvedAt: issue.resolvedAt
      })),
      [{
        id: issueId,
        customerName: "Jordan Ellis",
        type: "extra_work",
        resolvedAt: null
      }]
    );
    const invalid = await request(`/api/job-issues/${issueId}`, {
      method: "PATCH",
      body: JSON.stringify({
        customerApproved: true,
        additionalChargeCents: 0,
        resolutionNotes: "Approved by text"
      })
    });
    assert.equal(invalid.response.status, 400);

    const resolved = await request(`/api/job-issues/${issueId}`, {
      method: "PATCH",
      body: JSON.stringify({
        customerApproved: true,
        additionalChargeCents: 5000,
        resolutionNotes: "Approved by text"
      })
    });
    assert.equal(resolved.response.status, 200);
    const resolvedList = await request("/api/job-issues?status=resolved");
    assert.equal(resolvedList.body.data.jobIssues[0].id, issueId);
    assert.ok(resolvedList.body.data.jobIssues[0].resolvedAt);
    const charge = await pool.query(
      "SELECT type, amount_cents FROM customer_charges WHERE booking_id = $1",
      [ids.booking]
    );
    assert.deepEqual(charge.rows, [{ type: "additional_work", amount_cents: 5000 }]);
  });

  it("does not expose the manager issue queue to cleaners", async () => {
    const { request } = await fixture("cleaner");
    const response = await request("/api/job-issues?status=all");
    assert.equal(response.response.status, 403);
    assert.equal(response.body.error.code, "forbidden");
  });
});
