import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { recordAudit, requireRole } from "./auth.js";
import { HttpError, asyncRoute, data, validate } from "./http.js";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();

const routeSchema = z.object({
  teamId: uuid,
  serviceDate: dateSchema,
  stops: z.array(z.object({
    bookingId: uuid,
    stopOrder: z.number().int().positive(),
    estimatedArrival: z.string().datetime().nullable().optional(),
    estimatedDeparture: z.string().datetime().nullable().optional(),
    travelMinutesFromPrevious: z.number().int().min(0).default(0)
  }).strict()).min(1)
}).strict();

const routeUpdateSchema = z.object({
  estimatedPaidMinutes: z.number().int().min(0),
  estimatedFinishAt: z.string().datetime().nullable(),
  overrideReason: z.string().trim().max(500).nullable().optional()
}).strict();

const timestampSchema = z.object({
  occurredAt: z.string().datetime().optional()
}).strict();

const issueSchema = z.object({
  type: z.enum(["access", "damage", "safety", "extra_work", "service", "other"]),
  description: z.string().trim().min(1).max(2000),
  customerApproved: z.boolean().nullable().optional(),
  additionalChargeCents: z.number().int().min(0).nullable().optional()
}).strict();
const issueResolutionSchema = z.object({
  customerApproved: z.boolean(),
  additionalChargeCents: z.number().int().min(0).nullable().optional(),
  resolutionNotes: z.string().trim().min(1).max(2000)
}).strict().refine(
  (value) => !value.customerApproved || (value.additionalChargeCents || 0) > 0,
  { message: "Approved extra work requires a positive charge", path: ["additionalChargeCents"] }
);

async function withTransaction(pool, work) {
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

async function employeeForUser(pool, auth) {
  const result = await pool.query(
    `SELECT id FROM employees
     WHERE organization_id = $1 AND user_id = $2 AND active = true`,
    [auth.organizationId, auth.id]
  );
  return result.rows[0]?.id || null;
}

async function routeAccess(pool, auth, routeId, captainOnly = false) {
  const employeeId = await employeeForUser(pool, auth);
  const result = await pool.query(
    `SELECT r.id, r.status, r.service_date AS "serviceDate",
            r.captain_employee_id AS "captainEmployeeId"
     FROM routes r
     WHERE r.id = $1 AND r.organization_id = $2`,
    [routeId, auth.organizationId]
  );
  if (!result.rowCount) throw new HttpError(404, "not_found", "Route not found");
  if (auth.role === "cleaner" && (!employeeId
    || (captainOnly && result.rows[0].captainEmployeeId !== employeeId))) {
    throw new HttpError(403, "forbidden", "Only the assigned captain can perform this action");
  }
  return { route: result.rows[0], employeeId };
}

export function createDispatchRouter({ pool }) {
  const router = Router();

  router.get("/dispatch", requireRole("manager"), asyncRoute(async (req, res) => {
    const serviceDate = validate(z.object({ date: dateSchema }).strict(), req.query).date;
    const result = await pool.query(
      `SELECT b.id, b.status, b.scheduled_start AS "scheduledStart",
              b.expected_duration_minutes AS "expectedDurationMinutes",
              b.customer_time_window_start AS "windowStart",
              b.customer_time_window_end AS "windowEnd", b.special_requests AS "specialRequests",
              c.name AS "customerName", p.address_line1 AS "addressLine1",
              p.city, p.postal_code AS "postalCode", st.name AS "serviceName",
              rs.route_id AS "routeId", rs.stop_order AS "stopOrder", t.name AS "teamName",
              r.status AS "routeStatus"
       FROM bookings b
       JOIN customers c ON c.id = b.customer_id
       JOIN properties p ON p.id = b.property_id
       JOIN service_types st ON st.id = b.service_type_id
       LEFT JOIN route_stops rs ON rs.booking_id = b.id
       LEFT JOIN routes r ON r.id = rs.route_id
       LEFT JOIN teams t ON t.id = r.team_id
       WHERE b.organization_id = $1 AND CAST(b.scheduled_start AS date) = $2
         AND b.status NOT IN ('cancelled', 'rescheduled')
       ORDER BY b.scheduled_start, c.name`,
      [req.auth.organizationId, serviceDate]
    );
    data(res, { bookings: result.rows });
  }));

  router.post("/routes", requireRole("manager"), asyncRoute(async (req, res) => {
    const input = validate(routeSchema, req.body);
    const route = await withTransaction(pool, async (client) => {
      const team = await client.query(
        `SELECT t.id, tm.employee_id AS "captainEmployeeId"
         FROM teams t
         LEFT JOIN team_members tm ON tm.team_id = t.id
           AND tm.is_captain = true
           AND tm.effective_from <= $3
           AND (tm.effective_to IS NULL OR tm.effective_to >= $3)
         WHERE t.id = $1 AND t.organization_id = $2 AND t.active = true
         LIMIT 1`,
        [input.teamId, req.auth.organizationId, input.serviceDate]
      );
      if (!team.rowCount) throw new HttpError(404, "not_found", "Team not found");
      if (!team.rows[0].captainEmployeeId) {
        throw new HttpError(409, "team_has_no_captain", "Team needs an active captain");
      }

      const members = await client.query(
        `SELECT e.id
         FROM team_members tm
         JOIN employees e ON e.id = tm.employee_id
         WHERE tm.team_id = $1 AND e.organization_id = $2 AND e.active = true
           AND tm.effective_from <= $3
           AND (tm.effective_to IS NULL OR tm.effective_to >= $3)`,
        [input.teamId, req.auth.organizationId, input.serviceDate]
      );
      if (!members.rowCount) throw new HttpError(409, "team_has_no_members", "Team has no active members");

      const dayStart = new Date(`${input.serviceDate}T00:00:00.000Z`);
      const dayEnd = new Date(`${input.serviceDate}T23:59:59.999Z`);
      const unavailable = await client.query(
        `SELECT e.first_name || ' ' || e.last_name AS name
         FROM availability_exceptions a
         JOIN employees e ON e.id = a.employee_id
         WHERE e.organization_id = $1 AND a.status = 'approved'
           AND a.employee_id IN (
             SELECT employee_id FROM team_members WHERE team_id = $2
           )
           AND a.starts_at <= $4 AND a.ends_at >= $3`,
        [req.auth.organizationId, input.teamId, dayStart, dayEnd]
      );
      if (unavailable.rowCount) {
        throw new HttpError(409, "team_unavailable", "A team member is unavailable", {
          employees: unavailable.rows.map((row) => row.name)
        });
      }

      const routeId = crypto.randomUUID();
      try {
        await client.query(
          `INSERT INTO routes
           (id, organization_id, team_id, captain_employee_id, service_date, status)
           VALUES ($1, $2, $3, $4, $5, 'draft')`,
          [routeId, req.auth.organizationId, input.teamId, team.rows[0].captainEmployeeId, input.serviceDate]
        );
      } catch (error) {
        if (error.code === "23505") {
          throw new HttpError(409, "route_exists", "This team already has a route for that date");
        }
        throw error;
      }

      for (const stop of input.stops) {
        const booking = await client.query(
          `SELECT id FROM bookings
           WHERE id = $1 AND organization_id = $2
             AND status IN ('requested', 'confirmed', 'assigned')`,
          [stop.bookingId, req.auth.organizationId]
        );
        if (!booking.rowCount) throw new HttpError(404, "not_found", "Booking not found");
        await client.query(
          `INSERT INTO route_stops
           (id, organization_id, route_id, booking_id, stop_order, estimated_arrival,
            estimated_departure, travel_minutes_from_previous)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            crypto.randomUUID(), req.auth.organizationId, routeId, stop.bookingId,
            stop.stopOrder, stop.estimatedArrival || null, stop.estimatedDeparture || null,
            stop.travelMinutesFromPrevious
          ]
        );
        for (const member of members.rows) {
          await client.query(
            `INSERT INTO job_assignments (booking_id, employee_id, role)
             VALUES ($1, $2, $3)
             ON CONFLICT (booking_id, employee_id) DO UPDATE SET role = EXCLUDED.role`,
            [
              stop.bookingId,
              member.id,
              member.id === team.rows[0].captainEmployeeId ? "captain" : "cleaner"
            ]
          );
        }
        await client.query(
          "UPDATE bookings SET status = 'assigned', updated_at = now() WHERE id = $1",
          [stop.bookingId]
        );
      }
      return { id: routeId, status: "draft" };
    });
    await recordAudit(pool, req.auth, {
      entityType: "route",
      entityId: route.id,
      action: "create",
      after: input
    });
    data(res, { route }, 201);
  }));

  router.patch("/routes/:id", requireRole("manager"), asyncRoute(async (req, res) => {
    const id = validate(uuid, req.params.id);
    const input = validate(routeUpdateSchema, req.body);
    const result = await pool.query(
      `UPDATE routes
       SET estimated_paid_minutes = $3, estimated_finish_at = $4,
           override_reason = $5, updated_at = now()
       WHERE id = $1 AND organization_id = $2
       RETURNING id, status, estimated_paid_minutes AS "estimatedPaidMinutes",
                 estimated_finish_at AS "estimatedFinishAt", override_reason AS "overrideReason"`,
      [
        id, req.auth.organizationId, input.estimatedPaidMinutes,
        input.estimatedFinishAt, input.overrideReason || null
      ]
    );
    if (!result.rowCount) throw new HttpError(404, "not_found", "Route not found");
    await recordAudit(pool, req.auth, {
      entityType: "route", entityId: id, action: "update", after: input,
      reason: input.overrideReason
    });
    data(res, { route: result.rows[0] });
  }));

  router.post("/routes/:id/finalize", requireRole("manager"), asyncRoute(async (req, res) => {
    const id = validate(uuid, req.params.id);
    const result = await pool.query(
      `UPDATE routes SET status = 'finalized', finalized_by = $3,
              finalized_at = now(), updated_at = now()
       WHERE id = $1 AND organization_id = $2 AND status = 'draft'
       RETURNING id, status, finalized_at AS "finalizedAt"`,
      [id, req.auth.organizationId, req.auth.id]
    );
    if (!result.rowCount) {
      throw new HttpError(409, "route_not_draft", "Only a draft route can be finalized");
    }
    await recordAudit(pool, req.auth, {
      entityType: "route", entityId: id, action: "finalize"
    });
    data(res, { route: result.rows[0] });
  }));

  router.get("/my-route", requireRole("cleaner"), asyncRoute(async (req, res) => {
    const serviceDate = validate(z.object({ date: dateSchema }).strict(), req.query).date;
    const employeeId = await employeeForUser(pool, req.auth);
    if (!employeeId) throw new HttpError(404, "employee_not_linked", "No employee record is linked to this user");
    const route = await pool.query(
      `SELECT DISTINCT r.id, r.status, r.service_date AS "serviceDate", t.name AS "teamName",
              r.captain_employee_id = $2 AS "isCaptain"
       FROM routes r
       JOIN teams t ON t.id = r.team_id
       JOIN route_stops rs ON rs.route_id = r.id
       JOIN job_assignments ja ON ja.booking_id = rs.booking_id
       WHERE r.organization_id = $1 AND ja.employee_id = $2 AND r.service_date = $3
       LIMIT 1`,
      [req.auth.organizationId, employeeId, serviceDate]
    );
    if (!route.rowCount) return data(res, { route: null, stops: [] });
    const stops = await pool.query(
      `SELECT rs.id, rs.stop_order AS "stopOrder", rs.estimated_arrival AS "estimatedArrival",
              rs.estimated_departure AS "estimatedDeparture",
              rs.travel_minutes_from_previous AS "travelMinutesFromPrevious",
              b.id AS "bookingId", b.status, b.special_requests AS "specialRequests",
              c.name AS "customerName", p.address_line1 AS "addressLine1",
              p.address_line2 AS "addressLine2", p.city, p.state, p.postal_code AS "postalCode",
              p.access_instructions AS "accessInstructions", p.service_notes AS "serviceNotes",
              st.name AS "serviceName", st.reference_checklist AS checklist
       FROM route_stops rs
       JOIN bookings b ON b.id = rs.booking_id
       JOIN customers c ON c.id = b.customer_id
       JOIN properties p ON p.id = b.property_id
       JOIN service_types st ON st.id = b.service_type_id
       WHERE rs.route_id = $1 AND rs.organization_id = $2
       ORDER BY rs.stop_order`,
      [route.rows[0].id, req.auth.organizationId]
    );
    data(res, { route: route.rows[0], stops: stops.rows });
  }));

  router.post("/routes/:id/check-in", requireRole("cleaner"), asyncRoute(async (req, res) => {
    const id = validate(uuid, req.params.id);
    const input = validate(timestampSchema, req.body);
    const { route } = await routeAccess(pool, req.auth, id, true);
    if (!["finalized", "in_progress"].includes(route.status)) {
      throw new HttpError(409, "route_not_ready", "Route must be finalized before check-in");
    }
    const occurredAt = input.occurredAt || new Date().toISOString();
    const result = await withTransaction(pool, async (client) => {
      const employees = await client.query(
        `SELECT DISTINCT ja.employee_id
         FROM route_stops rs
         JOIN job_assignments ja ON ja.booking_id = rs.booking_id
         WHERE rs.route_id = $1`,
        [id]
      );
      for (const employee of employees.rows) {
        await client.query(
          `INSERT INTO time_entries
           (id, organization_id, route_id, employee_id, status, check_in_at)
           VALUES ($1, $2, $3, $4, 'open', $5)
           ON CONFLICT (route_id, employee_id) DO NOTHING`,
          [crypto.randomUUID(), req.auth.organizationId, id, employee.employee_id, occurredAt]
        );
      }
      await client.query(
        "UPDATE routes SET status = 'in_progress', updated_at = now() WHERE id = $1",
        [id]
      );
      await client.query(
        `UPDATE bookings SET status = 'in_progress', updated_at = now()
         WHERE id IN (SELECT booking_id FROM route_stops WHERE route_id = $1)`,
        [id]
      );
      return employees.rowCount;
    });
    data(res, { checkedInAt: occurredAt, employeeCount: result });
  }));

  router.post("/routes/:id/check-out", requireRole("cleaner"), asyncRoute(async (req, res) => {
    const id = validate(uuid, req.params.id);
    const input = validate(timestampSchema, req.body);
    await routeAccess(pool, req.auth, id, true);
    const occurredAt = new Date(input.occurredAt || Date.now());
    const entries = await pool.query(
      `SELECT id, check_in_at AS "checkInAt"
       FROM time_entries
       WHERE route_id = $1 AND organization_id = $2 AND status = 'open'`,
      [id, req.auth.organizationId]
    );
    if (!entries.rowCount) throw new HttpError(409, "not_checked_in", "Route has no open time entries");
    await withTransaction(pool, async (client) => {
      for (const entry of entries.rows) {
        const paidMinutes = Math.round((occurredAt - new Date(entry.checkInAt)) / 60_000);
        if (paidMinutes <= 0) throw new HttpError(400, "invalid_time", "Check-out must be after check-in");
        await client.query(
          `UPDATE time_entries
           SET status = 'submitted', check_out_at = $2, paid_minutes = $3, updated_at = now()
           WHERE id = $1`,
          [entry.id, occurredAt, paidMinutes]
        );
      }
      await client.query(
        "UPDATE routes SET status = 'completed', updated_at = now() WHERE id = $1",
        [id]
      );
      await client.query(
        `UPDATE bookings SET status = 'completed', completed_at = $2,
                actual_duration_minutes = $3, updated_at = now()
         WHERE id IN (SELECT booking_id FROM route_stops WHERE route_id = $1)`,
        [id, occurredAt, Math.round(
          entries.rows.reduce((sum, entry) => sum
            + (occurredAt - new Date(entry.checkInAt)) / 60_000, 0) / entries.rowCount
        )]
      );
      const completedBookings = await client.query(
        `SELECT b.id, b.customer_id, b.price_cents, b.scheduled_start,
                st.name AS "serviceName"
         FROM route_stops rs
         JOIN bookings b ON b.id = rs.booking_id
         JOIN service_types st ON st.id = b.service_type_id
         WHERE rs.route_id = $1 AND b.organization_id = $2`,
        [id, req.auth.organizationId]
      );
      for (const booking of completedBookings.rows) {
        const existingCharge = await client.query(
          `SELECT id FROM customer_charges
           WHERE organization_id = $1 AND booking_id = $2 AND type = 'service'`,
          [req.auth.organizationId, booking.id]
        );
        if (!existingCharge.rowCount) {
          await client.query(
            `INSERT INTO customer_charges
             (id, organization_id, customer_id, booking_id, type, description,
              amount_cents, status, charged_on)
             VALUES ($1, $2, $3, $4, 'service', $5, $6, 'unpaid', $7)`,
            [
              crypto.randomUUID(), req.auth.organizationId, booking.customer_id,
              booking.id, booking.serviceName, booking.price_cents,
              new Date(booking.scheduled_start).toISOString().slice(0, 10)
            ]
          );
        }
      }
    });
    data(res, { checkedOutAt: occurredAt.toISOString(), employeeCount: entries.rowCount });
  }));

  router.post("/bookings/:id/issues", asyncRoute(async (req, res) => {
    const bookingId = validate(uuid, req.params.id);
    const input = validate(issueSchema, req.body);
    const employeeId = await employeeForUser(pool, req.auth);
    const booking = req.auth.role === "manager"
      ? await pool.query(
        "SELECT id FROM bookings WHERE id = $1 AND organization_id = $2",
        [bookingId, req.auth.organizationId]
      )
      : await pool.query(
        `SELECT b.id
         FROM bookings b
         JOIN job_assignments ja ON ja.booking_id = b.id
         WHERE b.id = $1 AND b.organization_id = $2 AND ja.employee_id = $3`,
        [bookingId, req.auth.organizationId, employeeId]
      );
    if (!booking.rowCount) throw new HttpError(404, "not_found", "Booking not found");
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO job_issues
       (id, organization_id, booking_id, reported_by_employee_id, recorded_by_user_id,
        type, description, customer_approved, additional_charge_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id, req.auth.organizationId, bookingId, employeeId,
        req.auth.role === "manager" ? req.auth.id : null,
        input.type, input.description, input.customerApproved ?? null,
        input.additionalChargeCents ?? null
      ]
    );
    await recordAudit(pool, req.auth, {
      entityType: "job_issue", entityId: id, action: "create", after: input
    });
    data(res, { issue: { id, ...input } }, 201);
  }));

  router.patch("/job-issues/:id", requireRole("manager"), asyncRoute(async (req, res) => {
    const id = validate(uuid, req.params.id);
    const input = validate(issueResolutionSchema, req.body);
    const issue = await pool.query(
      `SELECT ji.id, ji.booking_id AS "bookingId", ji.description,
              b.customer_id AS "customerId", b.scheduled_start AS "scheduledStart"
       FROM job_issues ji
       JOIN bookings b ON b.id = ji.booking_id
       WHERE ji.id = $1 AND ji.organization_id = $2 AND ji.resolved_at IS NULL`,
      [id, req.auth.organizationId]
    );
    if (!issue.rowCount) throw new HttpError(404, "not_found", "Open job issue not found");
    await withTransaction(pool, async (client) => {
      await client.query(
        `UPDATE job_issues
         SET customer_approved = $3, additional_charge_cents = $4, resolved_at = now(),
             description = description || $5
         WHERE id = $1 AND organization_id = $2`,
        [
          id, req.auth.organizationId, input.customerApproved,
          input.additionalChargeCents ?? null, `\nResolution: ${input.resolutionNotes}`
        ]
      );
      if (input.customerApproved && input.additionalChargeCents) {
        const existing = await client.query(
          `SELECT id FROM customer_charges
           WHERE organization_id = $1 AND booking_id = $2
             AND type = 'additional_work' AND description = $3`,
          [req.auth.organizationId, issue.rows[0].bookingId, issue.rows[0].description]
        );
        if (!existing.rowCount) {
          await client.query(
            `INSERT INTO customer_charges
             (id, organization_id, customer_id, booking_id, type, description,
              amount_cents, status, charged_on)
             VALUES ($1, $2, $3, $4, 'additional_work', $5, $6, 'unpaid', $7)`,
            [
              crypto.randomUUID(), req.auth.organizationId, issue.rows[0].customerId,
              issue.rows[0].bookingId, issue.rows[0].description,
              input.additionalChargeCents,
              new Date(issue.rows[0].scheduledStart).toISOString().slice(0, 10)
            ]
          );
        }
      }
    });
    await recordAudit(pool, req.auth, {
      entityType: "job_issue", entityId: id, action: "resolve", after: input
    });
    data(res, { issue: { id, resolved: true, ...input } });
  }));

  return router;
}
