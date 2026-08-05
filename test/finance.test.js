import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { afterEach, describe, it } from "node:test";
import { createFinanceRouter } from "../src/server/finance.js";
import { errorHandler, notFound } from "../src/server/http.js";
import { testPool } from "./helpers.js";

const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const pool = await testPool();
  const ids = Object.fromEntries([
    "organizationA", "organizationB", "managerA", "managerB", "cleanerA",
    "customerA", "customerB", "employeeA1", "employeeA2", "employeeB",
    "propertyA", "propertyB", "serviceA", "serviceB", "bookingA", "bookingB",
    "teamA", "teamB", "routeA", "routeB", "timeA1", "timeA2", "timeB"
  ].map((name) => [name, crypto.randomUUID()]));

  await pool.query(
    `INSERT INTO organizations (id, name)
     VALUES ($1, 'Queen City Maid'), ($2, 'Other Cleaning')`,
    [ids.organizationA, ids.organizationB]
  );
  for (const user of [
    [ids.managerA, ids.organizationA, "manager-a@example.com", "Manager A", "manager"],
    [ids.cleanerA, ids.organizationA, "cleaner-a@example.com", "Cleaner A", "cleaner"],
    [ids.managerB, ids.organizationB, "manager-b@example.com", "Manager B", "manager"]
  ]) {
    await pool.query(
      `INSERT INTO users (id, organization_id, email, name, role, password_hash)
       VALUES ($1, $2, $3, $4, $5, 'unused-test-hash')`,
      user
    );
  }
  for (const customer of [
    [ids.customerA, ids.organizationA, "Charlotte Customer", "704-555-1000"],
    [ids.customerB, ids.organizationB, "Other Customer", "704-555-2000"]
  ]) {
    await pool.query(
      `INSERT INTO customers (id, organization_id, type, name, phone)
       VALUES ($1, $2, 'residential', $3, $4)`,
      customer
    );
  }
  for (const employee of [
    [ids.employeeA1, ids.organizationA, "Alex", "Captain", "704-555-1001", 2000],
    [ids.employeeA2, ids.organizationA, "Blair", "Cleaner", "704-555-1002", 1800],
    [ids.employeeB, ids.organizationB, "Other", "Cleaner", "704-555-2001", 1900]
  ]) {
    await pool.query(
      `INSERT INTO employees
       (id, organization_id, first_name, last_name, phone, hourly_rate_cents)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      employee
    );
  }
  for (const service of [
    [ids.serviceA, ids.organizationA, "Regular Cleaning"],
    [ids.serviceB, ids.organizationB, "Other Cleaning"]
  ]) {
    await pool.query(
      `INSERT INTO service_types (id, organization_id, name, category)
       VALUES ($1, $2, $3, 'residential')`,
      service
    );
  }
  for (const property of [
    [ids.propertyA, ids.organizationA, ids.customerA, "1 Tryon Street"],
    [ids.propertyB, ids.organizationB, ids.customerB, "2 Trade Street"]
  ]) {
    await pool.query(
      `INSERT INTO properties
       (id, organization_id, customer_id, address_line1, city, postal_code)
       VALUES ($1, $2, $3, $4, 'Charlotte', '28202')`,
      property
    );
  }
  for (const booking of [
    [
      ids.bookingA, ids.organizationA, ids.customerA, ids.propertyA,
      ids.serviceA, "2026-07-20T13:00:00.000Z"
    ],
    [
      ids.bookingB, ids.organizationB, ids.customerB, ids.propertyB,
      ids.serviceB, "2026-07-20T13:00:00.000Z"
    ]
  ]) {
    await pool.query(
      `INSERT INTO bookings
       (id, organization_id, customer_id, property_id, service_type_id, status,
        scheduled_start, expected_duration_minutes, price_cents)
       VALUES ($1, $2, $3, $4, $5, 'completed', $6, 240, 15000)`,
      booking
    );
  }
  await pool.query(
    `INSERT INTO teams (id, organization_id, name)
     VALUES ($1, $2, 'Team A'), ($3, $4, 'Team B')`,
    [ids.teamA, ids.organizationA, ids.teamB, ids.organizationB]
  );
  await pool.query(
    `INSERT INTO team_members (team_id, employee_id, is_captain, effective_from)
     VALUES ($1, $2, true, '2026-01-01'), ($1, $3, false, '2026-01-01'),
            ($4, $5, true, '2026-01-01')`,
    [ids.teamA, ids.employeeA1, ids.employeeA2, ids.teamB, ids.employeeB]
  );
  await pool.query(
    `INSERT INTO routes
     (id, organization_id, team_id, captain_employee_id, service_date, status)
     VALUES
       ($1, $2, $3, $4, '2026-07-20', 'completed'),
       ($5, $6, $7, $8, '2026-07-20', 'completed')`,
    [
      ids.routeA, ids.organizationA, ids.teamA, ids.employeeA1,
      ids.routeB, ids.organizationB, ids.teamB, ids.employeeB
    ]
  );
  await pool.query(
    `INSERT INTO job_assignments (booking_id, employee_id, role)
     VALUES ($1, $2, 'captain'), ($1, $3, 'cleaner'), ($4, $5, 'captain')`,
    [ids.bookingA, ids.employeeA1, ids.employeeA2, ids.bookingB, ids.employeeB]
  );
  await pool.query(
    `INSERT INTO time_entries
     (id, organization_id, route_id, employee_id, status, check_in_at, check_out_at, paid_minutes)
     VALUES
       ($1, $2, $3, $4, 'submitted',
        '2026-07-20T12:00:00.000Z', '2026-07-20T20:00:00.000Z', 480),
       ($5, $2, $3, $6, 'approved',
        '2026-07-20T12:00:00.000Z', '2026-07-20T22:00:00.000Z', 600),
       ($7, $8, $9, $10, 'approved',
        '2026-07-20T12:00:00.000Z', '2026-07-20T20:00:00.000Z', 480)`,
    [
      ids.timeA1, ids.organizationA, ids.routeA, ids.employeeA1,
      ids.timeA2, ids.employeeA2,
      ids.timeB, ids.organizationB, ids.routeB, ids.employeeB
    ]
  );
  await pool.query(
    `INSERT INTO business_settings (organization_id, captain_reimbursement_cents)
     VALUES ($1, 1600), ($2, 1600)`,
    [ids.organizationA, ids.organizationB]
  );

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (req.headers["x-test-role"]) {
      req.auth = {
        id: req.headers["x-test-user"],
        organizationId: req.headers["x-test-organization"],
        role: req.headers["x-test-role"]
      };
    }
    next();
  });
  app.use("/api", createFinanceRouter({ pool }));
  app.use(notFound);
  app.use(errorHandler);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  cleanups.push(
    () => pool.end(),
    () => new Promise((resolve) => server.close(resolve))
  );
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(path, {
    role = "manager",
    organizationId = ids.organizationA,
    userId = ids.managerA,
    body,
    ...options
  } = {}) {
    const headers = { ...(options.headers || {}) };
    if (role) {
      headers["x-test-role"] = role;
      headers["x-test-organization"] = organizationId;
      headers["x-test-user"] = userId;
    }
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { response, body: await response.json() };
  }

  return { pool, ids, request };
}

async function createCharge(request, customerId, amountCents, chargedOn) {
  const result = await request(`/api/customers/${customerId}/charges`, {
    method: "POST",
    body: {
      type: "service",
      description: `Service ${chargedOn}`,
      amountCents,
      chargedOn
    }
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
  return result.body.data.charge;
}

describe("finance", () => {
  it("allocates payments to oldest charges and records overpayment credit", async () => {
    const { pool, ids, request } = await fixture();
    const first = await createCharge(request, ids.customerA, 10000, "2026-07-20");
    const second = await createCharge(request, ids.customerA, 5000, "2026-07-22");

    const payment = await request(`/api/customers/${ids.customerA}/payments`, {
      method: "POST",
      body: {
        method: "zelle",
        amountCents: 17000,
        paidAt: "2026-07-24T15:00:00-04:00",
        reference: "July payment"
      }
    });
    assert.equal(payment.response.status, 201, JSON.stringify(payment.body));
    assert.deepEqual(payment.body.data.allocations, [
      { chargeId: first.id, amountCents: 10000 },
      { chargeId: second.id, amountCents: 5000 }
    ]);
    assert.equal(payment.body.data.credit.amountCents, 2000);

    const ledger = await request(`/api/customers/${ids.customerA}/ledger`);
    assert.equal(ledger.response.status, 200);
    assert.deepEqual(ledger.body.data.totals, {
      chargedCents: 15000,
      paidCents: 15000,
      outstandingCents: 0,
      creditCents: 2000
    });
    assert.ok(ledger.body.data.charges.every(({ status }) => status === "paid"));
    const creditedCharge = await createCharge(
      request,
      ids.customerA,
      2000,
      "2026-07-25"
    );
    assert.equal(creditedCharge.status, "paid");
    const afterCredit = await request(`/api/customers/${ids.customerA}/ledger`);
    assert.equal(afterCredit.body.data.totals.creditCents, 0);
    assert.equal(afterCredit.body.data.totals.outstandingCents, 0);

    const reversed = await request(`/api/payments/${payment.body.data.payment.id}/reverse`, {
      method: "POST",
      body: { reason: "Manager entered the payment twice" }
    });
    assert.equal(reversed.response.status, 200, JSON.stringify(reversed.body));
    assert.equal(reversed.body.data.payment.status, "reversed");
    const preservedAllocations = await pool.query(
      `SELECT amount_cents, reversed_at, reversal_reason
       FROM payment_allocations
       WHERE payment_id = $1
       ORDER BY charge_id`,
      [payment.body.data.payment.id]
    );
    assert.equal(preservedAllocations.rowCount, 3);
    assert.ok(preservedAllocations.rows.every((allocation) => allocation.reversed_at));
    assert.ok(preservedAllocations.rows.every(
      (allocation) => allocation.reversal_reason === "Manager entered the payment twice"
    ));
    const correctedLedger = await request(`/api/customers/${ids.customerA}/ledger`);
    assert.equal(correctedLedger.body.data.totals.outstandingCents, 17000);
    assert.equal(correctedLedger.body.data.totals.creditCents, 0);
    const repeatedReversal = await request(`/api/payments/${payment.body.data.payment.id}/reverse`, {
      method: "POST",
      body: { reason: "Repeated correction" }
    });
    assert.equal(repeatedReversal.response.status, 409);

    const invalid = await request(`/api/customers/${ids.customerA}/payments`, {
      method: "POST",
      body: {
        method: "zelle",
        amountCents: -1,
        paidAt: "2026-07-24T15:00:00-04:00"
      }
    });
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.body.error.code, "validation_error");

    const audit = await pool.query(
      `SELECT action FROM audit_events
       WHERE organization_id = $1 AND entity_type IN ('customer_charge', 'payment')`,
      [ids.organizationA]
    );
    assert.equal(audit.rowCount, 5);
  });

  it("records full or partial payment against the selected unpaid charge", async () => {
    const { pool, ids, request } = await fixture();
    const older = await createCharge(request, ids.customerA, 10000, "2026-07-20");
    const selected = await createCharge(request, ids.customerA, 5000, "2026-07-22");
    const body = {
      method: "venmo",
      amountCents: 3000,
      paidAt: "2026-07-24T15:00:00-04:00",
      reference: "Partial service payment"
    };

    const denied = await request(`/api/charges/${selected.id}/payments`, {
      role: "cleaner",
      userId: ids.cleanerA,
      method: "POST",
      body
    });
    assert.equal(denied.response.status, 403);

    const partial = await request(`/api/charges/${selected.id}/payments`, {
      method: "POST",
      body
    });
    assert.equal(partial.response.status, 201, JSON.stringify(partial.body));
    assert.deepEqual(partial.body.data.allocation, {
      chargeId: selected.id,
      amountCents: 3000
    });
    assert.equal(partial.body.data.charge.status, "unpaid");
    assert.equal(partial.body.data.charge.outstandingCents, 2000);

    const allocations = await pool.query(
      `SELECT charge_id, amount_cents FROM payment_allocations
       WHERE reversed_at IS NULL ORDER BY charge_id`,
    );
    assert.deepEqual(allocations.rows, [{ charge_id: selected.id, amount_cents: 3000 }]);
    const records = await request("/api/payments/records");
    const remaining = records.body.data.declined.find((charge) => charge.id === selected.id);
    assert.equal(remaining.amountCents, 2000);
    assert.equal(remaining.originalAmountCents, 5000);

    const completed = await request(`/api/charges/${selected.id}/payments`, {
      method: "POST",
      body: {
        ...body,
        amountCents: 2500,
        reference: "Final service payment"
      }
    });
    assert.equal(completed.response.status, 201, JSON.stringify(completed.body));
    assert.equal(completed.body.data.allocation.amountCents, 2000);
    assert.equal(completed.body.data.charge.status, "paid");
    assert.equal(completed.body.data.credit.remainingCents, 500);

    const statuses = await pool.query(
      "SELECT id, status FROM customer_charges WHERE id IN ($1, $2) ORDER BY id",
      [older.id, selected.id]
    );
    assert.equal(statuses.rows.find((charge) => charge.id === older.id).status, "unpaid");
    assert.equal(statuses.rows.find((charge) => charge.id === selected.id).status, "paid");
    const repeated = await request(`/api/charges/${selected.id}/payments`, {
      method: "POST",
      body
    });
    assert.equal(repeated.response.status, 409);

    const foreign = await createCharge(
      (path, options) => request(path, {
        ...options,
        organizationId: ids.organizationB,
        userId: ids.managerB
      }),
      ids.customerB,
      4000,
      "2026-07-22"
    );
    const hidden = await request(`/api/charges/${foreign.id}/payments`, {
      method: "POST",
      body
    });
    assert.equal(hidden.response.status, 404);

    const audit = await pool.query(
      `SELECT action FROM audit_events
       WHERE organization_id = $1 AND entity_type = 'payment'`,
      [ids.organizationA]
    );
    assert.equal(audit.rowCount, 2);
    assert.ok(audit.rows.every(({ action }) => action === "create_for_charge"));
  });

  it("turns the daily schedule into approved payments and declined balances", async () => {
    const { pool, ids, request } = await fixture();
    const daily = await request("/api/payments/daily?date=2026-07-20");
    assert.equal(daily.response.status, 200, JSON.stringify(daily.body));
    assert.equal(daily.body.data.services.length, 1);
    assert.deepEqual(
      {
        customerName: daily.body.data.services[0].customerName,
        serviceName: daily.body.data.services[0].serviceName,
        billingType: daily.body.data.services[0].billingType,
        amountCents: daily.body.data.services[0].amountCents,
        decision: daily.body.data.services[0].decision
      },
      {
        customerName: "Charlotte Customer",
        serviceName: "Regular Cleaning",
        billingType: "flat",
        amountCents: 15000,
        decision: null
      }
    );

    const approved = await request(`/api/payments/daily/${ids.bookingA}/decision`, {
      method: "POST",
      body: { decision: "approved", paymentMethod: "venmo" }
    });
    assert.equal(approved.response.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.data.service.decision, "approved");
    assert.equal(approved.body.data.service.amountCents, 15000);
    assert.equal(approved.body.data.service.paymentMethod, "venmo");

    const duplicate = await request(`/api/payments/daily/${ids.bookingA}/decision`, {
      method: "POST",
      body: { decision: "approved", paymentMethod: "cash" }
    });
    assert.equal(duplicate.response.status, 409);
    assert.equal(duplicate.body.error.code, "payment_already_approved");

    const hourlyBooking = crypto.randomUUID();
    await pool.query(
      `INSERT INTO bookings
       (id, organization_id, customer_id, property_id, service_type_id, status,
        scheduled_start, service_date, expected_duration_minutes, price_cents,
        billing_type, billing_rate_cents)
       VALUES ($1, $2, $3, $4, $5, 'completed',
               '2026-07-20T17:00:00.000Z', '2026-07-20', 120, 0, 'hourly', 9900)`,
      [
        hourlyBooking, ids.organizationA, ids.customerA,
        ids.propertyA, ids.serviceA
      ]
    );
    const missingHours = await request(`/api/payments/daily/${hourlyBooking}/decision`, {
      method: "POST",
      body: { decision: "declined" }
    });
    assert.equal(missingHours.response.status, 400);
    assert.equal(missingHours.body.error.code, "hourly_minutes_required");

    const declined = await request(`/api/payments/daily/${hourlyBooking}/decision`, {
      method: "POST",
      body: { decision: "declined", hourlyMinutes: 120 }
    });
    assert.equal(declined.response.status, 200, JSON.stringify(declined.body));
    assert.equal(declined.body.data.service.amountCents, 19800);
    assert.equal(declined.body.data.service.decision, "declined");

    const records = await request("/api/payments/records");
    assert.equal(records.response.status, 200, JSON.stringify(records.body));
    assert.equal(records.body.data.payments.length, 1);
    assert.equal(records.body.data.declined.length, 1);
    assert.equal(records.body.data.credits.length, 0);

    const overview = await request("/api/payments/overview");
    assert.equal(overview.response.status, 200, JSON.stringify(overview.body));
    assert.deepEqual(
      {
        chargedCents: overview.body.data.customers[0].chargedCents,
        paidCents: overview.body.data.customers[0].paidCents,
        outstandingCents: overview.body.data.customers[0].outstandingCents,
        standing: overview.body.data.customers[0].standing
      },
      {
        chargedCents: 34800,
        paidCents: 15000,
        outstandingCents: 19800,
        standing: "past_due"
      }
    );

    const waived = await request(`/api/charges/${records.body.data.declined[0].id}/waive`, {
      method: "POST",
      body: { reason: "Manager approved a courtesy waiver" }
    });
    assert.equal(waived.response.status, 200, JSON.stringify(waived.body));
    assert.equal(waived.body.data.charge.status, "waived");
    const noOutstanding = await request("/api/payments/overview");
    assert.equal(noOutstanding.body.data.customers[0].outstandingCents, 0);
    const repeatedWaiver = await request(`/api/charges/${records.body.data.declined[0].id}/waive`, {
      method: "POST",
      body: { reason: "Repeated waiver" }
    });
    assert.equal(repeatedWaiver.response.status, 409);

    const laterApproved = await request(`/api/payments/daily/${hourlyBooking}/decision`, {
      method: "POST",
      body: { decision: "approved", hourlyMinutes: 120, paymentMethod: "zelle" }
    });
    assert.equal(laterApproved.response.status, 200, JSON.stringify(laterApproved.body));
    assert.equal(laterApproved.body.data.service.decision, "approved");

    const correctedRecords = await request("/api/payments/records");
    const venmoPayment = correctedRecords.body.data.payments.find(
      (item) => item.method === "venmo"
    );
    const reversed = await request(`/api/payments/${venmoPayment.id}/reverse`, {
      method: "POST",
      body: { reason: "Wrong payment was approved" }
    });
    assert.equal(reversed.response.status, 200, JSON.stringify(reversed.body));
    const afterReversal = await request("/api/payments/daily?date=2026-07-20");
    const correctedService = afterReversal.body.data.services.find(
      (item) => item.bookingId === ids.bookingA
    );
    assert.equal(correctedService.decision, "declined");
    assert.equal(correctedService.chargeStatus, "unpaid");

    const denied = await request("/api/payments/records", {
      role: "cleaner",
      userId: ids.cleanerA
    });
    assert.equal(denied.response.status, 403);
    const reverseDenied = await request(`/api/payments/${venmoPayment.id}/reverse`, {
      method: "POST",
      role: "cleaner",
      userId: ids.cleanerA,
      body: { reason: "Not allowed" }
    });
    assert.equal(reverseDenied.response.status, 403);
    const isolated = await request("/api/payments/daily?date=2026-07-20", {
      organizationId: ids.organizationB,
      userId: ids.managerB
    });
    assert.equal(isolated.response.status, 200);
    assert.deepEqual(
      isolated.body.data.services.map((service) => service.customerName),
      ["Other Customer"]
    );
  });

  it("records manager-entered weekly hours, tips, captain pay, reports, and history", async () => {
    const { pool, ids, request } = await fixture();
    const tip = await request(`/api/bookings/${ids.bookingA}/tips`, {
      method: "POST",
      body: { amountCents: 1001, source: "customer" }
    });
    assert.equal(tip.response.status, 201, JSON.stringify(tip.body));
    assert.deepEqual(
      tip.body.data.shares.map(({ employeeId }) => employeeId),
      [ids.employeeA1, ids.employeeA2].sort()
    );
    assert.equal(
      tip.body.data.shares.reduce((sum, share) => sum + share.amountCents, 0),
      1001
    );
    const serviceTipByEmployee = new Map(
      tip.body.data.shares.map((share) => [share.employeeId, share.amountCents])
    );
    const duplicateTip = await request(`/api/bookings/${ids.bookingA}/tips`, {
      method: "POST",
      body: { amountCents: 1001, source: "customer" }
    });
    assert.equal(duplicateTip.response.status, 409);

    const correction = await request(`/api/time-entries/${ids.timeA1}/corrections`, {
      method: "POST",
      body: { paidMinutes: 2700, reason: "Manager confirmed travel and service time" }
    });
    assert.equal(correction.response.status, 200, JSON.stringify(correction.body));
    assert.equal(correction.body.data.timeEntry.status, "corrected");
    assert.equal(correction.body.data.timeEntry.paidMinutes, 2700);

    const approval = await request(`/api/time-entries/${ids.timeA1}/approve`, {
      method: "POST",
      body: {}
    });
    assert.equal(approval.response.status, 200);
    assert.equal(approval.body.data.timeEntry.status, "approved");

    const generated = await request("/api/payroll-periods", {
      method: "POST",
      body: { startsOn: "2026-07-20" }
    });
    assert.equal(generated.response.status, 201, JSON.stringify(generated.body));
    const period = generated.body.data.payrollPeriod;
    assert.equal(period.endsOn, "2026-08-02");
    assert.equal(period.status, "review");
    assert.equal(period.lines.length, 4);
    assert.equal(period.dayEntries.length, 0);
    assert.ok(period.lines.every((line) => line.regularMinutes === 0));
    assert.equal(
      period.lines.reduce((sum, line) => sum + line.tipsCents, 0),
      1001
    );

    const revisedTip = await request(
      `/api/bookings/${ids.bookingA}/tips/${tip.body.data.tip.id}`,
      {
        method: "PATCH",
        body: { amountCents: 1201, source: "manager" }
      }
    );
    assert.equal(revisedTip.response.status, 200, JSON.stringify(revisedTip.body));
    const tipRecalculated = await request(`/api/payroll-periods/${period.id}`);
    assert.equal(
      tipRecalculated.body.data.payrollPeriod.lines.reduce(
        (sum, line) => sum + line.tipsCents,
        0
      ),
      1201
    );
    const restoredTip = await request(
      `/api/bookings/${ids.bookingA}/tips/${tip.body.data.tip.id}`,
      {
        method: "PATCH",
        body: { amountCents: 1001, source: "customer" }
      }
    );
    assert.equal(restoredTip.response.status, 200);

    const captainDay = await request(`/api/payroll-periods/${period.id}/days`, {
      method: "POST",
      body: {
        employeeId: ids.employeeA1,
        workDate: "2026-07-20",
        checkInTime: "08:00",
        checkOutTime: "17:00",
        tipsCents: 0
      }
    });
    assert.equal(captainDay.response.status, 200, JSON.stringify(captainDay.body));
    let current = captainDay.body.data.payrollPeriod;
    let captain = current.lines.find(
      (line) => line.employeeId === ids.employeeA1 && line.weekStartsOn === "2026-07-20"
    );
    assert.equal(captain.regularMinutes, 540);
    assert.equal(captain.tipsCents, serviceTipByEmployee.get(ids.employeeA1));
    assert.equal(captain.captainDays, 1);
    assert.equal(captain.captainReimbursementCents, 1600);
    assert.equal(
      captain.grossWagesCents,
      19600 + serviceTipByEmployee.get(ids.employeeA1)
    );

    const cleanerDay = await request(`/api/payroll-periods/${period.id}/days`, {
      method: "POST",
      body: {
        employeeId: ids.employeeA2,
        workDate: "2026-07-20",
        checkInTime: "08:30",
        checkOutTime: "16:30",
        tipsCents: 500
      }
    });
    assert.equal(cleanerDay.response.status, 200, JSON.stringify(cleanerDay.body));
    const cleanerEntry = cleanerDay.body.data.payrollPeriod.dayEntries.find(
      ({ employeeId }) => employeeId === ids.employeeA2
    );
    const removed = await request(
      `/api/payroll-periods/${period.id}/days/${cleanerEntry.id}`,
      { method: "DELETE" }
    );
    assert.equal(removed.response.status, 200, JSON.stringify(removed.body));
    assert.equal(removed.body.data.payrollPeriod.dayEntries.length, 1);
    const restored = await request(`/api/payroll-periods/${period.id}/days`, {
      method: "POST",
      body: {
        employeeId: ids.employeeA2,
        workDate: "2026-07-20",
        checkInTime: "08:30",
        checkOutTime: "16:30",
        tipsCents: 500
      }
    });
    assert.equal(restored.response.status, 200);

    const secondWeek = await request(`/api/payroll-periods/${period.id}/days`, {
      method: "POST",
      body: {
        employeeId: ids.employeeA1,
        workDate: "2026-07-28",
        checkInTime: "08:00",
        checkOutTime: "13:00",
        tipsCents: 0
      }
    });
    assert.equal(secondWeek.response.status, 200, JSON.stringify(secondWeek.body));
    const revised = await request(`/api/payroll-periods/${period.id}/days`, {
      method: "POST",
      body: {
        employeeId: ids.employeeA1,
        workDate: "2026-07-20",
        checkInTime: "08:00",
        checkOutTime: "18:00",
        tipsCents: 0
      }
    });
    assert.equal(revised.response.status, 200, JSON.stringify(revised.body));
    current = revised.body.data.payrollPeriod;
    captain = current.lines.find(
      (line) => line.employeeId === ids.employeeA1 && line.weekStartsOn === "2026-07-20"
    );
    assert.equal(captain.regularMinutes, 600);
    assert.equal(
      captain.grossWagesCents,
      21600 + serviceTipByEmployee.get(ids.employeeA1)
    );

    const historyList = await request("/api/payroll-periods");
    assert.equal(historyList.response.status, 200);
    assert.deepEqual(
      historyList.body.data.payrollPeriods.map((item) => ({
        startsOn: item.startsOn,
        employeeCount: item.employeeCount,
        totalMinutes: item.totalMinutes,
        grossWagesCents: item.grossWagesCents
      })),
      [{
        startsOn: "2026-07-20",
        employeeCount: 2,
        totalMinutes: 1380,
        grossWagesCents: 49101
      }]
    );

    const approved = await request(`/api/payroll-periods/${period.id}/approve`, {
      method: "POST",
      body: {}
    });
    assert.equal(approved.response.status, 200);
    assert.equal(approved.body.data.payrollPeriod.status, "approved");

    const locked = await request(`/api/payroll-periods/${period.id}/days`, {
      method: "POST",
      body: {
        employeeId: ids.employeeA1,
        workDate: "2026-07-21",
        checkInTime: "08:00",
        checkOutTime: "09:00",
        tipsCents: 0
      }
    });
    assert.equal(locked.response.status, 409);
    assert.equal(locked.body.error.code, "payroll_locked");

    const firstExport = await request(`/api/payroll-periods/${period.id}/exports`, {
      method: "POST",
      body: {}
    });
    const secondExport = await request(`/api/payroll-periods/${period.id}/exports`, {
      method: "POST",
      body: {}
    });
    assert.equal(firstExport.response.status, 201, JSON.stringify(firstExport.body));
    assert.equal(secondExport.response.status, 201, JSON.stringify(secondExport.body));
    assert.equal(firstExport.body.data.payrollExport.version, 1);
    assert.equal(secondExport.body.data.payrollExport.version, 2);
    assert.deepEqual(
      firstExport.body.data.payrollExport.rows,
      secondExport.body.data.payrollExport.rows
    );
    assert.equal(firstExport.body.data.payrollExport.rows.length, 2);
    assert.equal(
      firstExport.body.data.payrollExport.columns.length,
      firstExport.body.data.payrollExport.rows[0].length
    );

    const history = await pool.query(
      "SELECT before_data, after_data, reason FROM time_corrections WHERE time_entry_id = $1",
      [ids.timeA1]
    );
    assert.equal(history.rowCount, 1);
    assert.equal(history.rows[0].reason, "Manager confirmed travel and service time");

    const duplicate = await request("/api/payroll-periods", {
      method: "POST",
      body: { startsOn: "2026-07-20" }
    });
    assert.equal(duplicate.response.status, 409);
  });

  it("enforces validation, manager permissions, and organization isolation", async () => {
    const { ids, request } = await fixture();
    const denied = await request(`/api/customers/${ids.customerA}/ledger`, {
      role: "cleaner",
      userId: ids.cleanerA
    });
    assert.equal(denied.response.status, 403);

    const unauthenticated = await request(`/api/customers/${ids.customerA}/ledger`, {
      role: null
    });
    assert.equal(unauthenticated.response.status, 401);

    const hiddenCustomer = await request(`/api/customers/${ids.customerB}/ledger`);
    assert.equal(hiddenCustomer.response.status, 404);
    const hiddenTime = await request(`/api/time-entries/${ids.timeB}/approve`, {
      method: "POST",
      body: {}
    });
    assert.equal(hiddenTime.response.status, 404);
    const hiddenTip = await request(`/api/bookings/${ids.bookingB}/tips`, {
      method: "POST",
      body: { amountCents: 1000, source: "manager" }
    });
    assert.equal(hiddenTip.response.status, 404);

    const nonMonday = await request("/api/payroll-periods", {
      method: "POST",
      body: { startsOn: "2026-07-21" }
    });
    assert.equal(nonMonday.response.status, 400);
    assert.equal(nonMonday.body.error.code, "invalid_pay_period");

    const emptyPeriod = await request("/api/payroll-periods", {
      method: "POST",
      body: { startsOn: "2026-07-20" }
    });
    assert.equal(emptyPeriod.response.status, 201, JSON.stringify(emptyPeriod.body));
    const periodId = emptyPeriod.body.data.payrollPeriod.id;
    const emptyApproval = await request(`/api/payroll-periods/${periodId}/approve`, {
      method: "POST",
      body: {}
    });
    assert.equal(emptyApproval.response.status, 409);
    assert.equal(emptyApproval.body.error.code, "no_payroll_hours");

    const invalidRange = await request(`/api/payroll-periods/${periodId}/days`, {
      method: "POST",
      body: {
        employeeId: ids.employeeA1,
        workDate: "2026-07-20",
        checkInTime: "17:00",
        checkOutTime: "08:00",
        tipsCents: 0
      }
    });
    assert.equal(invalidRange.response.status, 400);
    assert.equal(invalidRange.body.error.code, "invalid_time_range");

    const saturday = await request(`/api/payroll-periods/${periodId}/days`, {
      method: "POST",
      body: {
        employeeId: ids.employeeA1,
        workDate: "2026-07-25",
        checkInTime: "08:00",
        checkOutTime: "12:00",
        tipsCents: 0
      }
    });
    assert.equal(saturday.response.status, 200);
    const sunday = await request(`/api/payroll-periods/${periodId}/days`, {
      method: "POST",
      body: {
        employeeId: ids.employeeA1,
        workDate: "2026-07-26",
        checkInTime: "08:00",
        checkOutTime: "12:00",
        tipsCents: 0
      }
    });
    assert.equal(sunday.response.status, 400);
    assert.equal(sunday.body.error.code, "invalid_work_date");

    const foreignEmployee = await request(`/api/payroll-periods/${periodId}/days`, {
      method: "POST",
      body: {
        employeeId: ids.employeeB,
        workDate: "2026-07-20",
        checkInTime: "08:00",
        checkOutTime: "12:00",
        tipsCents: 0
      }
    });
    assert.equal(foreignEmployee.response.status, 404);

    const invalidCorrection = await request(`/api/time-entries/${ids.timeA1}/corrections`, {
      method: "POST",
      body: { reason: "No actual change" }
    });
    assert.equal(invalidCorrection.response.status, 400);
    assert.equal(invalidCorrection.body.error.code, "validation_error");
  });
});
