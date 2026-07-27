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
  startTime: block
}).strict();

const placeInput = z.object({
  week: weekKey,
  weekday: z.number().int().min(1).max(6).optional(),
  teamId: uuid,
  startTime: block,
  reference: dateOnly.optional()
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

function addDays(value, days) {
  return isoDate(new Date(date(value).getTime() + days * DAY_MS));
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

async function detachBooking(client, organizationId, bookingId) {
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

async function assignBooking(client, organizationId, bookingId, teamId, serviceDate) {
  await detachBooking(client, organizationId, bookingId);
  if (!teamId) {
    await client.query(
      `UPDATE bookings SET status = 'confirmed', updated_at = now()
       WHERE id = $1 AND organization_id = $2`,
      [bookingId, organizationId]
    );
    return null;
  }

  const team = await activeTeam(client, organizationId, teamId, serviceDate);
  let route = await client.query(
    `SELECT id FROM routes
     WHERE organization_id = $1 AND team_id = $2 AND service_date = $3`,
    [organizationId, teamId, serviceDate]
  );
  if (!route.rowCount) {
    route = await client.query(
      `INSERT INTO routes
       (id, organization_id, team_id, captain_employee_id, service_date, status)
       VALUES ($1, $2, $3, $4, $5, 'draft')
       RETURNING id`,
      [crypto.randomUUID(), organizationId, teamId, team.captainEmployeeId, serviceDate]
    );
  }
  const routeId = route.rows[0].id;
  const count = await client.query(
    "SELECT COUNT(*) AS count FROM route_stops WHERE route_id = $1",
    [routeId]
  );
  const booking = await client.query(
    `SELECT scheduled_start, expected_duration_minutes
     FROM bookings WHERE id = $1 AND organization_id = $2`,
    [bookingId, organizationId]
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
  for (const member of team.members) {
    await client.query(
      `INSERT INTO job_assignments (booking_id, employee_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (booking_id, employee_id) DO UPDATE SET role = EXCLUDED.role`,
      [
        bookingId,
        member.id,
        member.id === team.captainEmployeeId ? "captain" : "cleaner"
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
              b.service_type_id AS "serviceTypeId",
              b.special_requests AS "specialInstructions",
              b.recurring_service_id AS "recurringServiceId",
              c.name AS "customerName", p.address_line1 AS "addressLine1",
              p.address_line2 AS "addressLine2", p.city, p.state,
              p.postal_code AS "postalCode",
              st.name AS "serviceName", r.team_id AS "teamId", t.name AS "teamName",
              rs.route_id AS "routeId", rs.stop_order AS "stopOrder"
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
  const days = calendarDays(weekStart).map((item) => ({
    date: item.date,
    dayName: item.name,
    bookings: bookings.rows.filter(
      (booking) => databaseDate(booking.serviceDate) === item.date
    ).map((booking) => ({
      ...booking,
      serviceDate: databaseDate(booking.serviceDate),
      startTime: localTime(booking.scheduledStart, organizationTimezone),
      canMove: databaseDate(booking.serviceDate) >= referenceDate()
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
      const before = await client.query(
        `SELECT * FROM bookings WHERE id = $1 AND organization_id = $2`,
        [bookingId, req.auth.organizationId]
      );
      if (!before.rowCount) throw new HttpError(404, "not_found", "Booking not found");
      if (["in_progress", "completed"].includes(before.rows[0].status)) {
        throw new HttpError(409, "invalid_state", "Started or completed service cannot be moved");
      }
      const beforeDate = databaseDate(
        before.rows[0].service_date || before.rows[0].scheduled_start
      );
      if (beforeDate < referenceDate()) {
        throw new HttpError(409, "invalid_state", "Past service cannot be moved");
      }
      const scheduledStart = zonedDateTime(
        input.date,
        input.startTime,
        await timezone(client, req.auth.organizationId)
      );
      await client.query(
        `UPDATE bookings
         SET scheduled_start = $3, service_date = $4, status = 'confirmed', updated_at = now()
         WHERE id = $1 AND organization_id = $2`,
        [bookingId, req.auth.organizationId, scheduledStart, input.date]
      );
      const routeId = await assignBooking(
        client, req.auth.organizationId, bookingId, input.teamId, input.date
      );
      await recordAudit(client, req.auth, {
        entityType: "booking",
        entityId: bookingId,
        action: "schedule_move",
        before: before.rows[0],
        after: { ...input, routeId }
      });
      return {
        id: bookingId,
        routeId,
        teamId: input.teamId,
        serviceDate: input.date,
        startTime: input.startTime
      };
    });
    data(res, { booking: moved });
  }));

  router.get("/schedule-planner/others", asyncRoute(async (req, res) => {
    const input = validate(z.object({ reference: dateOnly.optional() }).strict(), req.query);
    const reference = referenceDate(input.reference);
    const rows = await recurringRows(pool, req.auth.organizationId);
    const bookings = await pool.query(
      `SELECT recurring_service_id AS "recurringServiceId",
              recurrence_due_date AS "dueDate"
       FROM bookings
       WHERE organization_id = $1 AND recurring_service_id IS NOT NULL
         AND recurrence_due_date IS NOT NULL
         AND status NOT IN ('cancelled', 'rescheduled')`,
      [req.auth.organizationId]
    );
    const booked = new Map();
    for (const booking of bookings.rows) {
      if (!booked.has(booking.recurringServiceId)) {
        booked.set(booking.recurringServiceId, new Set());
      }
      booked.get(booking.recurringServiceId).add(databaseDate(booking.dueDate));
    }
    const details = await pool.query(
      `SELECT rs.id, c.name AS "customerName", p.address_line1 AS "addressLine1",
              p.address_line2 AS "addressLine2", p.city, p.postal_code AS "postalCode",
              st.name AS "serviceName", t.name AS "preferredTeamName"
       FROM recurring_services rs
       JOIN customers c ON c.id = rs.customer_id
       JOIN properties p ON p.id = rs.property_id
       JOIN service_types st ON st.id = rs.service_type_id
       LEFT JOIN teams t ON t.id = rs.preferred_team_id
       WHERE rs.organization_id = $1`,
      [req.auth.organizationId]
    );
    const detailMap = new Map(details.rows.map((item) => [item.id, item]));
    const others = rows.filter((item) => isOtherRule(rule(item))).map((item) => {
      const recurrenceRule = rule(item);
      const nextServiceDate = nextOccurrence(
        databaseDate(item.starts_on),
        recurrenceRule,
        reference,
        booked.get(item.id) || new Set()
      );
      return {
        ...detailMap.get(item.id),
        id: item.id,
        recurrenceRule,
        nextDueDate: nextServiceDate,
        week: nextServiceDate ? labelForWeek(mondayFor(nextServiceDate)) : null,
        preferredTeamId: item.preferred_team_id,
        preferredStartTime: item.preferred_start_time,
        expectedDurationMinutes: item.expected_duration_minutes,
        priceCents: item.price_cents,
        billingType: item.billing_type,
        billingRateCents: item.billing_rate_cents,
        specialInstructions: item.special_instructions
      };
    });
    data(res, { services: others });
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
        `SELECT recurrence_due_date AS "dueDate" FROM bookings
         WHERE organization_id = $1 AND recurring_service_id = $2
           AND recurrence_due_date IS NOT NULL
           AND status NOT IN ('cancelled', 'rescheduled')`,
        [req.auth.organizationId, recurringId]
      );
      const dueDate = nextOccurrence(
        databaseDate(recurring.starts_on),
        recurrenceRule,
        reference,
        new Set(existing.rows.map((item) => databaseDate(item.dueDate)))
      );
      if (!dueDate) throw new HttpError(409, "no_occurrence", "No future service date is available");
      const dueWeek = labelForWeek(mondayFor(dueDate));
      if (dueWeek !== input.week) {
        throw new HttpError(
          409,
          "schedule_mismatch",
          `This occurrence lands in Schedule ${dueWeek}`
        );
      }
      const dueWeekStart = mondayFor(dueDate);
      const defaultWeekday = date(dueDate).getUTCDay() || 6;
      const serviceDate = addDays(dueWeekStart, (input.weekday || defaultWeekday) - 1);
      const bookingId = await insertRecurringBooking(
        client, req.auth.organizationId, recurring, dueDate, serviceDate, input.startTime
      );
      if (!bookingId) throw new HttpError(409, "occurrence_exists", "This service was already placed");
      const routeId = await assignBooking(
        client, req.auth.organizationId, bookingId, input.teamId, serviceDate
      );
      const nextDueDate = nextOccurrence(
        databaseDate(recurring.starts_on),
        recurrenceRule,
        reference,
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
        nextDueDate
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
