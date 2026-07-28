import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { recordAudit, requireRole } from "./auth.js";
import { recurrenceDates, zonedDateTime } from "./domain.js";
import { HttpError, asyncRoute, data, validate } from "./http.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const A_WEEK_ANCHOR = "2026-07-27";
const TIME_BLOCKS = ["08:00", "10:30", "13:00", "15:00"];
const uuid = z.string().uuid();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const weekKey = z.enum(["A", "B"]);
const block = z.enum(TIME_BLOCKS);

const plannerQuery = z.object({
  week: weekKey,
  reference: dateOnly.optional()
}).strict();

const syncInput = z.object({
  reference: dateOnly.optional()
}).strict();

const moveInput = z.object({
  teamId: uuid.nullable(),
  date: dateOnly,
  startTime: block,
  updateScope: z.enum(["single", "future"]).default("single")
}).strict();

const placeInput = z.object({
  week: weekKey,
  teamId: uuid,
  startTime: block,
  reference: dateOnly.optional()
}).strict();

const cancelInput = z.object({
  reason: z.string().trim().max(1000).optional().default(""),
  applyFee: z.boolean().default(false)
}).strict();
const restoreInput = z.object({
  date: dateOnly,
  startTime: block,
  teamId: uuid.nullable()
}).strict();

const historyQuery = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200)
}).strict();

function date(value) {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, "validation_error", "Invalid calendar date");
  }
  return parsed;
}

function isoDate(value) {
  return value.toISOString().slice(0, 10);
}

function databaseDate(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  return isoDate(new Date(value));
}

function localTime(value, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.hour}:${values.minute}`;
}

function todayInTimezone(timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(value, days) {
  return isoDate(new Date(date(value).getTime() + days * DAY_MS));
}

function nearestWeekday(value) {
  const weekday = date(value).getUTCDay();
  if (weekday === 6) return addDays(value, -1);
  if (weekday === 0) return addDays(value, 1);
  return value;
}

function mondayFor(value) {
  const current = date(value);
  const distance = (current.getUTCDay() + 6) % 7;
  return isoDate(new Date(current.getTime() - distance * DAY_MS));
}

function labelForWeek(monday) {
  const weeks = Math.round((date(monday) - date(A_WEEK_ANCHOR)) / (7 * DAY_MS));
  return ((weeks % 2) + 2) % 2 === 0 ? "A" : "B";
}

function weekFor(reference, key) {
  const current = mondayFor(reference);
  return labelForWeek(current) === key ? current : addDays(current, 7);
}

function referenceDate(value) {
  return value || new Date().toISOString().slice(0, 10);
}

function calendarDays(weekStart) {
  return Array.from({ length: 6 }, (_, index) => {
    const value = addDays(weekStart, index);
    return {
      date: value,
      name: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][index]
    };
  });
}

function rule(row) {
  return typeof row.recurrence_rule === "string"
    ? JSON.parse(row.recurrence_rule)
    : row.recurrence_rule;
}

function isAlternatingRule(value) {
  return value.type === "weekly" && [1, 2].includes(value.intervalWeeks);
}

function isOtherRule(value) {
  return !isAlternatingRule(value);
}

function occurrencesBetween(startsOn, recurrenceRule, from, to) {
  return recurrenceDates(startsOn, recurrenceRule, 500)
    .filter((value) => value >= from && value <= to);
}

function nextOccurrence(startsOn, recurrenceRule, reference, booked) {
  return recurrenceDates(startsOn, recurrenceRule, 500)
    .find((value) => value >= reference && !booked.has(value)) || null;
}

function nextFlexibleOccurrence(startsOn, recurrenceRule, reference, booked) {
  return recurrenceDates(startsOn, recurrenceRule, 500)
    .find((value) => nearestWeekday(value) >= reference && !booked.has(value)) || null;
}

function daysBetween(from, to) {
  return Math.round((date(to) - date(from)) / DAY_MS);
}

function recurringMovePlan(recurrenceRule, oldDueDate, newDate, count) {
  if (recurrenceRule.type === "dates") {
    const offset = daysBetween(oldDueDate, newDate);
    const dates = recurrenceRule.dates.map((value) =>
      value < oldDueDate ? value : addDays(value, offset)
    ).sort();
    if (new Set(dates).size !== dates.length) {
      throw new HttpError(
        409,
        "schedule_conflict",
        "Moving the series would create duplicate individual service dates"
      );
    }
    return {
      recurrenceRule: { type: "dates", dates },
      startsOn: dates[0],
      dates: dates.filter((value) => value >= newDate).slice(0, count)
    };
  }

  let nextRule = recurrenceRule;
  if (recurrenceRule.type === "monthly") {
    nextRule = { type: "monthly", dayOfMonth: date(newDate).getUTCDate() };
  }
  if (recurrenceRule.type === "nth_weekday") {
    const selected = date(newDate);
    nextRule = {
      type: "nth_weekday",
      weekday: selected.getUTCDay(),
      occurrence: Math.ceil(selected.getUTCDate() / 7)
    };
  }
  return {
    recurrenceRule: nextRule,
    startsOn: newDate,
    dates: recurrenceDates(newDate, nextRule, count)
  };
}

async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function timezone(client, organizationId) {
  const result = await client.query(
    "SELECT timezone FROM organizations WHERE id = $1",
    [organizationId]
  );
  return result.rows[0]?.timezone || "America/New_York";
}

async function activeTeam(client, organizationId, teamId, serviceDate) {
  const team = await client.query(
    `SELECT t.id, t.name, tm.employee_id AS "captainEmployeeId"
     FROM teams t
     LEFT JOIN team_members tm ON tm.team_id = t.id
       AND tm.is_captain = true
       AND tm.effective_from <= $3
       AND (tm.effective_to IS NULL OR tm.effective_to >= $3)
     WHERE t.id = $1 AND t.organization_id = $2 AND t.active = true
     LIMIT 1`,
    [teamId, organizationId, serviceDate]
  );
  if (!team.rowCount) throw new HttpError(404, "not_found", "Cleaning crew not found");
  if (!team.rows[0].captainEmployeeId) {
    throw new HttpError(409, "team_has_no_captain", "Cleaning crew needs an active captain");
  }

  const members = await client.query(
    `SELECT e.id
     FROM team_members tm
     JOIN employees e ON e.id = tm.employee_id
     WHERE tm.team_id = $1 AND e.organization_id = $2 AND e.active = true
       AND tm.effective_from <= $3
       AND (tm.effective_to IS NULL OR tm.effective_to >= $3)`,
    [teamId, organizationId, serviceDate]
  );
  if (!members.rowCount) {
    throw new HttpError(409, "team_has_no_members", "Cleaning crew has no active members");
  }
  const dayStart = zonedDateTime(
    serviceDate,
    "00:00",
    await timezone(client, organizationId)
  );
  const dayEnd = zonedDateTime(
    addDays(serviceDate, 1),
    "00:00",
    await timezone(client, organizationId)
  );
  const unavailable = await client.query(
    `SELECT e.first_name || ' ' || e.last_name AS name
     FROM availability_exceptions a
     JOIN employees e ON e.id = a.employee_id
     WHERE e.organization_id = $1 AND a.status = 'approved'
       AND a.employee_id IN (
         SELECT employee_id FROM team_members WHERE team_id = $2
       )
       AND a.starts_at < $4 AND a.ends_at > $3`,
    [organizationId, teamId, dayStart, dayEnd]
  );
  if (unavailable.rowCount) {
    throw new HttpError(409, "team_unavailable", "A crew member is unavailable", {
      employees: unavailable.rows.map((employee) => employee.name)
    });
  }
  return { ...team.rows[0], members: members.rows };
}

async function reorderRoute(client, routeId) {
  if (!routeId) return;
  const stops = await client.query(
    `SELECT rs.id
     FROM route_stops rs
     JOIN bookings b ON b.id = rs.booking_id
     WHERE rs.route_id = $1
     ORDER BY b.scheduled_start, rs.created_at, rs.id`,
    [routeId]
  );
  await client.query(
    "UPDATE route_stops SET stop_order = stop_order + 1000 WHERE route_id = $1",
    [routeId]
  );
  for (const [index, stop] of stops.rows.entries()) {
    await client.query(
      "UPDATE route_stops SET stop_order = $2 WHERE id = $1",
      [stop.id, index + 1]
    );
  }
}

export async function detachBooking(client, organizationId, bookingId) {
  const routes = await client.query(
    `SELECT route_id AS "routeId"
     FROM route_stops
     WHERE organization_id = $1 AND booking_id = $2`,
    [organizationId, bookingId]
  );
  await client.query(
    "DELETE FROM route_stops WHERE organization_id = $1 AND booking_id = $2",
    [organizationId, bookingId]
  );
  await client.query("DELETE FROM job_assignments WHERE booking_id = $1", [bookingId]);
  for (const item of routes.rows) {
    await reorderRoute(client, item.routeId);
    await client.query(
      `UPDATE routes SET status = 'draft', updated_at = now()
       WHERE id = $1 AND status = 'finalized'`,
      [item.routeId]
    );
  }
}

async function schedulePlacement({
  client,
  organizationId,
  teamId,
  serviceDate,
  scheduledStart,
  bookingId = null
}) {
  const team = await activeTeam(client, organizationId, teamId, serviceDate);
  const occupiedParams = [organizationId, teamId, serviceDate, scheduledStart];
  const excludeCurrent = bookingId ? "AND b.id <> $5" : "";
  if (bookingId) occupiedParams.push(bookingId);
  const occupied = await client.query(
    `SELECT 1
     FROM route_stops rs
     JOIN routes r ON r.id = rs.route_id
     JOIN bookings b ON b.id = rs.booking_id
     WHERE rs.organization_id = $1 AND r.team_id = $2
       AND r.service_date = $3 AND b.scheduled_start = $4
       ${excludeCurrent}
       AND b.status NOT IN ('cancelled', 'rescheduled', 'unable_to_complete')
     LIMIT 1`,
    occupiedParams
  );
  if (occupied.rowCount) {
    throw new HttpError(
      409,
      "schedule_conflict",
      "That crew already has a service in this time block"
    );
  }
  const route = await client.query(
    `SELECT id, status FROM routes
     WHERE organization_id = $1 AND team_id = $2 AND service_date = $3`,
    [organizationId, teamId, serviceDate]
  );
  if (route.rowCount && ["in_progress", "completed"].includes(route.rows[0].status)) {
    throw new HttpError(
      409,
      "route_locked",
      "Started or completed routes cannot accept another service"
    );
  }
  return { route, team };
}

export async function validateSchedulePlacement({
  client,
  organizationId,
  teamId,
  serviceDate,
  startTime
}) {
  const scheduledStart = zonedDateTime(
    serviceDate,
    startTime,
    await timezone(client, organizationId)
  );
  await schedulePlacement({
    client,
    organizationId,
    teamId,
    serviceDate,
    scheduledStart
  });
}

async function assignBooking(client, organizationId, bookingId, teamId, serviceDate) {
  const booking = await client.query(
    `SELECT scheduled_start, expected_duration_minutes
     FROM bookings WHERE id = $1 AND organization_id = $2`,
    [bookingId, organizationId]
  );
  let placement = null;
  if (teamId) {
    placement = await schedulePlacement({
      client,
      organizationId,
      teamId,
      serviceDate,
      scheduledStart: booking.rows[0].scheduled_start,
      bookingId
    });
  }
  await detachBooking(client, organizationId, bookingId);
  if (!teamId) {
    await client.query(
      `UPDATE bookings SET status = 'confirmed', updated_at = now()
       WHERE id = $1 AND organization_id = $2`,
      [bookingId, organizationId]
    );
    return null;
  }

  let { route } = placement;
  if (!route.rowCount) {
    route = await client.query(
      `INSERT INTO routes
       (id, organization_id, team_id, captain_employee_id, service_date, status)
       VALUES ($1, $2, $3, $4, $5, 'draft')
       RETURNING id`,
      [
        crypto.randomUUID(),
        organizationId,
        teamId,
        placement.team.captainEmployeeId,
        serviceDate
      ]
    );
  }
  const routeId = route.rows[0].id;
  await client.query(
    `UPDATE routes
     SET status = CASE WHEN status = 'finalized' THEN 'draft' ELSE status END,
         finalized_by = CASE WHEN status = 'finalized' THEN NULL ELSE finalized_by END,
         finalized_at = CASE WHEN status = 'finalized' THEN NULL ELSE finalized_at END,
         updated_at = now()
     WHERE id = $1`,
    [routeId]
  );
  const count = await client.query(
    "SELECT COUNT(*) AS count FROM route_stops WHERE route_id = $1",
    [routeId]
  );
  const arrival = booking.rows[0].scheduled_start;
  const departure = new Date(
    new Date(arrival).getTime() + Number(booking.rows[0].expected_duration_minutes) * 60_000
  );
  await client.query(
    `INSERT INTO route_stops
     (id, organization_id, route_id, booking_id, stop_order, estimated_arrival,
      estimated_departure, travel_minutes_from_previous)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 0)`,
    [
      crypto.randomUUID(), organizationId, routeId, bookingId,
      Number(count.rows[0].count) + 1, arrival, departure
    ]
  );
  for (const member of placement.team.members) {
    await client.query(
      `INSERT INTO job_assignments (booking_id, employee_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (booking_id, employee_id) DO UPDATE SET role = EXCLUDED.role`,
      [
        bookingId,
        member.id,
        member.id === placement.team.captainEmployeeId ? "captain" : "cleaner"
      ]
    );
  }
  await client.query(
    `UPDATE bookings SET status = 'assigned', updated_at = now()
     WHERE id = $1 AND organization_id = $2`,
    [bookingId, organizationId]
  );
  await reorderRoute(client, routeId);
  return routeId;
}

export async function moveBookingInTransaction({
  client,
  auth,
  bookingId,
  date: requestedDate,
  startTime: requestedStartTime,
  teamId: requestedTeamId,
  updateScope = "single"
}) {
  const current = await client.query(
    `SELECT b.*, r.team_id
     FROM bookings b
     LEFT JOIN route_stops rs ON rs.booking_id = b.id
     LEFT JOIN routes r ON r.id = rs.route_id
     WHERE b.id = $1 AND b.organization_id = $2`,
    [bookingId, auth.organizationId]
  );
  if (!current.rowCount) throw new HttpError(404, "not_found", "Booking not found");
  const before = current.rows[0];
  if (["in_progress", "completed"].includes(before.status)) {
    throw new HttpError(409, "invalid_state", "Started or completed service cannot be moved");
  }
  const organizationTimezone = await timezone(client, auth.organizationId);
  const beforeDate = databaseDate(before.service_date || before.scheduled_start);
  const today = todayInTimezone(organizationTimezone);
  if (beforeDate < today) {
    throw new HttpError(409, "invalid_state", "Past service cannot be moved");
  }
  const targetDate = requestedDate || beforeDate;
  const targetStartTime = requestedStartTime || localTime(
    before.scheduled_start,
    organizationTimezone
  );
  const targetTeamId = requestedTeamId !== undefined
    ? requestedTeamId
    : before.team_id || null;

  if (updateScope === "single") {
    const scheduledStart = zonedDateTime(targetDate, targetStartTime, organizationTimezone);
    await client.query(
      `UPDATE bookings
       SET scheduled_start = $3, service_date = $4, status = 'confirmed', updated_at = now()
       WHERE id = $1 AND organization_id = $2`,
      [bookingId, auth.organizationId, scheduledStart, targetDate]
    );
    const routeId = await assignBooking(
      client,
      auth.organizationId,
      bookingId,
      targetTeamId,
      targetDate
    );
    await recordAudit(client, auth, {
      entityType: "booking",
      entityId: bookingId,
      action: "schedule_move",
      before,
      after: {
        updateScope,
        date: targetDate,
        startTime: targetStartTime,
        teamId: targetTeamId,
        routeId
      }
    });
    return {
      id: bookingId,
      routeId,
      teamId: targetTeamId,
      serviceDate: targetDate,
      startTime: targetStartTime,
      updateScope,
      bookingsMoved: 1
    };
  }

  if (!before.recurring_service_id) {
    throw new HttpError(
      400,
      "validation_error",
      "This booking is not part of a recurring service"
    );
  }
  const recurringResult = await client.query(
    `SELECT * FROM recurring_services
     WHERE id = $1 AND organization_id = $2`,
    [before.recurring_service_id, auth.organizationId]
  );
  if (!recurringResult.rowCount) {
    throw new HttpError(404, "not_found", "Recurring service not found");
  }
  const recurring = recurringResult.rows[0];
  const oldDueDate = databaseDate(before.recurrence_due_date || beforeDate);
  const future = await client.query(
    `SELECT b.id, b.status, b.scheduled_start, b.recurrence_due_date,
            COALESCE(b.service_date, CAST(b.scheduled_start AS date)) AS service_date
     FROM bookings b
     WHERE b.organization_id = $1 AND b.recurring_service_id = $2
       AND b.status IN ('requested', 'confirmed', 'assigned')
       AND COALESCE(b.recurrence_due_date, b.service_date, CAST(b.scheduled_start AS date)) >= $3
     ORDER BY COALESCE(b.recurrence_due_date, b.service_date, CAST(b.scheduled_start AS date)),
              b.scheduled_start, b.id`,
    [auth.organizationId, before.recurring_service_id, oldDueDate]
  );
  if (!future.rows.some((booking) => booking.id === bookingId)) {
    throw new HttpError(
      409,
      "invalid_state",
      "Only upcoming recurring services can update future visits"
    );
  }
  const plan = recurringMovePlan(
    rule(recurring),
    oldDueDate,
    targetDate,
    future.rowCount
  );
  if (plan.dates.length < future.rowCount) {
    throw new HttpError(
      409,
      "invalid_schedule",
      "The recurring schedule does not contain enough future dates"
    );
  }
  if (plan.recurrenceRule.type === "nth_weekday") {
    const { occurrence, weekday } = plan.recurrenceRule;
    if (weekday === 0 || weekday === 6 || occurrence > 4) {
      throw new HttpError(
        400,
        "validation_error",
        "Monthly weekday services must use the first through fourth Monday-Friday"
      );
    }
  }

  await client.query(
    `UPDATE recurring_services
     SET recurrence_rule = $1, starts_on = $2, preferred_start_time = $3,
         preferred_team_id = $4, updated_at = now()
     WHERE id = $5 AND organization_id = $6`,
    [
      JSON.stringify(plan.recurrenceRule),
      plan.startsOn,
      targetStartTime,
      targetTeamId,
      recurring.id,
      auth.organizationId
    ]
  );
  for (const booking of future.rows) {
    await client.query(
      "UPDATE bookings SET recurrence_due_date = NULL WHERE id = $1",
      [booking.id]
    );
  }
  for (const [index, booking] of future.rows.entries()) {
    const dueDate = plan.dates[index];
    const serviceDate = nearestWeekday(dueDate);
    const scheduledStart = zonedDateTime(
      serviceDate,
      targetStartTime,
      organizationTimezone
    );
    await client.query(
      `UPDATE bookings
       SET scheduled_start = $2, service_date = $3, recurrence_due_date = $4,
           status = 'confirmed', updated_at = now()
       WHERE id = $1`,
      [booking.id, scheduledStart, serviceDate, dueDate]
    );
    await assignBooking(
      client,
      auth.organizationId,
      booking.id,
      targetTeamId,
      serviceDate
    );
  }
  await recordAudit(client, auth, {
    entityType: "recurringService",
    entityId: recurring.id,
    action: "schedule_move_future",
    before,
    after: {
      updateScope,
      startsOn: plan.startsOn,
      recurrenceRule: plan.recurrenceRule,
      startTime: targetStartTime,
      teamId: targetTeamId,
      bookingsMoved: future.rowCount
    }
  });
  return {
    id: bookingId,
    routeId: null,
    teamId: targetTeamId,
    serviceDate: nearestWeekday(plan.dates[0]),
    startTime: targetStartTime,
    updateScope,
    bookingsMoved: future.rowCount
  };
}

async function insertRecurringBooking(client, organizationId, recurring, dueDate, serviceDate, startTime) {
  const existing = await client.query(
    `SELECT id FROM bookings
     WHERE organization_id = $1 AND recurring_service_id = $2
       AND recurrence_due_date = $3
     LIMIT 1`,
    [organizationId, recurring.id, dueDate]
  );
  if (existing.rowCount) return null;
  const scheduledStart = zonedDateTime(
    serviceDate,
    startTime || String(recurring.preferred_start_time || "08:00").slice(0, 5),
    await timezone(client, organizationId)
  );
  const result = await client.query(
    `INSERT INTO bookings
     (id, organization_id, customer_id, property_id, service_type_id, quote_id,
      recurring_service_id, status, scheduled_start, service_date, recurrence_due_date,
      expected_duration_minutes, price_cents, billing_type, billing_rate_cents,
      special_requests)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed', $8, $9, $10, $11,
             $12, $13, $14, $15)
     ON CONFLICT (recurring_service_id, recurrence_due_date) DO NOTHING
     RETURNING id`,
    [
      crypto.randomUUID(), organizationId, recurring.customer_id, recurring.property_id,
      recurring.service_type_id, recurring.quote_id || null, recurring.id,
      scheduledStart, serviceDate, dueDate, recurring.expected_duration_minutes,
      recurring.price_cents, recurring.billing_type,
      recurring.billing_rate_cents ?? null, recurring.special_instructions || ""
    ]
  );
  return result.rows[0]?.id || null;
}

async function recurringRows(client, organizationId) {
  return (await client.query(
    `SELECT * FROM recurring_services
     WHERE organization_id = $1 AND status = 'active'
     ORDER BY starts_on, created_at`,
    [organizationId]
  )).rows;
}

async function flexibleServices(client, organizationId, reference) {
  const rows = await recurringRows(client, organizationId);
  const bookings = await client.query(
    `SELECT recurring_service_id AS "recurringServiceId",
            recurrence_due_date AS "dueDate",
            COALESCE(service_date, CAST(scheduled_start AS date)) AS "serviceDate",
            status
     FROM bookings
     WHERE organization_id = $1 AND recurring_service_id IS NOT NULL
       AND recurrence_due_date IS NOT NULL`,
    [organizationId]
  );
  const booked = new Map();
  const pending = new Set();
  for (const booking of bookings.rows) {
    if (!booked.has(booking.recurringServiceId)) {
      booked.set(booking.recurringServiceId, new Set());
    }
    booked.get(booking.recurringServiceId).add(databaseDate(booking.dueDate));
    if (databaseDate(booking.serviceDate) >= reference
      && !["cancelled", "rescheduled", "unable_to_complete"].includes(booking.status)) {
      pending.add(booking.recurringServiceId);
    }
  }
  const details = await client.query(
    `SELECT rs.id, c.name AS "customerName", c.internal_notes AS "internalNotes",
            p.address_line1 AS "addressLine1", p.address_line2 AS "addressLine2",
            p.city, p.postal_code AS "postalCode", st.name AS "serviceName",
            t.name AS "preferredTeamName"
     FROM recurring_services rs
     JOIN customers c ON c.id = rs.customer_id
     JOIN properties p ON p.id = rs.property_id
     JOIN service_types st ON st.id = rs.service_type_id
     LEFT JOIN teams t ON t.id = rs.preferred_team_id
     WHERE rs.organization_id = $1`,
    [organizationId]
  );
  const lastTeams = await client.query(
    `SELECT b.recurring_service_id AS "recurringServiceId",
            t.name AS "teamName",
            COALESCE(b.service_date, CAST(b.scheduled_start AS date)) AS "serviceDate"
     FROM bookings b
     JOIN route_stops rs ON rs.booking_id = b.id
     JOIN routes r ON r.id = rs.route_id
     JOIN teams t ON t.id = r.team_id
     WHERE b.organization_id = $1 AND b.recurring_service_id IS NOT NULL
       AND COALESCE(b.service_date, CAST(b.scheduled_start AS date)) < $2
       AND b.status NOT IN ('cancelled', 'rescheduled')
     ORDER BY COALESCE(b.service_date, CAST(b.scheduled_start AS date)) DESC,
              b.scheduled_start DESC`,
    [organizationId, reference]
  );
  const lastTeamMap = new Map();
  for (const item of lastTeams.rows) {
    if (!lastTeamMap.has(item.recurringServiceId)) {
      lastTeamMap.set(item.recurringServiceId, item.teamName);
    }
  }
  const detailMap = new Map(details.rows.map((item) => [item.id, item]));
  return rows
    .filter((item) => isOtherRule(rule(item)) && !pending.has(item.id))
    .map((item) => {
      const recurrenceRule = rule(item);
      const nextDueDate = nextFlexibleOccurrence(
        databaseDate(item.starts_on),
        recurrenceRule,
        reference,
        booked.get(item.id) || new Set()
      );
      const nextServiceDate = nextDueDate ? nearestWeekday(nextDueDate) : null;
      return {
        ...detailMap.get(item.id),
        id: item.id,
        recurrenceRule,
        nextDueDate,
        nextServiceDate,
        week: nextServiceDate ? labelForWeek(mondayFor(nextServiceDate)) : null,
        lastTeamName: lastTeamMap.get(item.id) || null,
        preferredTeamId: item.preferred_team_id,
        preferredStartTime: item.preferred_start_time,
        expectedDurationMinutes: item.expected_duration_minutes,
        priceCents: item.price_cents,
        billingType: item.billing_type,
        billingRateCents: item.billing_rate_cents,
        specialInstructions: item.special_instructions
      };
    });
}

async function syncAlternatingWeeks(pool, auth, reference) {
  return transaction(pool, async (client) => {
    const currentMonday = mondayFor(reference);
    const rangeStart = currentMonday;
    const rangeEnd = addDays(currentMonday, 13);
    let created = 0;
    for (const recurring of await recurringRows(client, auth.organizationId)) {
      const recurrenceRule = rule(recurring);
      if (!isAlternatingRule(recurrenceRule)) continue;
      for (const dueDate of occurrencesBetween(
        databaseDate(recurring.starts_on), recurrenceRule, rangeStart, rangeEnd
      )) {
        const serviceDate = date(dueDate).getUTCDay() === 0
          ? addDays(dueDate, -1)
          : dueDate;
        const bookingId = await insertRecurringBooking(
          client, auth.organizationId, recurring, dueDate, serviceDate
        );
        if (!bookingId) continue;
        created += 1;
        if (recurring.preferred_team_id) {
          try {
            await assignBooking(
              client, auth.organizationId, bookingId, recurring.preferred_team_id, serviceDate
            );
          } catch (error) {
            if (!(error instanceof HttpError)) throw error;
          }
        }
      }
    }
    return { created, rangeStart, rangeEnd };
  });
}

async function planner(pool, organizationId, key, reference) {
  const weekStart = weekFor(reference, key);
  const weekEnd = addDays(weekStart, 5);
  const [teams, bookings, organizationTimezone] = await Promise.all([
    pool.query(
      `SELECT id, name FROM teams
       WHERE organization_id = $1 AND active = true ORDER BY name`,
      [organizationId]
    ),
    pool.query(
      `SELECT b.id, b.status, b.scheduled_start AS "scheduledStart",
              COALESCE(b.service_date, CAST(b.scheduled_start AS date)) AS "serviceDate",
              b.expected_duration_minutes AS "expectedDurationMinutes",
              b.price_cents AS "priceCents", b.billing_type AS "billingType",
              b.billing_rate_cents AS "billingRateCents",
              b.customer_id AS "customerId", b.property_id AS "propertyId",
              b.service_type_id AS "serviceTypeId",
              b.special_requests AS "specialInstructions",
              b.recurring_service_id AS "recurringServiceId",
              c.name AS "customerName", p.address_line1 AS "addressLine1",
              p.address_line2 AS "addressLine2", p.city, p.state,
              p.postal_code AS "postalCode",
              st.name AS "serviceName", r.team_id AS "teamId", t.name AS "teamName",
              rs.route_id AS "routeId", rs.stop_order AS "stopOrder",
              r.status AS "routeStatus"
       FROM bookings b
       JOIN customers c ON c.id = b.customer_id
       JOIN properties p ON p.id = b.property_id
       JOIN service_types st ON st.id = b.service_type_id
       LEFT JOIN route_stops rs ON rs.booking_id = b.id
       LEFT JOIN routes r ON r.id = rs.route_id
       LEFT JOIN teams t ON t.id = r.team_id
       WHERE b.organization_id = $1
         AND COALESCE(b.service_date, CAST(b.scheduled_start AS date)) BETWEEN $2 AND $3
         AND b.status NOT IN ('cancelled', 'rescheduled')
       ORDER BY b.scheduled_start, c.name`,
      [organizationId, weekStart, weekEnd]
    ),
    timezone(pool, organizationId)
  ]);
  const flexible = await flexibleServices(
    pool,
    organizationId,
    reference > weekStart ? reference : weekStart
  );
  const days = calendarDays(weekStart).map((item) => ({
    date: item.date,
    dayName: item.name,
    flexibleServices: flexible.filter((service) => service.nextServiceDate === item.date),
    bookings: bookings.rows.filter(
      (booking) => databaseDate(booking.serviceDate) === item.date
    ).map((booking) => ({
      ...booking,
      serviceDate: databaseDate(booking.serviceDate),
      startTime: localTime(booking.scheduledStart, organizationTimezone),
      canMove: databaseDate(booking.serviceDate) >= reference
        && !["in_progress", "completed"].includes(booking.status)
    }))
  }));
  return {
    week: key,
    weekStart,
    weekEnd,
    timeBlocks: TIME_BLOCKS,
    teams: teams.rows,
    days
  };
}

export function createScheduleRouter({ pool }) {
  if (!pool) throw new Error("pool is required");
  const router = Router();
  router.use("/schedule-planner", requireRole("manager"));

  router.post("/schedule-planner/sync", asyncRoute(async (req, res) => {
    const input = validate(syncInput, req.body || {});
    const result = await syncAlternatingWeeks(
      pool, req.auth, referenceDate(input.reference)
    );
    data(res, {
      createdCount: result.created,
      rangeStart: result.rangeStart,
      rangeEnd: result.rangeEnd
    }, result.created ? 201 : 200);
  }));

  router.get("/schedule-planner", asyncRoute(async (req, res) => {
    const input = validate(plannerQuery, req.query);
    data(res, await planner(
      pool, req.auth.organizationId, input.week, referenceDate(input.reference)
    ));
  }));

  router.post("/schedule-planner/bookings/:id/move", asyncRoute(async (req, res) => {
    const bookingId = validate(uuid, req.params.id);
    const input = validate(moveInput, req.body);
    const moved = await transaction(pool, async (client) => {
      return moveBookingInTransaction({
        client,
        auth: req.auth,
        bookingId,
        date: input.date,
        startTime: input.startTime,
        teamId: input.teamId,
        updateScope: input.updateScope
      });
    });
    data(res, { booking: moved });
  }));

  router.post("/schedule-planner/bookings/:id/cancel", asyncRoute(async (req, res) => {
    const bookingId = validate(uuid, req.params.id);
    const input = validate(cancelInput, req.body || {});
    const cancelled = await transaction(pool, async (client) => {
      const result = await client.query(
        `SELECT b.*, COALESCE(bs.late_cancellation_fee_cents, 0)
                   AS late_cancellation_fee_cents
         FROM bookings b
         LEFT JOIN business_settings bs ON bs.organization_id = b.organization_id
         WHERE b.id = $1 AND b.organization_id = $2`,
        [bookingId, req.auth.organizationId]
      );
      if (!result.rowCount) throw new HttpError(404, "not_found", "Booking not found");
      const before = result.rows[0];
      if (before.status === "cancelled") {
        const charge = await client.query(
          `SELECT id, amount_cents FROM customer_charges
           WHERE organization_id = $1 AND booking_id = $2
             AND type = 'cancellation_fee'
           ORDER BY created_at LIMIT 1`,
          [req.auth.organizationId, bookingId]
        );
        return {
          booking: before,
          cancellationFeeCents: Number(charge.rows[0]?.amount_cents || 0),
          chargeId: charge.rows[0]?.id || null
        };
      }
      if (!["requested", "confirmed", "assigned"].includes(before.status)) {
        throw new HttpError(
          409, "invalid_state", "Started or completed service cannot be cancelled"
        );
      }

      await detachBooking(client, req.auth.organizationId, bookingId);
      await client.query(
        `UPDATE notifications SET status = 'cancelled'
         WHERE organization_id = $1 AND booking_id = $2 AND status = 'queued'`,
        [req.auth.organizationId, bookingId]
      );
      const feeCents = input.applyFee ? Number(before.late_cancellation_fee_cents) : 0;
      const updated = await client.query(
        `UPDATE bookings
         SET status = 'cancelled', cancellation_reason = $3,
             cancellation_fee_cents = $4, cancellation_fee_waived = false,
             cancellation_waiver_reason = NULL, updated_at = now()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [bookingId, req.auth.organizationId, input.reason || null, feeCents]
      );
      let chargeId = null;
      if (feeCents > 0) {
        const existing = await client.query(
          `SELECT id FROM customer_charges
           WHERE organization_id = $1 AND booking_id = $2
             AND type = 'cancellation_fee'
           ORDER BY created_at LIMIT 1`,
          [req.auth.organizationId, bookingId]
        );
        chargeId = existing.rows[0]?.id || crypto.randomUUID();
        if (existing.rowCount) {
          await client.query(
            `UPDATE customer_charges
             SET amount_cents = $3, status = 'unpaid',
                 description = 'Late cancellation fee', charged_on = CURRENT_DATE
             WHERE id = $1 AND organization_id = $2`,
            [chargeId, req.auth.organizationId, feeCents]
          );
        } else {
          await client.query(
            `INSERT INTO customer_charges
             (id, organization_id, customer_id, booking_id, type, description,
              amount_cents, status, charged_on)
             VALUES ($1, $2, $3, $4, 'cancellation_fee',
                     'Late cancellation fee', $5, 'unpaid', CURRENT_DATE)`,
            [
              chargeId, req.auth.organizationId, before.customer_id,
              bookingId, feeCents
            ]
          );
        }
      }
      await recordAudit(client, req.auth, {
        entityType: "booking",
        entityId: bookingId,
        action: "cancel_visit",
        before,
        after: {
          ...updated.rows[0],
          cancellationFeeCents: feeCents,
          cancellationChargeId: chargeId
        }
      });
      return {
        booking: updated.rows[0],
        cancellationFeeCents: feeCents,
        chargeId
      };
    });
    data(res, {
      booking: {
        id: cancelled.booking.id,
        status: cancelled.booking.status,
        customerId: cancelled.booking.customer_id,
        recurringServiceId: cancelled.booking.recurring_service_id,
        cancellationReason: cancelled.booking.cancellation_reason
      },
      cancellationFeeCents: cancelled.cancellationFeeCents,
      cancellationChargeId: cancelled.chargeId
    });
  }));

  router.post("/schedule-planner/bookings/:id/restore", asyncRoute(async (req, res) => {
    const bookingId = validate(uuid, req.params.id);
    const input = validate(restoreInput, req.body);
    const restored = await transaction(pool, async (client) => {
      const result = await client.query(
        `SELECT b.*, c.status AS customer_status
         FROM bookings b
         JOIN customers c
           ON c.id = b.customer_id AND c.organization_id = b.organization_id
         WHERE b.id = $1 AND b.organization_id = $2`,
        [bookingId, req.auth.organizationId]
      );
      if (!result.rowCount) throw new HttpError(404, "not_found", "Booking not found");
      const before = result.rows[0];
      if (before.status !== "cancelled") {
        throw new HttpError(409, "invalid_state", "Only a cancelled visit can be restored");
      }
      if (before.customer_status !== "active") {
        throw new HttpError(409, "customer_inactive", "Reactivate the customer before restoring a visit");
      }
      const organizationTimezone = await timezone(client, req.auth.organizationId);
      if (input.date < todayInTimezone(organizationTimezone)) {
        throw new HttpError(400, "validation_error", "Restored visits must use today or a future date");
      }
      const scheduledStart = zonedDateTime(
        input.date,
        input.startTime,
        organizationTimezone
      );
      if (input.teamId) {
        await schedulePlacement({
          client,
          organizationId: req.auth.organizationId,
          teamId: input.teamId,
          serviceDate: input.date,
          scheduledStart,
          bookingId
        });
      }

      const fee = await client.query(
        `SELECT c.id, c.status, COALESCE(SUM(pa.amount_cents), 0) AS allocated_cents
         FROM customer_charges c
         LEFT JOIN payment_allocations pa
           ON pa.charge_id = c.id AND pa.reversed_at IS NULL
         WHERE c.organization_id = $1 AND c.booking_id = $2
           AND c.type = 'cancellation_fee'
         GROUP BY c.id, c.status
         ORDER BY c.created_at
         LIMIT 1`,
        [req.auth.organizationId, bookingId]
      );
      const feeCanBeWaived = fee.rows[0]?.status === "unpaid"
        && Number(fee.rows[0]?.allocated_cents || 0) === 0;
      if (feeCanBeWaived) {
        await client.query(
          `UPDATE customer_charges SET status = 'waived'
           WHERE id = $1 AND organization_id = $2`,
          [fee.rows[0].id, req.auth.organizationId]
        );
      }

      await client.query(
        `UPDATE bookings
         SET status = 'confirmed', scheduled_start = $3, service_date = $4,
             cancellation_reason = NULL,
             cancellation_fee_waived = $5,
             cancellation_waiver_reason = CASE WHEN $5 THEN 'Visit restored' ELSE NULL END,
             updated_at = now()
         WHERE id = $1 AND organization_id = $2`,
        [
          bookingId,
          req.auth.organizationId,
          scheduledStart,
          input.date,
          feeCanBeWaived
        ]
      );
      const routeId = await assignBooking(
        client,
        req.auth.organizationId,
        bookingId,
        input.teamId,
        input.date
      );
      await recordAudit(client, req.auth, {
        entityType: "booking",
        entityId: bookingId,
        action: "restore_visit",
        before,
        after: {
          date: input.date,
          startTime: input.startTime,
          teamId: input.teamId,
          routeId,
          cancellationFeeWaived: feeCanBeWaived,
          preservedPaidFee: Boolean(fee.rowCount && !feeCanBeWaived)
        }
      });
      return {
        id: bookingId,
        status: input.teamId ? "assigned" : "confirmed",
        serviceDate: input.date,
        startTime: input.startTime,
        teamId: input.teamId,
        routeId,
        cancellationFeeWaived: feeCanBeWaived,
        preservedPaidFee: Boolean(fee.rowCount && !feeCanBeWaived)
      };
    });
    data(res, { booking: restored });
  }));

  router.get("/schedule-planner/others", asyncRoute(async (req, res) => {
    const input = validate(z.object({ reference: dateOnly.optional() }).strict(), req.query);
    const reference = referenceDate(input.reference);
    data(res, {
      services: await flexibleServices(pool, req.auth.organizationId, reference)
    });
  }));

  router.post("/schedule-planner/others/:id/place", asyncRoute(async (req, res) => {
    const recurringId = validate(uuid, req.params.id);
    const input = validate(placeInput, req.body);
    const reference = referenceDate(input.reference);
    const placed = await transaction(pool, async (client) => {
      const result = await client.query(
        `SELECT * FROM recurring_services
         WHERE id = $1 AND organization_id = $2 AND status = 'active'`,
        [recurringId, req.auth.organizationId]
      );
      if (!result.rowCount) {
        throw new HttpError(404, "not_found", "Recurring service not found");
      }
      const recurring = result.rows[0];
      const recurrenceRule = rule(recurring);
      if (!isOtherRule(recurrenceRule)) {
        throw new HttpError(409, "invalid_schedule", "This service belongs in Schedule A or B");
      }
      const existing = await client.query(
        `SELECT recurrence_due_date AS "dueDate",
                COALESCE(service_date, CAST(scheduled_start AS date)) AS "serviceDate",
                status
         FROM bookings
         WHERE organization_id = $1 AND recurring_service_id = $2
           AND recurrence_due_date IS NOT NULL`,
        [req.auth.organizationId, recurringId]
      );
      if (existing.rows.some((item) =>
        databaseDate(item.serviceDate) >= reference
        && !["cancelled", "rescheduled", "unable_to_complete"].includes(item.status)
      )) {
        throw new HttpError(
          409, "occurrence_pending", "This recurring service already has an upcoming visit"
        );
      }
      const dueDate = nextFlexibleOccurrence(
        databaseDate(recurring.starts_on),
        recurrenceRule,
        reference,
        new Set(existing.rows.map((item) => databaseDate(item.dueDate)))
      );
      if (!dueDate) throw new HttpError(409, "no_occurrence", "No future service date is available");
      const serviceDate = nearestWeekday(dueDate);
      const dueWeek = labelForWeek(mondayFor(serviceDate));
      if (dueWeek !== input.week) {
        throw new HttpError(
          409,
          "schedule_mismatch",
          `This occurrence lands in Schedule ${dueWeek}`
        );
      }
      const bookingId = await insertRecurringBooking(
        client, req.auth.organizationId, recurring, dueDate, serviceDate, input.startTime
      );
      if (!bookingId) throw new HttpError(409, "occurrence_exists", "This service was already placed");
      const routeId = await assignBooking(
        client, req.auth.organizationId, bookingId, input.teamId, serviceDate
      );
      const nextDueDate = nextFlexibleOccurrence(
        databaseDate(recurring.starts_on),
        recurrenceRule,
        addDays(serviceDate, 1),
        new Set([...existing.rows.map((item) => databaseDate(item.dueDate)), dueDate])
      );
      await recordAudit(client, req.auth, {
        entityType: "booking",
        entityId: bookingId,
        action: "place_recurring_occurrence",
        after: { recurringId, dueDate, serviceDate, routeId, ...input }
      });
      return {
        booking: {
          id: bookingId,
          recurrenceDueDate: dueDate,
          serviceDate,
          teamId: input.teamId,
          startTime: input.startTime,
          routeId
        },
        nextDueDate,
        nextServiceDate: nextDueDate ? nearestWeekday(nextDueDate) : null
      };
    });
    data(res, placed, 201);
  }));

  router.get("/schedule-planner/history", asyncRoute(async (req, res) => {
    const input = validate(historyQuery, req.query);
    const to = input.to || new Date().toISOString().slice(0, 10);
    const from = input.from || addDays(to, -90);
    if (from > to) throw new HttpError(400, "validation_error", "History start must precede its end");
    const services = await pool.query(
      `SELECT b.id, b.status, b.scheduled_start AS "scheduledStart",
              COALESCE(b.service_date, CAST(b.scheduled_start AS date)) AS "serviceDate",
              b.completed_at AS "completedAt", b.actual_duration_minutes AS "actualDurationMinutes",
              b.price_cents AS "priceCents", b.billing_type AS "billingType",
              b.billing_rate_cents AS "billingRateCents",
              c.name AS "customerName", p.address_line1 AS "addressLine1",
              p.city, st.name AS "serviceName", t.name AS "teamName"
       FROM bookings b
       JOIN customers c ON c.id = b.customer_id
       JOIN properties p ON p.id = b.property_id
       JOIN service_types st ON st.id = b.service_type_id
       LEFT JOIN route_stops rs ON rs.booking_id = b.id
       LEFT JOIN routes r ON r.id = rs.route_id
       LEFT JOIN teams t ON t.id = r.team_id
       WHERE b.organization_id = $1
         AND COALESCE(b.service_date, CAST(b.scheduled_start AS date)) BETWEEN $2 AND $3
         AND COALESCE(b.service_date, CAST(b.scheduled_start AS date)) <= $4
       ORDER BY COALESCE(b.service_date, CAST(b.scheduled_start AS date)) DESC,
                b.scheduled_start DESC
       LIMIT $5`,
      [req.auth.organizationId, from, to, referenceDate(), input.limit]
    );
    const workers = await pool.query(
      `SELECT ja.booking_id AS "bookingId",
              e.first_name || ' ' || e.last_name AS name, ja.role
       FROM job_assignments ja
       JOIN employees e ON e.id = ja.employee_id
       JOIN bookings b ON b.id = ja.booking_id
       WHERE b.organization_id = $1
         AND COALESCE(b.service_date, CAST(b.scheduled_start AS date)) BETWEEN $2 AND $3
       ORDER BY ja.role, e.first_name, e.last_name`,
      [req.auth.organizationId, from, to]
    );
    const names = new Map();
    for (const worker of workers.rows) {
      if (!names.has(worker.bookingId)) names.set(worker.bookingId, []);
      names.get(worker.bookingId).push({
        name: worker.name,
        role: worker.role
      });
    }
    data(res, {
      from,
      to,
      services: services.rows.map((service) => ({
        ...service,
        serviceDate: databaseDate(service.serviceDate),
        employees: names.get(service.id) || [],
        employeeNames: (names.get(service.id) || []).map((employee) => employee.name)
      }))
    });
  }));

  return router;
}
