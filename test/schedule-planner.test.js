import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { afterEach, describe, it } from "node:test";
import { requireRole } from "../src/server/auth.js";
import { errorHandler, notFound } from "../src/server/http.js";
import { createSalesRouter } from "../src/server/sales.js";
import { createScheduleRouter } from "../src/server/schedule-planner.js";
import { testPool } from "./helpers.js";

const cleanups = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

function ids(...names) {
  return Object.fromEntries(names.map((name) => [name, crypto.randomUUID()]));
}

async function fixture(role = "manager") {
  const pool = await testPool();
  const id = ids(
    "organizationA", "organizationB", "managerA", "managerB", "cleanerUser",
    "captain", "cleaner", "foreignEmployee", "teamA", "teamB", "inactiveTeam",
    "foreignTeam", "weeklyCustomer", "biweeklyCustomer", "threeWeekCustomer",
    "monthlyCustomer", "nthCustomer", "foreignCustomer", "weeklyProperty",
    "biweeklyProperty", "threeWeekProperty", "monthlyProperty", "nthProperty",
    "foreignProperty", "serviceType", "foreignServiceType", "weeklyService",
    "biweeklyService", "threeWeekService", "monthlyService", "nthService",
    "pausedService", "foreignRecurringService"
  );

  await pool.query(
    `INSERT INTO organizations (id, name)
     VALUES ($1, 'Queen City Maid'), ($2, 'Other Cleaning')`,
    [id.organizationA, id.organizationB]
  );
  await pool.query(
    `INSERT INTO business_settings
     (organization_id, late_cancellation_fee_cents)
     VALUES ($1, 5000), ($2, 5000)`,
    [id.organizationA, id.organizationB]
  );
  await pool.query(
    `INSERT INTO users (id, organization_id, email, name, role, password_hash)
     VALUES
       ($1, $2, 'manager@qcm.test', 'Queen City Manager', 'manager', 'hash'),
       ($3, $4, 'manager@other.test', 'Other Manager', 'manager', 'hash'),
       ($5, $2, 'cleaner@qcm.test', 'Crew Member', 'cleaner', 'hash')`,
    [
      id.managerA, id.organizationA, id.managerB, id.organizationB,
      id.cleanerUser
    ]
  );
  await pool.query(
    `INSERT INTO employees
     (id, organization_id, user_id, first_name, last_name, phone,
      hourly_rate_cents, can_drive)
     VALUES
       ($1, $2, NULL, 'Angela', 'Brooks', '7045551000', 1900, true),
       ($3, $2, $4, 'Maya', 'Collins', '7045551001', 1750, false),
       ($5, $6, NULL, 'Foreign', 'Cleaner', '9805551000', 1800, true)`,
    [
      id.captain, id.organizationA, id.cleaner, id.cleanerUser,
      id.foreignEmployee, id.organizationB
    ]
  );
  await pool.query(
    `INSERT INTO teams (id, organization_id, name, active)
     VALUES
       ($1, $2, 'Crown Crew', true),
       ($3, $2, 'Uptown Crew', true),
       ($4, $2, 'Retired Crew', false),
       ($5, $6, 'Foreign Crew', true)`,
    [
      id.teamA, id.organizationA, id.teamB, id.inactiveTeam,
      id.foreignTeam, id.organizationB
    ]
  );
  await pool.query(
    `INSERT INTO team_members
     (team_id, employee_id, is_captain, effective_from)
     VALUES
       ($1, $2, true, '2037-01-01'),
       ($1, $3, false, '2037-01-01'),
       ($4, $2, true, '2037-01-01'),
       ($4, $3, false, '2037-01-01'),
       ($5, $6, true, '2037-01-01')`,
    [
      id.teamA, id.captain, id.cleaner, id.teamB,
      id.foreignTeam, id.foreignEmployee
    ]
  );

  const customers = [
    [id.weeklyCustomer, id.organizationA, "Alice Weekly", "7045552000", "weekly", "check"],
    [id.biweeklyCustomer, id.organizationA, "Bailey Biweekly", "7045552001", "biweekly", "venmo"],
    [id.threeWeekCustomer, id.organizationA, "Casey Three Week", "7045552002", "other", "zelle"],
    [id.monthlyCustomer, id.organizationA, "Dana Monthly", "7045552003", "monthly", "cash"],
    [id.nthCustomer, id.organizationA, "Evan Second Tuesday", "7045552004", "monthly", "paypal"],
    [id.foreignCustomer, id.organizationB, "Foreign Customer", "9805552000", "weekly", "cash"]
  ];
  for (const customer of customers) {
    await pool.query(
      `INSERT INTO customers
       (id, organization_id, type, name, phone, service_frequency, payment_method)
       VALUES ($1, $2, 'residential', $3, $4, $5, $6)`,
      customer
    );
  }

  const properties = [
    [id.weeklyProperty, id.organizationA, id.weeklyCustomer, "100 Tryon St"],
    [id.biweeklyProperty, id.organizationA, id.biweeklyCustomer, "200 Trade St"],
    [id.threeWeekProperty, id.organizationA, id.threeWeekCustomer, "300 Church St"],
    [id.monthlyProperty, id.organizationA, id.monthlyCustomer, "400 College St"],
    [id.nthProperty, id.organizationA, id.nthCustomer, "500 Queens Rd"],
    [id.foreignProperty, id.organizationB, id.foreignCustomer, "600 Hidden Rd"]
  ];
  for (const property of properties) {
    await pool.query(
      `INSERT INTO properties
       (id, organization_id, customer_id, address_line1, city, state, postal_code)
       VALUES ($1, $2, $3, $4, 'Charlotte', 'NC', '28202')`,
      property
    );
  }
  await pool.query(
    `INSERT INTO service_types
     (id, organization_id, name, category, default_duration_minutes)
     VALUES
       ($1, $2, 'Regular Cleaning', 'residential', 150),
       ($3, $4, 'Foreign Cleaning', 'residential', 120)`,
    [id.serviceType, id.organizationA, id.foreignServiceType, id.organizationB]
  );

  const recurring = [
    [
      id.weeklyService, id.organizationA, id.weeklyCustomer, id.weeklyProperty,
      id.serviceType, id.teamA, "active", { type: "weekly", intervalWeeks: 1 },
      "08:00", 150, 22000, "2037-07-27", "flat", 22000,
      "Use the side entrance"
    ],
    [
      id.biweeklyService, id.organizationA, id.biweeklyCustomer, id.biweeklyProperty,
      id.serviceType, id.teamB, "active", { type: "weekly", intervalWeeks: 2 },
      "10:30", 180, 0, "2037-07-27", "hourly", 9900,
      "Call before arrival"
    ],
    [
      id.threeWeekService, id.organizationA, id.threeWeekCustomer, id.threeWeekProperty,
      id.serviceType, id.teamA, "active", { type: "weekly", intervalWeeks: 3 },
      "13:00", 150, 24000, "2037-07-20", "flat", 24000,
      "Gate code is 2468"
    ],
    [
      id.monthlyService, id.organizationA, id.monthlyCustomer, id.monthlyProperty,
      id.serviceType, id.teamA, "active", { type: "monthly", dayOfMonth: 15 },
      "15:00", 180, 26000, "2037-07-15", "flat", 26000, ""
    ],
    [
      id.nthService, id.organizationA, id.nthCustomer, id.nthProperty,
      id.serviceType, id.teamB, "active",
      { type: "nth_weekday", weekday: 2, occurrence: 2 },
      "08:00", 120, 20000, "2037-07-01", "flat", 20000, ""
    ],
    [
      id.pausedService, id.organizationA, id.weeklyCustomer, id.weeklyProperty,
      id.serviceType, id.teamA, "paused", { type: "weekly", intervalWeeks: 1 },
      "15:00", 60, 10000, "2037-07-27", "flat", 10000, ""
    ],
    [
      id.foreignRecurringService, id.organizationB, id.foreignCustomer,
      id.foreignProperty, id.foreignServiceType, id.foreignTeam, "active",
      { type: "weekly", intervalWeeks: 1 }, "08:00", 120, 19000,
      "2037-07-27", "flat", 19000, ""
    ]
  ];
  for (const service of recurring) {
    await pool.query(
      `INSERT INTO recurring_services
       (id, organization_id, customer_id, property_id, service_type_id,
        preferred_team_id, status, recurrence_rule, preferred_start_time,
        expected_duration_minutes, price_cents, starts_on, billing_type,
        billing_rate_cents, special_instructions)
       VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [...service.slice(0, 7), JSON.stringify(service[7]), ...service.slice(8)]
    );
  }

  const auth = {
    id: role === "manager" ? id.managerA : id.cleanerUser,
    organizationId: id.organizationA,
    role
  };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.auth = auth;
    next();
  });
  app.use("/api", requireRole("manager"), createScheduleRouter({ pool }));
  app.use("/api", requireRole("manager"), createSalesRouter({ pool }));
  app.use(notFound);
  app.use(errorHandler);

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  cleanups.push(() => new Promise((resolve) => server.close(resolve)), () => pool.end());
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { body, ...options } = {}) {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(options.headers || {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { response, body: await response.json() };
  }
  return { pool, id, request };
}

async function sync(request) {
  return request("/api/schedule-planner/sync", {
    method: "POST",
    body: { reference: "2037-07-27" }
  });
}

function allBookings(planner) {
  return planner.days.flatMap((day) => day.bookings);
}

function ymd(value) {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

describe("schedule planner API", () => {
  it("syncs weekly and biweekly work into A/B weeks once and returns the joined plan", async () => {
    const { pool, id, request } = await fixture();

    const first = await sync(request);
    assert.equal(first.response.status, 201);
    assert.equal(first.body.data.createdCount, 3);
    const second = await sync(request);
    assert.equal(second.response.status, 200);
    assert.equal(second.body.data.createdCount, 0);

    const stored = await pool.query(
      `SELECT recurring_service_id AS "recurringServiceId",
              service_date AS "serviceDate"
       FROM bookings
       WHERE organization_id = $1
       ORDER BY service_date, recurring_service_id`,
      [id.organizationA]
    );
    assert.deepEqual(
      stored.rows.map((row) => [row.recurringServiceId, ymd(row.serviceDate)]),
      [
        [id.biweeklyService, "2037-07-27"],
        [id.weeklyService, "2037-07-27"],
        [id.weeklyService, "2037-08-03"]
      ].sort((left, right) => left.join().localeCompare(right.join())).sort((left, right) =>
        left[1].localeCompare(right[1]) || left[0].localeCompare(right[0])
      )
    );
    assert.ok(!stored.rows.some((row) => row.recurringServiceId === id.pausedService));
    assert.ok(!stored.rows.some((row) => row.recurringServiceId === id.foreignRecurringService));

    const result = await request("/api/schedule-planner?week=A&reference=2037-07-27");
    assert.equal(result.response.status, 200);
    const planner = result.body.data;
    assert.equal(planner.week, "A");
    assert.equal(planner.weekStart, "2037-07-27");
    assert.equal(planner.weekEnd, "2037-08-01");
    assert.deepEqual(
      planner.days.map((day) => [day.dayName, day.date]),
      [
        ["Monday", "2037-07-27"],
        ["Tuesday", "2037-07-28"],
        ["Wednesday", "2037-07-29"],
        ["Thursday", "2037-07-30"],
        ["Friday", "2037-07-31"],
        ["Saturday", "2037-08-01"]
      ]
    );
    assert.deepEqual(
      planner.teams.map((team) => team.name).sort(),
      ["Crown Crew", "Uptown Crew"]
    );

    const weekly = allBookings(planner).find((booking) =>
      booking.recurringServiceId === id.weeklyService
    );
    assert.deepEqual(
      {
        customerName: weekly.customerName,
        addressLine1: weekly.addressLine1,
        city: weekly.city,
        state: weekly.state,
        postalCode: weekly.postalCode,
        teamId: weekly.teamId,
        teamName: weekly.teamName,
        serviceTypeId: weekly.serviceTypeId,
        billingType: weekly.billingType,
        billingRateCents: weekly.billingRateCents,
        specialInstructions: weekly.specialInstructions,
        startTime: weekly.startTime
      },
      {
        customerName: "Alice Weekly",
        addressLine1: "100 Tryon St",
        city: "Charlotte",
        state: "NC",
        postalCode: "28202",
        teamId: id.teamA,
        teamName: "Crown Crew",
        serviceTypeId: id.serviceType,
        billingType: "flat",
        billingRateCents: 22000,
        specialInstructions: "Use the side entrance",
        startTime: "08:00"
      }
    );
    const hourly = allBookings(planner).find((booking) =>
      booking.recurringServiceId === id.biweeklyService
    );
    assert.equal(hourly.billingType, "hourly");
    assert.equal(hourly.billingRateCents, 9900);
  });

  it("moves upcoming bookings between crews and blocks but rejects invalid or completed moves", async () => {
    const { pool, id, request } = await fixture();
    await sync(request);
    const booking = await pool.query(
      `SELECT id FROM bookings
       WHERE organization_id = $1 AND recurring_service_id = $2 AND service_date = '2037-07-27'`,
      [id.organizationA, id.weeklyService]
    );
    const bookingId = booking.rows[0].id;

    const moved = await request(`/api/schedule-planner/bookings/${bookingId}/move`, {
      method: "POST",
      body: { teamId: id.teamB, date: "2037-07-28", startTime: "10:30" }
    });
    assert.equal(moved.response.status, 200, JSON.stringify(moved.body));
    assert.deepEqual(
      {
        id: moved.body.data.booking.id,
        teamId: moved.body.data.booking.teamId,
        serviceDate: moved.body.data.booking.serviceDate,
        startTime: moved.body.data.booking.startTime
      },
      {
        id: bookingId,
        teamId: id.teamB,
        serviceDate: "2037-07-28",
        startTime: "10:30"
      }
    );
    const route = await pool.query(
      `SELECT r.team_id AS "teamId", r.service_date AS "serviceDate"
       FROM route_stops rs
       JOIN routes r ON r.id = rs.route_id
       WHERE rs.booking_id = $1`,
      [bookingId]
    );
    assert.deepEqual(
      route.rows.map((row) => ({ ...row, serviceDate: ymd(row.serviceDate) })),
      [{ teamId: id.teamB, serviceDate: "2037-07-28" }]
    );

    const biweekly = await pool.query(
      `SELECT id FROM bookings
       WHERE organization_id = $1 AND recurring_service_id = $2`,
      [id.organizationA, id.biweeklyService]
    );
    const conflict = await request(
      `/api/schedule-planner/bookings/${biweekly.rows[0].id}/move`,
      {
        method: "POST",
        body: { teamId: id.teamB, date: "2037-07-28", startTime: "10:30" }
      }
    );
    assert.equal(conflict.response.status, 409);
    assert.equal(conflict.body.error.code, "schedule_conflict");

    const invalidBlock = await request(`/api/schedule-planner/bookings/${bookingId}/move`, {
      method: "POST",
      body: { teamId: id.teamA, date: "2037-07-29", startTime: "09:00" }
    });
    assert.equal(invalidBlock.response.status, 400);
    assert.equal(invalidBlock.body.error.code, "validation_error");

    await pool.query(
      "UPDATE bookings SET service_date = '2026-07-25', status = 'confirmed' WHERE id = $1",
      [bookingId]
    );
    const past = await request(`/api/schedule-planner/bookings/${bookingId}/move`, {
      method: "POST",
      body: { teamId: id.teamA, date: "2037-07-29", startTime: "13:00" }
    });
    assert.equal(past.response.status, 409);
    assert.equal(past.body.error.code, "invalid_state");

    await pool.query(
      `UPDATE bookings SET service_date = '2037-07-28', status = 'completed',
              completed_at = now()
       WHERE id = $1`,
      [bookingId]
    );
    const completed = await request(`/api/schedule-planner/bookings/${bookingId}/move`, {
      method: "POST",
      body: { teamId: id.teamA, date: "2037-07-29", startTime: "13:00" }
    });
    assert.equal(completed.response.status, 409);
    assert.equal(completed.body.error.code, "invalid_state");
  });

  it("creates and assigns a booking atomically when a crew block is available", async () => {
    const { pool, id, request } = await fixture();
    await sync(request);
    const body = {
      customerId: id.threeWeekCustomer,
      propertyId: id.threeWeekProperty,
      serviceTypeId: id.serviceType,
      status: "confirmed",
      scheduledStart: "2037-07-27T19:00:00.000Z",
      expectedDurationMinutes: 150,
      priceCents: 25000,
      billingType: "flat",
      billingRateCents: null,
      specialRequests: "Atomic planner booking",
      serviceDate: "2037-07-27",
      startTime: "15:00",
      teamId: id.teamA
    };
    const created = await request("/api/bookings", { method: "POST", body });
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.data.booking.status, "assigned");

    const assigned = await pool.query(
      `SELECT r.team_id AS "teamId", r.status AS "routeStatus"
       FROM route_stops rs
       JOIN routes r ON r.id = rs.route_id
       WHERE rs.booking_id = $1`,
      [created.body.data.booking.id]
    );
    assert.deepEqual(assigned.rows, [{ teamId: id.teamA, routeStatus: "draft" }]);

    const conflict = await request("/api/bookings", {
      method: "POST",
      body: {
        ...body,
        specialRequests: "Must roll back",
        teamId: id.teamB,
        startTime: "10:30",
        scheduledStart: "2037-07-27T14:30:00.000Z"
      }
    });
    assert.equal(conflict.response.status, 409);
    assert.equal(conflict.body.error.code, "schedule_conflict");
    const partial = await pool.query(
      `SELECT id FROM bookings
       WHERE organization_id = $1 AND special_requests = 'Must roll back'`,
      [id.organizationA]
    );
    assert.equal(partial.rowCount, 0);
  });

  it("moves a recurring visit and every eligible future visit in one update", async () => {
    const { pool, id, request } = await fixture();
    await sync(request);
    const bookings = await pool.query(
      `SELECT id FROM bookings
       WHERE organization_id = $1 AND recurring_service_id = $2
       ORDER BY recurrence_due_date`,
      [id.organizationA, id.weeklyService]
    );
    const selectedId = bookings.rows[0].id;

    const updated = await request(`/api/bookings/${selectedId}`, {
      method: "PATCH",
      body: {
        updateScope: "future",
        serviceDate: "2037-07-29",
        startTime: "13:00",
        teamId: id.teamB,
        serviceTypeId: id.serviceType,
        expectedDurationMinutes: 210,
        priceCents: 27500,
        billingType: "flat",
        billingRateCents: null,
        specialRequests: "Use the rear entrance"
      }
    });
    assert.equal(updated.response.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.data.scheduleUpdate.updateScope, "future");
    assert.equal(updated.body.data.scheduleUpdate.bookingsMoved, bookings.rowCount);

    const recurring = await pool.query(
      `SELECT starts_on AS "startsOn", recurrence_rule AS "recurrenceRule",
              preferred_team_id AS "preferredTeamId",
              preferred_start_time AS "preferredStartTime"
       FROM recurring_services WHERE id = $1`,
      [id.weeklyService]
    );
    assert.equal(ymd(recurring.rows[0].startsOn), "2037-07-29");
    assert.deepEqual(recurring.rows[0].recurrenceRule, {
      type: "weekly",
      intervalWeeks: 1
    });
    assert.equal(recurring.rows[0].preferredTeamId, id.teamB);
    assert.equal(String(recurring.rows[0].preferredStartTime).slice(0, 5), "13:00");

    const moved = await pool.query(
      `SELECT recurrence_due_date AS "dueDate", service_date AS "serviceDate",
              expected_duration_minutes AS "duration", price_cents AS "priceCents"
       FROM bookings
       WHERE organization_id = $1 AND recurring_service_id = $2
       ORDER BY recurrence_due_date`,
      [id.organizationA, id.weeklyService]
    );
    assert.deepEqual(
      moved.rows.map((booking) => ({
        dueDate: ymd(booking.dueDate),
        serviceDate: ymd(booking.serviceDate),
        duration: booking.duration,
        priceCents: booking.priceCents
      })),
      [
        {
          dueDate: "2037-07-29",
          serviceDate: "2037-07-29",
          duration: 210,
          priceCents: 27500
        },
        {
          dueDate: "2037-08-05",
          serviceDate: "2037-08-05",
          duration: 210,
          priceCents: 27500
        }
      ]
    );
  });

  it("creates, lists, and advances a service with multiple individual dates", async () => {
    const { pool, id, request } = await fixture();
    const created = await request("/api/recurring-services", {
      method: "POST",
      body: {
        customerId: id.threeWeekCustomer,
        propertyId: id.threeWeekProperty,
        serviceTypeId: id.serviceType,
        preferredTeamId: id.teamA,
        status: "active",
        recurrenceRule: {
          type: "dates",
          dates: ["2037-08-04", "2037-08-19", "2037-09-03"]
        },
        preferredStartTime: "10:30",
        expectedDurationMinutes: 150,
        priceCents: 24500,
        billingType: "flat",
        billingRateCents: null,
        specialInstructions: "Individual date service",
        startsOn: "2037-08-04"
      }
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    assert.deepEqual(created.body.data.nextDates, [
      "2037-08-04",
      "2037-08-19",
      "2037-09-03"
    ]);
    const recurringId = created.body.data.recurringService.id;

    const others = await request("/api/schedule-planner/others?reference=2037-07-27");
    const service = others.body.data.services.find((item) => item.id === recurringId);
    assert.equal(service.nextServiceDate, "2037-08-04");
    assert.equal(service.week, "B");

    const placed = await request(`/api/schedule-planner/others/${recurringId}/place`, {
      method: "POST",
      body: {
        reference: "2037-08-04",
        week: "B",
        teamId: id.teamA,
        startTime: "10:30"
      }
    });
    assert.equal(placed.response.status, 201, JSON.stringify(placed.body));
    assert.equal(placed.body.data.booking.recurrenceDueDate, "2037-08-04");

    const next = await request("/api/schedule-planner/others?reference=2037-08-05");
    const advanced = next.body.data.services.find((item) => item.id === recurringId);
    assert.equal(advanced.nextServiceDate, "2037-08-19");

    const customer = await pool.query(
      "SELECT service_frequency FROM customers WHERE id = $1",
      [id.threeWeekCustomer]
    );
    assert.equal(customer.rows[0].service_frequency, "other");
  });

  it("cancels one visit while keeping its recurring service active", async () => {
    const { pool, id, request } = await fixture();
    await sync(request);
    const booking = await pool.query(
      `SELECT id FROM bookings
       WHERE organization_id = $1 AND recurring_service_id = $2
       ORDER BY service_date LIMIT 1`,
      [id.organizationA, id.weeklyService]
    );
    const bookingId = booking.rows[0].id;
    const notificationId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO notifications
       (id, organization_id, customer_id, booking_id, type, channel,
        destination, body, status, idempotency_key, due_at)
       VALUES ($1, $2, $3, $4, 'booking_reminder', 'sms',
               '7045552000', 'Reminder', 'queued', $5, now())`,
      [
        notificationId, id.organizationA, id.weeklyCustomer,
        bookingId, `cancel-${bookingId}`
      ]
    );

    const cancelled = await request(
      `/api/schedule-planner/bookings/${bookingId}/cancel`,
      {
        method: "POST",
        body: { reason: "Customer is out of town", applyFee: true }
      }
    );
    assert.equal(cancelled.response.status, 200, JSON.stringify(cancelled.body));
    assert.equal(cancelled.body.data.booking.status, "cancelled");
    assert.equal(cancelled.body.data.booking.cancellationReason, "Customer is out of town");
    assert.equal(cancelled.body.data.cancellationFeeCents, 5000);
    assert.ok(cancelled.body.data.cancellationChargeId);

    const stored = await pool.query(
      `SELECT b.status, b.cancellation_reason AS "cancellationReason",
              rs.status AS "recurringStatus"
       FROM bookings b
       JOIN recurring_services rs ON rs.id = b.recurring_service_id
       WHERE b.id = $1`,
      [bookingId]
    );
    assert.deepEqual(stored.rows[0], {
      status: "cancelled",
      cancellationReason: "Customer is out of town",
      recurringStatus: "active"
    });
    const stops = await pool.query(
      "SELECT COUNT(*)::integer AS count FROM route_stops WHERE booking_id = $1",
      [bookingId]
    );
    assert.equal(stops.rows[0].count, 0);
    const notification = await pool.query(
      "SELECT status FROM notifications WHERE id = $1",
      [notificationId]
    );
    assert.equal(notification.rows[0].status, "cancelled");
    const charge = await pool.query(
      `SELECT type, amount_cents AS "amountCents", status
       FROM customer_charges WHERE booking_id = $1`,
      [bookingId]
    );
    assert.deepEqual(charge.rows, [{
      type: "cancellation_fee",
      amountCents: 5000,
      status: "unpaid"
    }]);

    const repeated = await request(
      `/api/schedule-planner/bookings/${bookingId}/cancel`,
      { method: "POST", body: { applyFee: true } }
    );
    assert.equal(repeated.response.status, 200);
    const charges = await pool.query(
      "SELECT COUNT(*)::integer AS count FROM customer_charges WHERE booking_id = $1",
      [bookingId]
    );
    assert.equal(charges.rows[0].count, 1);

    const plan = await request("/api/schedule-planner?week=A&reference=2037-07-27");
    assert.ok(!allBookings(plan.body.data).some(item => item.id === bookingId));

    const restored = await request(
      `/api/schedule-planner/bookings/${bookingId}/restore`,
      {
        method: "POST",
        body: { date: "2037-07-28", startTime: "10:30", teamId: null }
      }
    );
    assert.equal(restored.response.status, 200, JSON.stringify(restored.body));
    assert.equal(restored.body.data.booking.status, "confirmed");
    assert.equal(restored.body.data.booking.cancellationFeeWaived, true);
    const restoredRecords = await pool.query(
      `SELECT b.status, b.service_date AS "serviceDate",
              b.cancellation_reason AS "cancellationReason",
              c.status AS charge_status
       FROM bookings b
       JOIN customer_charges c ON c.booking_id = b.id AND c.type = 'cancellation_fee'
       WHERE b.id = $1`,
      [bookingId]
    );
    assert.equal(restoredRecords.rows[0].status, "confirmed");
    assert.equal(ymd(restoredRecords.rows[0].serviceDate), "2037-07-28");
    assert.equal(restoredRecords.rows[0].cancellationReason, null);
    assert.equal(restoredRecords.rows[0].charge_status, "waived");
    const repeatedRestore = await request(
      `/api/schedule-planner/bookings/${bookingId}/restore`,
      {
        method: "POST",
        body: { date: "2037-07-29", startTime: "10:30", teamId: null }
      }
    );
    assert.equal(repeatedRestore.response.status, 409);

    const biweekly = await pool.query(
      `SELECT id FROM bookings
       WHERE organization_id = $1 AND recurring_service_id = $2
       ORDER BY service_date LIMIT 1`,
      [id.organizationA, id.biweeklyService]
    );
    const noFee = await request(
      `/api/schedule-planner/bookings/${biweekly.rows[0].id}/cancel`,
      { method: "POST", body: { applyFee: false } }
    );
    assert.equal(noFee.response.status, 200);
    assert.equal(noFee.body.data.cancellationFeeCents, 0);
    assert.equal(noFee.body.data.cancellationChargeId, null);
  });

  it("keeps a Sunday fixed recurrence due date while placing service on Saturday", async () => {
    const { pool, id, request } = await fixture();
    const sundayService = crypto.randomUUID();
    await pool.query(
      `INSERT INTO recurring_services
       (id, organization_id, customer_id, property_id, service_type_id, status,
        recurrence_rule, preferred_start_time, expected_duration_minutes,
        price_cents, starts_on, billing_type)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, '08:00', 120, 19000,
               '2037-07-26', 'flat')`,
      [
        sundayService, id.organizationA, id.weeklyCustomer,
        id.weeklyProperty, id.serviceType,
        JSON.stringify({ type: "weekly", intervalWeeks: 1 })
      ]
    );
    const result = await request("/api/schedule-planner/sync", {
      method: "POST",
      body: { reference: "2037-07-20" }
    });
    assert.equal(result.response.status, 201);
    const occurrence = await pool.query(
      `SELECT service_date AS "serviceDate", recurrence_due_date AS "dueDate"
       FROM bookings
       WHERE recurring_service_id = $1
       ORDER BY recurrence_due_date
       LIMIT 1`,
      [sundayService]
    );
    assert.deepEqual(
      occurrence.rows.map((row) => ({
        serviceDate: ymd(row.serviceDate),
        dueDate: ymd(row.dueDate)
      })),
      [{ serviceDate: "2037-07-25", dueDate: "2037-07-26" }]
    );
  });

  it("calculates flexible recurrence dates and places one due occurrence into its A/B week", async () => {
    const { pool, id, request } = await fixture();

    const result = await request("/api/schedule-planner/others?reference=2037-07-27");
    assert.equal(result.response.status, 200);
    const services = result.body.data.services;
    assert.equal(services.length, 3);
    const byId = Object.fromEntries(services.map((service) => [service.id, service]));
    assert.deepEqual(
      {
        customerName: byId[id.threeWeekService].customerName,
        addressLine1: byId[id.threeWeekService].addressLine1,
        recurrenceRule: byId[id.threeWeekService].recurrenceRule,
        nextDueDate: byId[id.threeWeekService].nextDueDate,
        week: byId[id.threeWeekService].week
      },
      {
        customerName: "Casey Three Week",
        addressLine1: "300 Church St",
        recurrenceRule: { type: "weekly", intervalWeeks: 3 },
        nextDueDate: "2037-08-10",
        week: "A"
      }
    );
    assert.equal(byId[id.monthlyService].nextDueDate, "2037-08-15");
    assert.equal(byId[id.monthlyService].nextServiceDate, "2037-08-14");
    assert.equal(byId[id.nthService].nextDueDate, "2037-08-11");

    const dueWeek = await request(
      "/api/schedule-planner?week=A&reference=2037-08-10"
    );
    const monday = dueWeek.body.data.days.find((day) => day.date === "2037-08-10");
    assert.equal(monday.flexibleServices[0].id, id.threeWeekService);
    assert.equal(monday.flexibleServices[0].lastTeamName, null);

    const placed = await request(`/api/schedule-planner/others/${id.threeWeekService}/place`, {
      method: "POST",
      body: {
        reference: "2037-07-27",
        week: "A",
        teamId: id.teamA,
        startTime: "13:00"
      }
    });
    assert.equal(placed.response.status, 201);
    assert.equal(placed.body.data.booking.recurrenceDueDate, "2037-08-10");
    assert.equal(placed.body.data.booking.serviceDate, "2037-08-10");
    assert.equal(placed.body.data.booking.teamId, id.teamA);
    assert.equal(placed.body.data.nextDueDate, "2037-08-31");

    const occurrences = await pool.query(
      `SELECT recurrence_due_date AS "dueDate"
       FROM bookings
       WHERE organization_id = $1 AND recurring_service_id = $2`,
      [id.organizationA, id.threeWeekService]
    );
    assert.deepEqual(
      occurrences.rows.map((row) => ({ dueDate: ymd(row.dueDate) })),
      [{ dueDate: "2037-08-10" }]
    );
    const advanced = await request("/api/schedule-planner/others?reference=2037-07-27");
    assert.ok(!advanced.body.data.services.some((item) => item.id === id.threeWeekService));
    const afterService = await request("/api/schedule-planner/others?reference=2037-08-11");
    const service = afterService.body.data.services.find((item) => item.id === id.threeWeekService);
    assert.equal(service.nextDueDate, "2037-08-31");
    assert.equal(service.lastTeamName, "Crown Crew");
  });

  it("shows a manager-updated next date in the flexible schedule", async () => {
    const { id, request } = await fixture();

    const updated = await request(`/api/recurring-services/${id.threeWeekService}`, {
      method: "PATCH",
      body: {
        startsOn: "2037-07-30",
        recurrenceRule: { type: "weekly", intervalWeeks: 3 }
      }
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.data.nextDates[0], "2037-07-30");

    const others = await request("/api/schedule-planner/others?reference=2037-07-27");
    assert.equal(others.response.status, 200);
    const service = others.body.data.services.find((item) => item.id === id.threeWeekService);
    assert.equal(service.nextDueDate, "2037-07-30");
    assert.equal(service.nextServiceDate, "2037-07-30");
  });

  it("returns past services with the servicing team and employee names", async () => {
    const { pool, id, request } = await fixture();
    const history = ids("booking", "route", "stop");
    await pool.query(
      `INSERT INTO bookings
       (id, organization_id, customer_id, property_id, service_type_id, status,
        scheduled_start, service_date, expected_duration_minutes, actual_duration_minutes,
        price_cents, billing_type, billing_rate_cents, special_requests, completed_at)
       VALUES
       ($1, $2, $3, $4, $5, 'completed', '2026-07-20T12:00:00Z', '2026-07-20',
        150, 145, 22000, 'flat', 22000, 'Use the side entrance',
        '2026-07-20T14:25:00Z')`,
      [
        history.booking, id.organizationA, id.weeklyCustomer,
        id.weeklyProperty, id.serviceType
      ]
    );
    await pool.query(
      `INSERT INTO routes
       (id, organization_id, team_id, captain_employee_id, service_date, status)
       VALUES ($1, $2, $3, $4, '2026-07-20', 'completed')`,
      [history.route, id.organizationA, id.teamA, id.captain]
    );
    await pool.query(
      `INSERT INTO route_stops
       (id, organization_id, route_id, booking_id, stop_order)
       VALUES ($1, $2, $3, $4, 1)`,
      [history.stop, id.organizationA, history.route, history.booking]
    );
    await pool.query(
      `INSERT INTO job_assignments (booking_id, employee_id, role)
       VALUES ($1, $2, 'captain'), ($1, $3, 'cleaner')`,
      [history.booking, id.captain, id.cleaner]
    );

    const result = await request(
      "/api/schedule-planner/history?from=2026-07-01&to=2026-07-26"
    );
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.services.length, 1);
    const service = result.body.data.services[0];
    assert.equal(service.id, history.booking);
    assert.equal(service.serviceDate, "2026-07-20");
    assert.equal(service.customerName, "Alice Weekly");
    assert.equal(service.teamName, "Crown Crew");
    assert.deepEqual(service.employeeNames.sort(), ["Angela Brooks", "Maya Collins"]);
  });

  it("requires a manager and isolates every schedule operation by organization", async () => {
    const cleaner = await fixture("cleaner");
    const denied = await cleaner.request(
      "/api/schedule-planner?week=A&reference=2037-07-27"
    );
    assert.equal(denied.response.status, 403);
    assert.equal(denied.body.error.code, "forbidden");
    const cancelDenied = await cleaner.request(
      `/api/schedule-planner/bookings/${crypto.randomUUID()}/cancel`,
      { method: "POST", body: {} }
    );
    assert.equal(cancelDenied.response.status, 403);
    const restoreDenied = await cleaner.request(
      `/api/schedule-planner/bookings/${crypto.randomUUID()}/restore`,
      {
        method: "POST",
        body: { date: "2037-07-28", startTime: "08:00", teamId: null }
      }
    );
    assert.equal(restoreDenied.response.status, 403);

    const { pool, id, request } = await fixture();
    await sync(request);
    const planner = await request("/api/schedule-planner?week=A&reference=2037-07-27");
    assert.ok(!planner.body.data.teams.some((team) => team.id === id.foreignTeam));
    assert.ok(!allBookings(planner.body.data).some((booking) =>
      booking.customerName === "Foreign Customer"
    ));
    const others = await request("/api/schedule-planner/others?reference=2037-07-27");
    assert.ok(!others.body.data.services.some((service) =>
      service.id === id.foreignRecurringService
    ));

    const foreignBooking = ids("booking");
    await pool.query(
      `INSERT INTO bookings
       (id, organization_id, customer_id, property_id, service_type_id, status,
        scheduled_start, service_date, expected_duration_minutes, price_cents)
       VALUES
       ($1, $2, $3, $4, $5, 'confirmed', '2037-07-27T12:00:00Z',
        '2037-07-27', 120, 19000)`,
      [
        foreignBooking.booking, id.organizationB, id.foreignCustomer,
        id.foreignProperty, id.foreignServiceType
      ]
    );
    const hidden = await request(
      `/api/schedule-planner/bookings/${foreignBooking.booking}/move`,
      {
        method: "POST",
        body: { teamId: id.teamA, date: "2037-07-28", startTime: "08:00" }
      }
    );
    assert.equal(hidden.response.status, 404);
    assert.equal(hidden.body.error.code, "not_found");
    const cancelHidden = await request(
      `/api/schedule-planner/bookings/${foreignBooking.booking}/cancel`,
      { method: "POST", body: {} }
    );
    assert.equal(cancelHidden.response.status, 404);
    const restoreHidden = await request(
      `/api/schedule-planner/bookings/${foreignBooking.booking}/restore`,
      {
        method: "POST",
        body: { date: "2037-07-28", startTime: "08:00", teamId: null }
      }
    );
    assert.equal(restoreHidden.response.status, 404);
  });
});
