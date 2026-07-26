import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { afterEach, describe, it } from "node:test";
import { errorHandler } from "../src/server/http.js";
import { createReportingRouter } from "../src/server/reporting.js";
import { testPool } from "./helpers.js";

const cleanups = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

async function fixture() {
  const pool = await testPool();
  const organizationId = crypto.randomUUID();
  const managerId = crypto.randomUUID();
  await pool.query("INSERT INTO organizations (id, name) VALUES ($1, 'Queen City Maid')", [organizationId]);
  await pool.query("INSERT INTO business_settings (organization_id) VALUES ($1)", [organizationId]);
  await pool.query(
    `INSERT INTO users (id, organization_id, email, name, role, password_hash)
     VALUES ($1, $2, 'manager@test.local', 'Manager', 'manager', 'hash')`,
    [managerId, organizationId]
  );
  await pool.query(
    `INSERT INTO customers (id, organization_id, type, name, phone, status)
     VALUES ($1, $2, 'residential', 'Jordan', '7045551000', 'active')`,
    [crypto.randomUUID(), organizationId]
  );
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.auth = {
      id: managerId,
      organizationId,
      role: req.headers["x-test-role"] || "manager"
    };
    next();
  });
  app.use("/api", createReportingRouter({ pool }));
  app.use(errorHandler);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  cleanups.push(() => new Promise((resolve) => server.close(resolve)), () => pool.end());
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, options = {}) => {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: { "content-type": "application/json", ...options.headers }
    });
    return { response, body: await response.json() };
  };
  return { pool, organizationId, managerId, request };
}

describe("dashboard, reports, and settings", () => {
  it("returns organization-scoped dashboard counts", async () => {
    const { pool, organizationId, request } = await fixture();
    const other = crypto.randomUUID();
    await pool.query("INSERT INTO organizations (id, name) VALUES ($1, 'Other')", [other]);
    await pool.query(
      `INSERT INTO customers (id, organization_id, type, name, phone, status)
       VALUES ($1, $2, 'residential', 'Secret', '7045559000', 'active')`,
      [crypto.randomUUID(), other]
    );
    const dashboard = await request("/api/dashboard");
    assert.equal(dashboard.response.status, 200);
    assert.equal(dashboard.body.data.activeCustomers, 1);
    assert.equal(dashboard.body.data.activeEmployees, 0);
    assert.equal(dashboard.body.data.servicesThisWeek, 0);
    assert.equal(dashboard.body.data.revenuePayPeriodCents, 0);
    assert.equal(dashboard.body.data.wagesPayPeriodCents, 0);
    assert.equal(dashboard.body.data.clientCreditsCents, 0);
    assert.equal(dashboard.body.data.unpaidBalanceCents, 0);
  });

  it("updates validated business settings with an audit event", async () => {
    const { pool, organizationId, request } = await fixture();
    const updated = await request("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({
        hourlyTeamRateCents: 10900,
        captainReimbursementCents: 1600
      })
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.data.settings.hourlyTeamRateCents, 10900);
    const audit = await pool.query(
      "SELECT action FROM audit_events WHERE organization_id = $1",
      [organizationId]
    );
    assert.equal(audit.rows[0].action, "update");

    const invalid = await request("/api/settings", {
      method: "PATCH", body: JSON.stringify({ responseTargetMinutes: 0 })
    });
    assert.equal(invalid.response.status, 400);
  });

  it("validates report ranges and returns empty operational totals", async () => {
    const { request } = await fixture();
    const invalid = await request("/api/reports/operations?from=2026-08-01&to=2026-07-01");
    assert.equal(invalid.response.status, 400);
    const report = await request("/api/reports/operations?from=2026-07-01&to=2026-07-31");
    assert.equal(report.response.status, 200);
    assert.equal(report.body.data.finances.chargedCents, 0);
    assert.deepEqual(report.body.data.bookings, {});
  });

  it("generates financial reports, stores expenses, and compares periods", async () => {
    const { pool, organizationId, managerId, request } = await fixture();
    const customer = await pool.query(
      "SELECT id FROM customers WHERE organization_id = $1",
      [organizationId]
    );
    const ids = Object.fromEntries([
      "employee", "property", "service", "priorBooking", "currentBooking",
      "charge", "payment", "payroll", "payrollLine"
    ].map((name) => [name, crypto.randomUUID()]));
    await pool.query(
      `INSERT INTO employees
       (id, organization_id, first_name, last_name, phone, hourly_rate_cents)
       VALUES ($1, $2, 'Alex', 'Cleaner', '7045552000', 2000)`,
      [ids.employee, organizationId]
    );
    await pool.query(
      `INSERT INTO properties
       (id, organization_id, customer_id, address_line1, city, postal_code)
       VALUES ($1, $2, $3, '1 Tryon Street', 'Charlotte', '28202')`,
      [ids.property, organizationId, customer.rows[0].id]
    );
    await pool.query(
      `INSERT INTO service_types (id, organization_id, name, category)
       VALUES ($1, $2, 'Regular Cleaning', 'residential')`,
      [ids.service, organizationId]
    );
    for (const booking of [
      [ids.priorBooking, "2026-06-15T13:00:00.000Z", "2026-06-15"],
      [ids.currentBooking, "2026-07-15T13:00:00.000Z", "2026-07-15"]
    ]) {
      await pool.query(
        `INSERT INTO bookings
         (id, organization_id, customer_id, property_id, service_type_id, status,
          scheduled_start, service_date, expected_duration_minutes, price_cents,
          completed_at)
         VALUES ($1, $2, $3, $4, $5, 'completed', $6, $7, 180, 30000, $6)`,
        [
          booking[0], organizationId, customer.rows[0].id,
          ids.property, ids.service, booking[1], booking[2]
        ]
      );
    }
    await pool.query(
      `INSERT INTO customer_charges
       (id, organization_id, customer_id, booking_id, type, description,
        amount_cents, status, charged_on)
       VALUES ($1, $2, $3, $4, 'service', 'Regular Cleaning', 30000, 'paid', '2026-07-15')`,
      [ids.charge, organizationId, customer.rows[0].id, ids.currentBooking]
    );
    await pool.query(
      `INSERT INTO payments
       (id, organization_id, customer_id, recorded_by, method, amount_cents, paid_at)
       VALUES ($1, $2, $3, $4, 'zelle', 30000, '2026-07-15T17:00:00.000Z')`,
      [ids.payment, organizationId, customer.rows[0].id, managerId]
    );
    await pool.query(
      `INSERT INTO payment_allocations (payment_id, charge_id, amount_cents)
       VALUES ($1, $2, 30000)`,
      [ids.payment, ids.charge]
    );
    await pool.query(
      `INSERT INTO payroll_periods
       (id, organization_id, starts_on, ends_on, status, approved_by, approved_at)
       VALUES ($1, $2, '2026-07-06', '2026-07-19', 'approved', $3, now())`,
      [ids.payroll, organizationId, managerId]
    );
    await pool.query(
      `INSERT INTO payroll_lines
       (id, organization_id, payroll_period_id, employee_id, week_starts_on,
        regular_minutes, overtime_minutes, hourly_rate_cents, gross_wages_cents)
       VALUES ($1, $2, $3, $4, '2026-07-06', 300, 0, 2000, 10000)`,
      [ids.payrollLine, organizationId, ids.payroll, ids.employee]
    );

    const expense = await request("/api/expenses", {
      method: "POST",
      body: JSON.stringify({
        spentOn: "2026-07-10",
        category: "supplies",
        description: "Cleaning supplies",
        amountCents: 5000
      })
    });
    assert.equal(expense.response.status, 201, JSON.stringify(expense.body));
    const expenseList = await request("/api/expenses?from=2026-07-01&to=2026-07-31");
    assert.equal(expenseList.response.status, 200);
    assert.equal(expenseList.body.data.expenses.length, 1);

    const monthly = await request(
      "/api/reports/financial?kind=monthly&from=2026-07-01&to=2026-07-31"
    );
    assert.equal(monthly.response.status, 200, JSON.stringify(monthly.body));
    assert.deepEqual(monthly.body.data.finances, {
      revenueCents: 30000,
      chargedCents: 30000,
      wagesCents: 10000,
      operatingExpensesCents: 5000,
      totalExpensesCents: 15000,
      profitCents: 15000,
      outstandingCents: 0,
      collectionRate: 1,
      averageRevenuePerServiceCents: 30000
    });
    assert.deepEqual(monthly.body.data.retention, {
      eligibleCustomers: 1,
      retainedCustomers: 1,
      retentionRate: 1
    });
    assert.deepEqual(monthly.body.data.expenseBreakdown, [
      { category: "wages", amountCents: 10000 },
      { category: "supplies", amountCents: 5000 }
    ]);
    assert.equal(monthly.body.data.services.total, 1);

    const payroll = await request(
      `/api/reports/financial?kind=payroll&from=2026-07-06&to=2026-07-19&payrollPeriodId=${ids.payroll}`
    );
    assert.equal(payroll.response.status, 200, JSON.stringify(payroll.body));
    assert.equal(payroll.body.data.finances.wagesCents, 10000);
    assert.equal(payroll.body.data.retention, null);

    const compared = await request(
      "/api/reports/compare?fromA=2026-06-01&toA=2026-06-30&fromB=2026-07-01&toB=2026-07-31"
    );
    assert.equal(compared.response.status, 200, JSON.stringify(compared.body));
    assert.equal(compared.body.data.trend, "growth");
    assert.equal(compared.body.data.comparison.revenueCents.change, 30000);

    const invalid = await request(
      "/api/reports/financial?kind=payroll&from=2026-07-01&to=2026-07-31"
    );
    assert.equal(invalid.response.status, 400);
    const denied = await request(
      "/api/reports/compare?fromA=2026-06-01&toA=2026-06-30&fromB=2026-07-01&toB=2026-07-31",
      { headers: { "x-test-role": "cleaner" } }
    );
    assert.equal(denied.response.status, 403);
  });
});
