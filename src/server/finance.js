import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { recordAudit, requireRole } from "./auth.js";
import { calculatePayroll, splitTip } from "./domain.js";
import { HttpError, asyncRoute, data, validate } from "./http.js";

const uuid = z.string().uuid();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Invalid date");
const dateTime = z.string().datetime({ offset: true });
const timeOnly = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:mm");
const text = (max) => z.string().trim().min(1).max(max);

const chargeSchema = z.object({
  bookingId: uuid.nullable().optional(),
  type: z.enum(["service", "additional_work", "cancellation_fee"]),
  description: text(500),
  amountCents: z.number().int().min(0).max(100_000_000),
  chargedOn: dateOnly
}).strict();

const paymentSchema = z.object({
  method: z.enum(["zelle", "venmo", "paypal", "cash", "check"]),
  amountCents: z.number().int().positive().max(100_000_000),
  paidAt: dateTime,
  reference: z.string().trim().max(200).optional()
}).strict();

const tipSchema = z.object({
  amountCents: z.number().int().positive().max(10_000_000),
  source: z.enum(["customer", "employee", "manager"])
}).strict();

const correctionSchema = z.object({
  checkInAt: dateTime.optional(),
  checkOutAt: dateTime.optional(),
  paidMinutes: z.number().int().min(0).max(10_080).optional(),
  reason: text(1000)
}).strict().refine(
  ({ checkInAt, checkOutAt, paidMinutes }) =>
    checkInAt !== undefined || checkOutAt !== undefined || paidMinutes !== undefined,
  { message: "At least one corrected value is required" }
);

const payrollSchema = z.object({ startsOn: dateOnly }).strict();
const payrollListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
}).strict();
const payrollDaySchema = z.object({
  employeeId: uuid,
  workDate: dateOnly,
  checkInTime: timeOnly,
  checkOutTime: timeOnly,
  tipsCents: z.number().int().min(0).max(10_000_000).default(0)
}).strict();
const dailyPaymentsQuery = z.object({ date: dateOnly }).strict();
const paymentDecisionSchema = z.object({
  decision: z.enum(["approved", "declined"]),
  hourlyMinutes: z.number().int().positive().max(1440).optional(),
  paymentMethod: z.enum(["zelle", "venmo", "paypal", "cash", "check"]).optional()
}).strict();
const correctionReasonSchema = z.object({
  reason: text(1000)
}).strict();
const emptySchema = z.object({}).strict();

function asDate(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function apiTimeEntry(row) {
  return {
    id: row.id,
    routeId: row.route_id,
    employeeId: row.employee_id,
    status: row.status,
    checkInAt: row.check_in_at,
    checkOutAt: row.check_out_at,
    paidMinutes: row.paid_minutes,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at
  };
}

function apiPayrollLine(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    weekStartsOn: asDate(row.week_starts_on),
    regularMinutes: Number(row.regular_minutes),
    overtimeMinutes: Number(row.overtime_minutes),
    hourlyRateCents: Number(row.hourly_rate_cents),
    tipsCents: Number(row.tips_cents),
    captainDays: Number(row.captain_days),
    captainReimbursementCents: Number(row.captain_reimbursement_cents),
    grossWagesCents: Number(row.gross_wages_cents)
  };
}

function timeMinute(value) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function minuteTime(value) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function apiPayrollDay(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    workDate: asDate(row.work_date),
    checkInTime: minuteTime(Number(row.check_in_minute)),
    checkOutTime: minuteTime(Number(row.check_out_minute)),
    paidMinutes: Number(row.paid_minutes),
    tipsCents: Number(row.tips_cents)
  };
}

function dailyService(row) {
  const chargePaid = row.charge_status === "paid";
  return {
    bookingId: row.booking_id,
    date: asDate(row.service_date),
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerEmail: row.customer_email,
    serviceName: row.service_name,
    address: [
      row.address_line1,
      row.address_line2,
      row.city,
      row.state,
      row.postal_code
    ].filter(Boolean).join(", "),
    billingType: row.billing_type,
    billingRateCents: row.billing_rate_cents === null
      ? null : Number(row.billing_rate_cents),
    flatAmountCents: Number(row.price_cents),
    hourlyMinutes: row.hourly_minutes === null ? null : Number(row.hourly_minutes),
    amountCents: row.decision_amount_cents === null
      ? (row.billing_type === "flat" ? Number(row.price_cents) : null)
      : Number(row.decision_amount_cents),
    decision: chargePaid ? "approved" : row.decision,
    chargeStatus: row.charge_status,
    paymentMethod: row.payment_method,
    decidedAt: row.decided_at,
    tipId: row.tip_id,
    tipAmountCents: row.tip_amount_cents === null ? null : Number(row.tip_amount_cents),
    tipSource: row.tip_source
  };
}

async function dailyServices(client, organizationId, date, bookingId = null) {
  const params = [organizationId, date];
  const bookingClause = bookingId ? "AND b.id = $3" : "";
  if (bookingId) params.push(bookingId);
  const result = await client.query(
    `SELECT b.id AS booking_id,
            COALESCE(b.service_date, CAST(b.scheduled_start AS date)) AS service_date,
            b.customer_id, b.billing_type, b.billing_rate_cents, b.price_cents,
            c.name AS customer_name, c.phone AS customer_phone,
            c.email AS customer_email, p.address_line1, p.address_line2,
            p.city, p.state, p.postal_code, st.name AS service_name,
            spd.hourly_minutes, spd.amount_cents AS decision_amount_cents,
            spd.decision, spd.decided_at, cc.status AS charge_status,
            pay.method AS payment_method, tip.id AS tip_id,
            tip.amount_cents AS tip_amount_cents, tip.source AS tip_source
     FROM bookings b
     JOIN customers c ON c.id = b.customer_id AND c.organization_id = b.organization_id
     JOIN properties p ON p.id = b.property_id AND p.organization_id = b.organization_id
     JOIN service_types st ON st.id = b.service_type_id
     LEFT JOIN service_payment_decisions spd
       ON spd.booking_id = b.id AND spd.organization_id = b.organization_id
     LEFT JOIN customer_charges cc
       ON cc.booking_id = b.id AND cc.organization_id = b.organization_id
      AND cc.type = 'service'
     LEFT JOIN payments pay ON pay.id = spd.payment_id
     LEFT JOIN tips tip
       ON tip.booking_id = b.id AND tip.organization_id = b.organization_id
     WHERE b.organization_id = $1
       AND COALESCE(b.service_date, CAST(b.scheduled_start AS date)) = $2
       AND b.status NOT IN ('cancelled', 'rescheduled')
       ${bookingClause}
     ORDER BY b.scheduled_start, c.name, b.id`,
    params
  );
  return result.rows.map(dailyService);
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

async function ownedCustomer(client, organizationId, customerId) {
  const result = await client.query(
    "SELECT id, name FROM customers WHERE id = $1 AND organization_id = $2",
    [customerId, organizationId]
  );
  if (!result.rowCount) throw new HttpError(404, "not_found", "Customer not found");
  return result.rows[0];
}

async function applyAvailableCredits(
  client,
  organizationId,
  customerId,
  chargeId,
  outstandingCents
) {
  if (outstandingCents <= 0) return { appliedCents: 0, remainingCents: 0 };
  const credits = await client.query(
    `SELECT cr.id, cr.source_payment_id, cr.remaining_cents
     FROM customer_credits cr
     JOIN payments p
       ON p.id = cr.source_payment_id AND p.organization_id = cr.organization_id
     WHERE cr.organization_id = $1 AND cr.customer_id = $2
       AND cr.remaining_cents > 0 AND p.status = 'recorded'
     ORDER BY cr.created_at, cr.id`,
    [organizationId, customerId]
  );
  let remainingCents = outstandingCents;
  let appliedCents = 0;
  for (const credit of credits.rows) {
    if (!remainingCents) break;
    const amountCents = Math.min(remainingCents, Number(credit.remaining_cents));
    await client.query(
      `INSERT INTO payment_allocations (payment_id, charge_id, amount_cents)
       VALUES ($1, $2, $3)
       ON CONFLICT (payment_id, charge_id) DO UPDATE SET
         amount_cents = payment_allocations.amount_cents + EXCLUDED.amount_cents`,
      [credit.source_payment_id, chargeId, amountCents]
    );
    await client.query(
      `UPDATE customer_credits
       SET remaining_cents = remaining_cents - $3
       WHERE id = $1 AND organization_id = $2`,
      [credit.id, organizationId, amountCents]
    );
    remainingCents -= amountCents;
    appliedCents += amountCents;
  }
  if (!remainingCents) {
    await client.query(
      `UPDATE customer_charges SET status = 'paid'
       WHERE id = $1 AND organization_id = $2`,
      [chargeId, organizationId]
    );
  }
  return { appliedCents, remainingCents };
}

async function payrollPeriod(client, organizationId, id) {
  const result = await client.query(
    `SELECT id, starts_on, ends_on, status, approved_by, approved_at, created_at
     FROM payroll_periods WHERE id = $1 AND organization_id = $2`,
    [id, organizationId]
  );
  if (!result.rowCount) throw new HttpError(404, "not_found", "Payroll period not found");
  return result.rows[0];
}

async function payrollLines(client, organizationId, periodId) {
  const result = await client.query(
    `SELECT pl.*, e.first_name || ' ' || e.last_name AS employee_name
     FROM payroll_lines pl
     JOIN employees e ON e.id = pl.employee_id AND e.organization_id = pl.organization_id
     WHERE pl.payroll_period_id = $1 AND pl.organization_id = $2
     ORDER BY pl.week_starts_on, e.last_name, e.first_name, e.id`,
    [periodId, organizationId]
  );
  return result.rows.map(apiPayrollLine);
}

async function payrollDays(client, organizationId, periodId) {
  const result = await client.query(
    `SELECT *
     FROM payroll_day_entries
     WHERE payroll_period_id = $1 AND organization_id = $2
     ORDER BY work_date, employee_id`,
    [periodId, organizationId]
  );
  return result.rows.map(apiPayrollDay);
}

function periodResponse(period, lines, dayEntries = []) {
  return {
    id: period.id,
    startsOn: asDate(period.starts_on),
    endsOn: asDate(period.ends_on),
    status: period.status,
    approvedBy: period.approved_by,
    approvedAt: period.approved_at,
    createdAt: period.created_at,
    lines,
    dayEntries
  };
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function periodDetails(client, organizationId, id) {
  const period = await payrollPeriod(client, organizationId, id);
  const [lines, dayEntries] = await Promise.all([
    payrollLines(client, organizationId, id),
    payrollDays(client, organizationId, id)
  ]);
  return periodResponse(period, lines, dayEntries);
}

async function recalculatePayroll(client, organizationId, periodId) {
  const period = await payrollPeriod(client, organizationId, periodId);
  const employeeRows = await client.query(
    `SELECT DISTINCT employee_id, hourly_rate_cents
     FROM payroll_lines
     WHERE payroll_period_id = $1 AND organization_id = $2
     ORDER BY employee_id`,
    [periodId, organizationId]
  );
  const dayRows = await client.query(
    `SELECT employee_id, work_date, paid_minutes, tips_cents
     FROM payroll_day_entries
     WHERE payroll_period_id = $1 AND organization_id = $2
     ORDER BY work_date, employee_id`,
    [periodId, organizationId]
  );
  const serviceTipRows = await client.query(
    `SELECT tip.id, tip.amount_cents, ja.employee_id,
            COALESCE(b.service_date, CAST(b.scheduled_start AS date)) AS work_date
     FROM tips tip
     JOIN bookings b
       ON b.id = tip.booking_id AND b.organization_id = tip.organization_id
     JOIN job_assignments ja ON ja.booking_id = b.id
     WHERE tip.organization_id = $1
       AND COALESCE(b.service_date, CAST(b.scheduled_start AS date))
         BETWEEN $2 AND $3
     ORDER BY tip.id, ja.employee_id`,
    [organizationId, period.starts_on, period.ends_on]
  );
  const captainRows = await client.query(
    `SELECT DISTINCT tm.employee_id
     FROM team_members tm
     JOIN teams t ON t.id = tm.team_id
     WHERE t.organization_id = $1 AND tm.is_captain = true
       AND tm.effective_from <= CURRENT_DATE
       AND (tm.effective_to IS NULL OR tm.effective_to >= CURRENT_DATE)`,
    [organizationId]
  );
  const settings = await client.query(
    `SELECT captain_reimbursement_cents
     FROM business_settings WHERE organization_id = $1`,
    [organizationId]
  );
  const employees = employeeRows.rows.map((row) => ({
    id: row.employee_id,
    hourlyRateCents: Number(row.hourly_rate_cents)
  }));
  const entries = dayRows.rows.map((row) => ({
    employeeId: row.employee_id,
    workDate: asDate(row.work_date),
    paidMinutes: Number(row.paid_minutes)
  }));
  for (const employee of employees) {
    entries.push(
      { employeeId: employee.id, workDate: asDate(period.starts_on), paidMinutes: 0 },
      { employeeId: employee.id, workDate: addDays(asDate(period.starts_on), 7), paidMinutes: 0 }
    );
  }
  const captainDays = dayRows.rows
    .filter((day) => captainRows.rows.some(
      (membership) => membership.employee_id === day.employee_id
    ))
    .map((day) => ({ employeeId: day.employee_id, workDate: asDate(day.work_date) }));
  const tips = new Map();
  for (const row of serviceTipRows.rows) {
    const tip = tips.get(row.id) || {
      amountCents: Number(row.amount_cents),
      workDate: asDate(row.work_date),
      employeeIds: []
    };
    tip.employeeIds.push(row.employee_id);
    tips.set(row.id, tip);
  }
  const serviceTipShares = [...tips.values()].flatMap((tip) =>
    splitTip(tip.amountCents, tip.employeeIds).map((share) => ({
      ...share,
      workDate: tip.workDate
    }))
  );
  const calculated = calculatePayroll({
    employees,
    entries,
    tipShares: [
      ...dayRows.rows.map((row) => ({
        employeeId: row.employee_id,
        workDate: asDate(row.work_date),
        amountCents: Number(row.tips_cents)
      })),
      ...serviceTipShares
    ],
    captainDays,
    captainReimbursementCents: Number(settings.rows[0]?.captain_reimbursement_cents ?? 1600)
  });
  for (const line of calculated) {
    await client.query(
      `UPDATE payroll_lines
       SET regular_minutes = $4, overtime_minutes = $5, tips_cents = $6,
           captain_days = $7, captain_reimbursement_cents = $8,
           gross_wages_cents = $9
       WHERE payroll_period_id = $1 AND organization_id = $2
         AND employee_id = $3 AND week_starts_on = $10`,
      [
        periodId, organizationId, line.employeeId, line.regularMinutes,
        line.overtimeMinutes, line.tipsCents, line.captainDays,
        line.captainReimbursementCents, line.grossWagesCents, line.weekStartsOn
      ]
    );
  }
}

async function recalculatePayrollsForBooking(client, organizationId, bookingId) {
  const booking = await client.query(
    `SELECT COALESCE(service_date, CAST(scheduled_start AS date)) AS work_date
     FROM bookings
     WHERE id = $1 AND organization_id = $2`,
    [bookingId, organizationId]
  );
  if (!booking.rowCount) {
    throw new HttpError(404, "not_found", "Booking not found");
  }
  const periods = await client.query(
    `SELECT id FROM payroll_periods
     WHERE organization_id = $1 AND status = 'review'
       AND $2 BETWEEN starts_on AND ends_on`,
    [organizationId, booking.rows[0].work_date]
  );
  for (const period of periods.rows) {
    await recalculatePayroll(client, organizationId, period.id);
  }
}

export function createFinanceRouter({ pool }) {
  const router = Router();
  router.use(requireRole("manager"));

  router.get("/payments/daily", asyncRoute(async (req, res) => {
    const { date } = validate(dailyPaymentsQuery, req.query);
    data(res, {
      date,
      services: await dailyServices(pool, req.auth.organizationId, date)
    });
  }));

  router.post("/payments/daily/:bookingId/decision", asyncRoute(async (req, res) => {
    const bookingId = validate(uuid, req.params.bookingId);
    const input = validate(paymentDecisionSchema, req.body);
    const organizationId = req.auth.organizationId;
    const result = await transaction(pool, async (client) => {
      const lockedBooking = await client.query(
        `SELECT id FROM bookings
         WHERE id = $1 AND organization_id = $2
           AND status NOT IN ('cancelled', 'rescheduled')
         FOR UPDATE`,
        [bookingId, organizationId]
      );
      if (!lockedBooking.rowCount) {
        throw new HttpError(404, "not_found", "Scheduled service not found");
      }
      const bookingResult = await client.query(
        `SELECT b.*, COALESCE(b.service_date, CAST(b.scheduled_start AS date)) AS work_date,
                c.payment_method AS customer_payment_method, st.name AS service_name
         FROM bookings b
         JOIN customers c ON c.id = b.customer_id AND c.organization_id = b.organization_id
         JOIN service_types st ON st.id = b.service_type_id
         WHERE b.id = $1 AND b.organization_id = $2
           AND b.status NOT IN ('cancelled', 'rescheduled')`,
        [bookingId, organizationId]
      );
      if (!bookingResult.rowCount) throw new HttpError(404, "not_found", "Scheduled service not found");
      const booking = bookingResult.rows[0];
      if (booking.billing_type === "hourly" && !input.hourlyMinutes) {
        throw new HttpError(400, "hourly_minutes_required", "Hourly services require the amount of time worked");
      }
      if (booking.billing_type === "hourly" && booking.billing_rate_cents === null) {
        throw new HttpError(409, "hourly_rate_missing", "This client does not have an hourly rate");
      }
      const hourlyMinutes = booking.billing_type === "hourly" ? input.hourlyMinutes : null;
      const amountCents = booking.billing_type === "hourly"
        ? Math.round(Number(booking.billing_rate_cents) * hourlyMinutes / 60)
        : Number(booking.price_cents);
      if (amountCents <= 0) {
        throw new HttpError(409, "charge_amount_missing", "This service needs a positive charge amount");
      }
      const previous = await client.query(
        `SELECT * FROM service_payment_decisions
         WHERE organization_id = $1 AND booking_id = $2`,
        [organizationId, bookingId]
      );
      if (previous.rows[0]?.decision === "approved") {
        throw new HttpError(409, "payment_already_approved", "This service payment is already approved");
      }
      const chargeResult = await client.query(
        `SELECT c.id, c.organization_id, c.customer_id, c.booking_id, c.type,
                c.description, c.amount_cents, c.status, c.charged_on, c.created_at,
                COALESCE(SUM(pa.amount_cents), 0) AS allocated_cents
         FROM customer_charges c
         LEFT JOIN payment_allocations pa
           ON pa.charge_id = c.id AND pa.reversed_at IS NULL
         WHERE c.organization_id = $1 AND c.booking_id = $2 AND c.type = 'service'
         GROUP BY c.id, c.organization_id, c.customer_id, c.booking_id, c.type,
                  c.description, c.amount_cents, c.status, c.charged_on, c.created_at
         ORDER BY c.created_at
         LIMIT 1`,
        [organizationId, bookingId]
      );
      let chargeId = chargeResult.rows[0]?.id;
      let allocatedCents = Number(chargeResult.rows[0]?.allocated_cents || 0);
      if (chargeResult.rowCount) {
        const charge = chargeResult.rows[0];
        if (charge.status === "paid") {
          throw new HttpError(409, "service_already_paid", "This service already has a recorded payment");
        }
        if (allocatedCents > amountCents) {
          throw new HttpError(
            409,
            "service_amount_below_credit",
            "The service amount cannot be less than credit already applied"
          );
        }
        await client.query(
          `UPDATE customer_charges
           SET amount_cents = $3, description = $4, charged_on = $5, status = 'unpaid'
           WHERE id = $1 AND organization_id = $2`,
          [
            chargeId, organizationId, amountCents, booking.service_name,
            asDate(booking.work_date)
          ]
        );
      } else {
        chargeId = crypto.randomUUID();
        await client.query(
          `INSERT INTO customer_charges
           (id, organization_id, customer_id, booking_id, type, description,
            amount_cents, status, charged_on)
           VALUES ($1, $2, $3, $4, 'service', $5, $6, 'unpaid', $7)`,
          [
            chargeId, organizationId, booking.customer_id, bookingId,
            booking.service_name, amountCents, asDate(booking.work_date)
          ]
        );
      }
      const credit = await applyAvailableCredits(
        client,
        organizationId,
        booking.customer_id,
        chargeId,
        amountCents - allocatedCents
      );
      allocatedCents += credit.appliedCents;
      const outstandingCents = amountCents - allocatedCents;
      let paymentId = null;
      let paymentMethod = null;
      if (input.decision === "approved" && outstandingCents > 0) {
        const supportedMethods = new Set(["zelle", "venmo", "paypal", "cash", "check"]);
        paymentMethod = input.paymentMethod
          || (supportedMethods.has(booking.customer_payment_method)
            ? booking.customer_payment_method : "cash");
        paymentId = crypto.randomUUID();
        await client.query(
          `INSERT INTO payments
           (id, organization_id, customer_id, recorded_by, method, amount_cents,
            paid_at, reference)
           VALUES ($1, $2, $3, $4, $5, $6, now(), $7)`,
          [
            paymentId, organizationId, booking.customer_id, req.auth.id,
            paymentMethod, outstandingCents,
            `${booking.service_name} - ${asDate(booking.work_date)}`
          ]
        );
        await client.query(
          `INSERT INTO payment_allocations (payment_id, charge_id, amount_cents)
           VALUES ($1, $2, $3)`,
          [paymentId, chargeId, outstandingCents]
        );
        await client.query(
          `UPDATE customer_charges SET status = 'paid'
           WHERE id = $1 AND organization_id = $2`,
          [chargeId, organizationId]
        );
      }
      const effectiveDecision = outstandingCents === 0 ? "approved" : input.decision;
      const decisionId = previous.rows[0]?.id || crypto.randomUUID();
      await client.query(
        `INSERT INTO service_payment_decisions
         (id, organization_id, booking_id, charge_id, payment_id, decision,
          hourly_minutes, amount_cents, decided_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (organization_id, booking_id) DO UPDATE SET
           charge_id = EXCLUDED.charge_id,
           payment_id = EXCLUDED.payment_id,
           decision = EXCLUDED.decision,
           hourly_minutes = EXCLUDED.hourly_minutes,
           amount_cents = EXCLUDED.amount_cents,
           decided_by = EXCLUDED.decided_by,
           decided_at = now(),
           updated_at = now()`,
        [
          decisionId, organizationId, bookingId, chargeId, paymentId,
          effectiveDecision, hourlyMinutes, amountCents, req.auth.id
        ]
      );
      await recordAudit(client, req.auth, {
        entityType: "service_payment_decision",
        entityId: decisionId,
        action: previous.rowCount ? "update" : "create",
        before: previous.rows[0] || null,
        after: {
          bookingId,
          ...input,
          decision: effectiveDecision,
          hourlyMinutes,
          amountCents,
          creditAppliedCents: credit.appliedCents,
          paymentId
        }
      });
      return {
        date: asDate(booking.work_date),
        service: (await dailyServices(
          client, organizationId, asDate(booking.work_date), bookingId
        ))[0]
      };
    });
    data(res, result);
  }));

  router.get("/payments/records", asyncRoute(async (req, res) => {
    const organizationId = req.auth.organizationId;
    const [payments, declined, credits, declinedAllocations] = await Promise.all([
      pool.query(
        `SELECT p.id, p.customer_id, c.name AS customer_name, p.amount_cents,
                p.method, p.paid_at, p.reference, p.status,
                p.reversed_at, p.reversal_reason, st.name AS service_name,
                COALESCE(b.service_date, CAST(b.scheduled_start AS date)) AS service_date
         FROM payments p
         JOIN customers c ON c.id = p.customer_id AND c.organization_id = p.organization_id
         LEFT JOIN service_payment_decisions spd ON spd.payment_id = p.id
         LEFT JOIN bookings b ON b.id = spd.booking_id
         LEFT JOIN service_types st ON st.id = b.service_type_id
         WHERE p.organization_id = $1
         ORDER BY p.paid_at DESC, p.created_at DESC`,
        [organizationId]
      ),
      pool.query(
        `SELECT ch.id, ch.booking_id, ch.amount_cents, ch.type, ch.description,
                ch.charged_on, c.id AS customer_id, c.name AS customer_name,
                c.phone AS customer_phone, st.name AS service_name,
                COALESCE(b.service_date, CAST(b.scheduled_start AS date)) AS service_date
         FROM customer_charges ch
         JOIN customers c
           ON c.id = ch.customer_id AND c.organization_id = ch.organization_id
         LEFT JOIN bookings b
           ON b.id = ch.booking_id AND b.organization_id = ch.organization_id
         LEFT JOIN service_types st ON st.id = b.service_type_id
         WHERE ch.organization_id = $1 AND ch.status = 'unpaid'
         ORDER BY ch.charged_on DESC, c.name`,
        [organizationId]
      ),
      pool.query(
        `SELECT cr.id, cr.customer_id, c.name AS customer_name,
                cr.amount_cents, cr.remaining_cents, cr.reason, cr.created_at
         FROM customer_credits cr
         JOIN customers c ON c.id = cr.customer_id AND c.organization_id = cr.organization_id
         WHERE cr.organization_id = $1 AND cr.remaining_cents > 0
         ORDER BY cr.created_at DESC`,
        [organizationId]
      ),
      pool.query(
        `SELECT pa.charge_id, COALESCE(SUM(pa.amount_cents), 0) AS allocated_cents
         FROM payment_allocations pa
         JOIN customer_charges ch ON ch.id = pa.charge_id
         WHERE ch.organization_id = $1 AND pa.reversed_at IS NULL
         GROUP BY pa.charge_id`,
        [organizationId]
      )
    ]);
    const allocatedByCharge = new Map(declinedAllocations.rows.map(
      (row) => [row.charge_id, Number(row.allocated_cents)]
    ));
    data(res, {
      payments: payments.rows.map((row) => ({
        id: row.id,
        customerId: row.customer_id,
        customerName: row.customer_name,
        amountCents: Number(row.amount_cents),
        method: row.method,
        paidAt: row.paid_at,
        reference: row.reference,
        status: row.status,
        reversedAt: row.reversed_at,
        reversalReason: row.reversal_reason,
        serviceName: row.service_name,
        serviceDate: row.service_date ? asDate(row.service_date) : null
      })),
      declined: declined.rows.map((row) => ({
        id: row.id,
        bookingId: row.booking_id,
        customerId: row.customer_id,
        customerName: row.customer_name,
        customerPhone: row.customer_phone,
        serviceName: row.service_name,
        serviceDate: row.service_date ? asDate(row.service_date) : null,
        amountCents: Math.max(
          0,
          Number(row.amount_cents) - (allocatedByCharge.get(row.id) || 0)
        ),
        originalAmountCents: Number(row.amount_cents),
        chargeType: row.type,
        description: row.description,
        chargedOn: asDate(row.charged_on)
      })),
      credits: credits.rows.map((row) => ({
        id: row.id,
        customerId: row.customer_id,
        customerName: row.customer_name,
        amountCents: Number(row.amount_cents),
        remainingCents: Number(row.remaining_cents),
        reason: row.reason,
        createdAt: row.created_at
      }))
    });
  }));

  router.get("/payments/overview", asyncRoute(async (req, res) => {
    const organizationId = req.auth.organizationId;
    const [customers, balances, allocations, paymentTotals, creditTotals] = await Promise.all([
      pool.query(
        `SELECT id, name, phone FROM customers
         WHERE organization_id = $1 AND status = 'active'
         ORDER BY name`,
        [organizationId]
      ),
      pool.query(
        `SELECT customer_id, COALESCE(SUM(amount_cents), 0) AS charged_cents
         FROM customer_charges
         WHERE organization_id = $1 AND status NOT IN ('waived', 'credited')
         GROUP BY customer_id`,
        [organizationId]
      ),
      pool.query(
        `SELECT c.customer_id, COALESCE(SUM(pa.amount_cents), 0) AS allocated_cents
         FROM customer_charges c
         JOIN payment_allocations pa
           ON pa.charge_id = c.id AND pa.reversed_at IS NULL
         WHERE c.organization_id = $1 AND c.status NOT IN ('waived', 'credited')
         GROUP BY c.customer_id`,
        [organizationId]
      ),
      pool.query(
        `SELECT customer_id, COALESCE(SUM(amount_cents), 0) AS paid_cents
         FROM payments
         WHERE organization_id = $1 AND status = 'recorded'
         GROUP BY customer_id`,
        [organizationId]
      ),
      pool.query(
        `SELECT customer_id, COALESCE(SUM(remaining_cents), 0) AS credit_cents
         FROM customer_credits
         WHERE organization_id = $1 AND remaining_cents > 0
         GROUP BY customer_id`,
        [organizationId]
      )
    ]);
    const byCustomer = (rows, key) => new Map(rows.map(
      (row) => [row.customer_id, Number(row[key])]
    ));
    const charged = byCustomer(balances.rows, "charged_cents");
    const allocated = byCustomer(allocations.rows, "allocated_cents");
    const paid = byCustomer(paymentTotals.rows, "paid_cents");
    const credit = byCustomer(creditTotals.rows, "credit_cents");
    const rows = customers.rows.map((customer) => {
      const outstandingCents = Math.max(
        0, (charged.get(customer.id) || 0) - (allocated.get(customer.id) || 0)
      );
      const creditCents = credit.get(customer.id) || 0;
      return {
        customerId: customer.id,
        customerName: customer.name,
        phone: customer.phone,
        chargedCents: charged.get(customer.id) || 0,
        paidCents: paid.get(customer.id) || 0,
        outstandingCents,
        creditCents,
        standing: outstandingCents > 0 ? "past_due" : creditCents > 0 ? "credit" : "good"
      };
    });
    data(res, {
      customers: rows,
      totals: {
        chargedCents: rows.reduce((sum, row) => sum + row.chargedCents, 0),
        paidCents: rows.reduce((sum, row) => sum + row.paidCents, 0),
        outstandingCents: rows.reduce((sum, row) => sum + row.outstandingCents, 0),
        creditCents: rows.reduce((sum, row) => sum + row.creditCents, 0)
      }
    });
  }));

  router.get("/customers/:customerId/ledger", asyncRoute(async (req, res) => {
    const customerId = validate(uuid, req.params.customerId);
    const organizationId = req.auth.organizationId;
    const customer = await ownedCustomer(pool, organizationId, customerId);
    const [chargesResult, paymentsResult, creditsResult] = await Promise.all([
      pool.query(
        `SELECT c.id, c.booking_id AS "bookingId", c.type, c.description,
                c.amount_cents AS "amountCents", c.status, c.charged_on AS "chargedOn",
                c.created_at AS "createdAt",
                COALESCE(SUM(pa.amount_cents), 0) AS "paidCents"
         FROM customer_charges c
         LEFT JOIN payment_allocations pa
           ON pa.charge_id = c.id AND pa.reversed_at IS NULL
         WHERE c.organization_id = $1 AND c.customer_id = $2
         GROUP BY c.id, c.booking_id, c.type, c.description, c.amount_cents,
                  c.status, c.charged_on, c.created_at
         ORDER BY c.charged_on, c.created_at, c.id`,
        [organizationId, customerId]
      ),
      pool.query(
        `SELECT id, method, amount_cents AS "amountCents", paid_at AS "paidAt",
                reference, created_at AS "createdAt"
         FROM payments
         WHERE organization_id = $1 AND customer_id = $2 AND status = 'recorded'
         ORDER BY paid_at, created_at, id`,
        [organizationId, customerId]
      ),
      pool.query(
        `SELECT id, source_payment_id AS "sourcePaymentId", amount_cents AS "amountCents",
                remaining_cents AS "remainingCents", reason, created_at AS "createdAt"
         FROM customer_credits
         WHERE organization_id = $1 AND customer_id = $2
         ORDER BY created_at, id`,
        [organizationId, customerId]
      )
    ]);
    const charges = chargesResult.rows.map((charge) => ({
      ...charge,
      amountCents: Number(charge.amountCents),
      paidCents: Number(charge.paidCents),
      outstandingCents: Math.max(0, Number(charge.amountCents) - Number(charge.paidCents))
    }));
    const payments = paymentsResult.rows.map((payment) => ({
      ...payment,
      amountCents: Number(payment.amountCents)
    }));
    const credits = creditsResult.rows.map((credit) => ({
      ...credit,
      amountCents: Number(credit.amountCents),
      remainingCents: Number(credit.remainingCents)
    }));
    data(res, {
      customer,
      charges,
      payments,
      credits,
      totals: {
        chargedCents: charges.reduce((sum, charge) => sum + charge.amountCents, 0),
        paidCents: charges.reduce((sum, charge) => sum + charge.paidCents, 0),
        outstandingCents: charges.reduce((sum, charge) => sum + charge.outstandingCents, 0),
        creditCents: credits.reduce((sum, credit) => sum + credit.remainingCents, 0)
      }
    });
  }));

  router.post("/customers/:customerId/charges", asyncRoute(async (req, res) => {
    const customerId = validate(uuid, req.params.customerId);
    const input = validate(chargeSchema, req.body);
    const organizationId = req.auth.organizationId;
    const charge = await transaction(pool, async (client) => {
      await ownedCustomer(client, organizationId, customerId);
      if (input.bookingId) {
        const booking = await client.query(
          `SELECT id FROM bookings
           WHERE id = $1 AND organization_id = $2 AND customer_id = $3`,
          [input.bookingId, organizationId, customerId]
        );
        if (!booking.rowCount) throw new HttpError(404, "not_found", "Booking not found");
      }
      const id = crypto.randomUUID();
      const result = await client.query(
        `INSERT INTO customer_charges
         (id, organization_id, customer_id, booking_id, type, description,
          amount_cents, status, charged_on)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'unpaid', $8)
         RETURNING *`,
        [
          id, organizationId, customerId, input.bookingId || null, input.type,
          input.description, input.amountCents, input.chargedOn
        ]
      );
      await recordAudit(client, req.auth, {
        entityType: "customer_charge",
        entityId: id,
        action: "create",
        after: input
      });
      const credit = await applyAvailableCredits(
        client,
        organizationId,
        customerId,
        id,
        input.amountCents
      );
      if (credit.appliedCents) {
        await recordAudit(client, req.auth, {
          entityType: "customer_credit",
          entityId: id,
          action: "apply",
          after: { chargeId: id, amountCents: credit.appliedCents }
        });
      }
      const current = await client.query(
        "SELECT * FROM customer_charges WHERE id = $1 AND organization_id = $2",
        [id, organizationId]
      );
      return current.rows[0];
    });
    data(res, {
      charge: {
        id: charge.id,
        customerId: charge.customer_id,
        bookingId: charge.booking_id,
        type: charge.type,
        description: charge.description,
        amountCents: Number(charge.amount_cents),
        status: charge.status,
        chargedOn: asDate(charge.charged_on)
      }
    }, 201);
  }));

  router.post("/customers/:customerId/payments", asyncRoute(async (req, res) => {
    const customerId = validate(uuid, req.params.customerId);
    const input = validate(paymentSchema, req.body);
    const organizationId = req.auth.organizationId;
    const result = await transaction(pool, async (client) => {
      await ownedCustomer(client, organizationId, customerId);
      const paymentId = crypto.randomUUID();
      await client.query(
        `INSERT INTO payments
         (id, organization_id, customer_id, recorded_by, method, amount_cents, paid_at, reference)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          paymentId, organizationId, customerId, req.auth.id, input.method,
          input.amountCents, input.paidAt, input.reference || ""
        ]
      );
      const charges = await client.query(
        `SELECT c.id, c.amount_cents,
                COALESCE(SUM(pa.amount_cents), 0) AS allocated_cents
         FROM customer_charges c
         LEFT JOIN payment_allocations pa
           ON pa.charge_id = c.id AND pa.reversed_at IS NULL
         WHERE c.organization_id = $1 AND c.customer_id = $2 AND c.status = 'unpaid'
         GROUP BY c.id, c.amount_cents, c.charged_on, c.created_at
         ORDER BY c.charged_on, c.created_at, c.id`,
        [organizationId, customerId]
      );
      let remaining = input.amountCents;
      const allocations = [];
      for (const charge of charges.rows) {
        if (!remaining) break;
        const outstanding = Number(charge.amount_cents) - Number(charge.allocated_cents);
        const amountCents = Math.min(remaining, outstanding);
        if (amountCents <= 0) continue;
        await client.query(
          `INSERT INTO payment_allocations (payment_id, charge_id, amount_cents)
           VALUES ($1, $2, $3)`,
          [paymentId, charge.id, amountCents]
        );
        if (amountCents === outstanding) {
          await client.query(
            `UPDATE customer_charges SET status = 'paid'
             WHERE id = $1 AND organization_id = $2`,
            [charge.id, organizationId]
          );
        }
        allocations.push({ chargeId: charge.id, amountCents });
        remaining -= amountCents;
      }
      let credit = null;
      if (remaining > 0) {
        credit = {
          id: crypto.randomUUID(),
          amountCents: remaining,
          remainingCents: remaining,
          reason: "Payment exceeded outstanding charges"
        };
        await client.query(
          `INSERT INTO customer_credits
           (id, organization_id, customer_id, source_payment_id, amount_cents,
            remaining_cents, reason)
           VALUES ($1, $2, $3, $4, $5, $5, $6)`,
          [credit.id, organizationId, customerId, paymentId, remaining, credit.reason]
        );
      }
      await recordAudit(client, req.auth, {
        entityType: "payment",
        entityId: paymentId,
        action: "create",
        after: { ...input, allocations, credit }
      });
      return {
        payment: { id: paymentId, customerId, ...input, reference: input.reference || "" },
        allocations,
        credit
      };
    });
    data(res, result, 201);
  }));

  router.post("/charges/:id/payments", asyncRoute(async (req, res) => {
    const id = validate(uuid, req.params.id);
    const input = validate(paymentSchema, req.body);
    const organizationId = req.auth.organizationId;
    const result = await transaction(pool, async (client) => {
      const chargeResult = await client.query(
        `SELECT * FROM customer_charges
         WHERE id = $1 AND organization_id = $2
         FOR UPDATE`,
        [id, organizationId]
      );
      if (!chargeResult.rowCount) throw new HttpError(404, "not_found", "Charge not found");
      const charge = chargeResult.rows[0];
      if (charge.status !== "unpaid") {
        throw new HttpError(409, "charge_not_payable", "Only an unpaid charge can receive a payment");
      }
      const allocationResult = await client.query(
        `SELECT COALESCE(SUM(amount_cents), 0) AS allocated_cents
         FROM payment_allocations
         WHERE charge_id = $1 AND reversed_at IS NULL`,
        [id]
      );
      const outstandingCents = Number(charge.amount_cents)
        - Number(allocationResult.rows[0].allocated_cents);
      if (outstandingCents <= 0) {
        throw new HttpError(409, "charge_not_payable", "This charge has already been paid");
      }

      const paymentId = crypto.randomUUID();
      await client.query(
        `INSERT INTO payments
         (id, organization_id, customer_id, recorded_by, method, amount_cents, paid_at, reference)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          paymentId, organizationId, charge.customer_id, req.auth.id, input.method,
          input.amountCents, input.paidAt, input.reference || ""
        ]
      );
      const appliedCents = Math.min(input.amountCents, outstandingCents);
      await client.query(
        `INSERT INTO payment_allocations (payment_id, charge_id, amount_cents)
         VALUES ($1, $2, $3)`,
        [paymentId, id, appliedCents]
      );

      const paidInFull = appliedCents === outstandingCents;
      if (paidInFull) {
        await client.query(
          `UPDATE customer_charges SET status = 'paid'
           WHERE id = $1 AND organization_id = $2`,
          [id, organizationId]
        );
        await client.query(
          `UPDATE service_payment_decisions
           SET decision = 'approved', payment_id = $3, decided_by = $4,
               decided_at = now(), updated_at = now()
           WHERE charge_id = $1 AND organization_id = $2`,
          [id, organizationId, paymentId, req.auth.id]
        );
      }

      let credit = null;
      const excessCents = input.amountCents - appliedCents;
      if (excessCents > 0) {
        credit = {
          id: crypto.randomUUID(),
          amountCents: excessCents,
          remainingCents: excessCents,
          reason: "Payment exceeded selected charge"
        };
        await client.query(
          `INSERT INTO customer_credits
           (id, organization_id, customer_id, source_payment_id, amount_cents,
            remaining_cents, reason)
           VALUES ($1, $2, $3, $4, $5, $5, $6)`,
          [
            credit.id, organizationId, charge.customer_id, paymentId,
            excessCents, credit.reason
          ]
        );
      }
      await recordAudit(client, req.auth, {
        entityType: "payment",
        entityId: paymentId,
        action: "create_for_charge",
        after: {
          ...input,
          chargeId: id,
          appliedCents,
          outstandingCents: outstandingCents - appliedCents,
          credit
        }
      });
      return {
        payment: {
          id: paymentId,
          customerId: charge.customer_id,
          ...input,
          reference: input.reference || ""
        },
        allocation: { chargeId: id, amountCents: appliedCents },
        charge: {
          id,
          status: paidInFull ? "paid" : "unpaid",
          amountCents: Number(charge.amount_cents),
          outstandingCents: outstandingCents - appliedCents
        },
        credit
      };
    });
    data(res, result, 201);
  }));

  router.post("/charges/:id/waive", asyncRoute(async (req, res) => {
    const id = validate(uuid, req.params.id);
    const input = validate(correctionReasonSchema, req.body);
    const organizationId = req.auth.organizationId;
    const charge = await transaction(pool, async (client) => {
      const current = await client.query(
        "SELECT * FROM customer_charges WHERE id = $1 AND organization_id = $2",
        [id, organizationId]
      );
      if (!current.rowCount) throw new HttpError(404, "not_found", "Charge not found");
      const before = current.rows[0];
      const allocation = await client.query(
        `SELECT COALESCE(SUM(amount_cents), 0) AS allocated_cents
         FROM payment_allocations
         WHERE charge_id = $1 AND reversed_at IS NULL`,
        [id]
      );
      if (before.status !== "unpaid"
        || Number(allocation.rows[0].allocated_cents) > 0) {
        throw new HttpError(409, "charge_not_waivable", "Only an unpaid charge without a payment can be waived");
      }
      const updated = await client.query(
        `UPDATE customer_charges SET status = 'waived'
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [id, organizationId]
      );
      if (before.type === "cancellation_fee" && before.booking_id) {
        await client.query(
          `UPDATE bookings
           SET cancellation_fee_waived = true, cancellation_waiver_reason = $3,
               updated_at = now()
           WHERE id = $1 AND organization_id = $2`,
          [before.booking_id, organizationId, input.reason]
        );
      }
      await recordAudit(client, req.auth, {
        entityType: "customer_charge",
        entityId: id,
        action: "waive",
        before,
        after: { ...updated.rows[0], reason: input.reason },
        reason: input.reason
      });
      return updated.rows[0];
    });
    data(res, {
      charge: {
        id: charge.id,
        customerId: charge.customer_id,
        bookingId: charge.booking_id,
        status: charge.status
      }
    });
  }));

  router.post("/payments/:id/reverse", asyncRoute(async (req, res) => {
    const id = validate(uuid, req.params.id);
    const input = validate(correctionReasonSchema, req.body);
    const organizationId = req.auth.organizationId;
    const payment = await transaction(pool, async (client) => {
      const current = await client.query(
        "SELECT * FROM payments WHERE id = $1 AND organization_id = $2",
        [id, organizationId]
      );
      if (!current.rowCount) throw new HttpError(404, "not_found", "Payment not found");
      const before = current.rows[0];
      if (before.status === "reversed") {
        throw new HttpError(409, "payment_already_reversed", "This payment is already reversed");
      }
      const allocations = await client.query(
        `SELECT charge_id FROM payment_allocations
         WHERE payment_id = $1 AND reversed_at IS NULL`,
        [id]
      );
      await client.query(
        `UPDATE payment_allocations
         SET reversed_at = now(), reversal_reason = $2
         WHERE payment_id = $1 AND reversed_at IS NULL`,
        [id, input.reason]
      );
      for (const { charge_id: chargeId } of allocations.rows) {
        const remaining = await client.query(
          `SELECT c.amount_cents,
                  COALESCE(SUM(pa.amount_cents), 0) AS allocated_cents
           FROM customer_charges c
           LEFT JOIN payment_allocations pa
             ON pa.charge_id = c.id AND pa.reversed_at IS NULL
           WHERE c.id = $1 AND c.organization_id = $2
           GROUP BY c.id, c.amount_cents`,
          [chargeId, organizationId]
        );
        const paid = Number(remaining.rows[0]?.allocated_cents || 0)
          >= Number(remaining.rows[0]?.amount_cents || 0);
        await client.query(
          `UPDATE customer_charges SET status = $3
           WHERE id = $1 AND organization_id = $2
             AND status NOT IN ('waived', 'credited')`,
          [chargeId, organizationId, paid ? "paid" : "unpaid"]
        );
      }
      await client.query(
        `UPDATE customer_credits
         SET remaining_cents = 0, reason = $3
         WHERE source_payment_id = $1 AND organization_id = $2`,
        [id, organizationId, `Payment reversed: ${input.reason}`]
      );
      await client.query(
        `UPDATE service_payment_decisions
         SET decision = 'declined', payment_id = NULL, updated_at = now()
         WHERE payment_id = $1 AND organization_id = $2`,
        [id, organizationId]
      );
      const updated = await client.query(
        `UPDATE payments
         SET status = 'reversed', reversed_at = now(), reversed_by = $3,
             reversal_reason = $4
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [id, organizationId, req.auth.id, input.reason]
      );
      await recordAudit(client, req.auth, {
        entityType: "payment",
        entityId: id,
        action: "reverse",
        before,
        after: updated.rows[0],
        reason: input.reason
      });
      return updated.rows[0];
    });
    data(res, {
      payment: {
        id: payment.id,
        customerId: payment.customer_id,
        status: payment.status,
        reversedAt: payment.reversed_at,
        reversalReason: payment.reversal_reason
      }
    });
  }));

  router.post("/bookings/:bookingId/tips", asyncRoute(async (req, res) => {
    const bookingId = validate(uuid, req.params.bookingId);
    const input = validate(tipSchema, req.body);
    const organizationId = req.auth.organizationId;
    const result = await transaction(pool, async (client) => {
      const existing = await client.query(
        "SELECT id FROM tips WHERE booking_id = $1 AND organization_id = $2",
        [bookingId, organizationId]
      );
      if (existing.rowCount) {
        throw new HttpError(409, "tip_already_recorded", "This service already has a recorded tip");
      }
      const employees = await client.query(
        `SELECT e.id
         FROM bookings b
         JOIN job_assignments ja ON ja.booking_id = b.id
         JOIN employees e ON e.id = ja.employee_id
         WHERE b.id = $1 AND b.organization_id = $2 AND e.organization_id = $2
         ORDER BY e.id`,
        [bookingId, organizationId]
      );
      if (!employees.rowCount) {
        throw new HttpError(404, "not_found", "Booking or assigned employees not found");
      }
      const id = crypto.randomUUID();
      await client.query(
        `INSERT INTO tips
         (id, organization_id, booking_id, amount_cents, source, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, organizationId, bookingId, input.amountCents, input.source, req.auth.id]
      );
      const shares = splitTip(input.amountCents, employees.rows.map(({ id }) => id));
      await recordAudit(client, req.auth, {
        entityType: "tip",
        entityId: id,
        action: "create",
        after: { bookingId, ...input, shares }
      });
      await recalculatePayrollsForBooking(client, organizationId, bookingId);
      return { tip: { id, bookingId, ...input }, shares };
    });
    data(res, result, 201);
  }));

  router.patch("/bookings/:bookingId/tips/:id", asyncRoute(async (req, res) => {
    const bookingId = validate(uuid, req.params.bookingId);
    const id = validate(uuid, req.params.id);
    const input = validate(tipSchema, req.body);
    const organizationId = req.auth.organizationId;
    const result = await transaction(pool, async (client) => {
      const current = await client.query(
        `SELECT * FROM tips
         WHERE id = $1 AND booking_id = $2 AND organization_id = $3`,
        [id, bookingId, organizationId]
      );
      if (!current.rowCount) throw new HttpError(404, "not_found", "Tip not found");
      const employees = await client.query(
        `SELECT e.id
         FROM job_assignments ja
         JOIN employees e ON e.id = ja.employee_id
         WHERE ja.booking_id = $1 AND e.organization_id = $2
         ORDER BY e.id`,
        [bookingId, organizationId]
      );
      if (!employees.rowCount) {
        throw new HttpError(409, "tip_assignments_required", "Assign employees before recording a tip");
      }
      const updated = await client.query(
        `UPDATE tips SET amount_cents = $4, source = $5
         WHERE id = $1 AND booking_id = $2 AND organization_id = $3
         RETURNING *`,
        [id, bookingId, organizationId, input.amountCents, input.source]
      );
      const shares = splitTip(input.amountCents, employees.rows.map(({ id: employeeId }) => employeeId));
      await recordAudit(client, req.auth, {
        entityType: "tip",
        entityId: id,
        action: "update",
        before: current.rows[0],
        after: { bookingId, ...input, shares }
      });
      await recalculatePayrollsForBooking(client, organizationId, bookingId);
      return { tip: { id, bookingId, ...input }, shares };
    });
    data(res, result);
  }));

  router.post("/time-entries/:id/corrections", asyncRoute(async (req, res) => {
    const id = validate(uuid, req.params.id);
    const input = validate(correctionSchema, req.body);
    const organizationId = req.auth.organizationId;
    const result = await transaction(pool, async (client) => {
      const current = await client.query(
        "SELECT * FROM time_entries WHERE id = $1 AND organization_id = $2",
        [id, organizationId]
      );
      if (!current.rowCount) throw new HttpError(404, "not_found", "Time entry not found");
      const before = current.rows[0];
      const checkInAt = input.checkInAt || before.check_in_at;
      const checkOutAt = input.checkOutAt || before.check_out_at;
      if (!checkOutAt || new Date(checkOutAt) <= new Date(checkInAt)) {
        throw new HttpError(400, "invalid_time", "Check-out must be after check-in");
      }
      const paidMinutes = input.paidMinutes ?? Math.round(
        (new Date(checkOutAt) - new Date(checkInAt)) / 60_000
      );
      const updated = await client.query(
        `UPDATE time_entries
         SET check_in_at = $3, check_out_at = $4, paid_minutes = $5,
             status = 'corrected', approved_by = NULL, approved_at = NULL, updated_at = now()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [id, organizationId, checkInAt, checkOutAt, paidMinutes]
      );
      const after = updated.rows[0];
      await client.query(
        `INSERT INTO time_corrections
         (id, organization_id, time_entry_id, corrected_by, before_data, after_data, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          crypto.randomUUID(), organizationId, id, req.auth.id,
          JSON.stringify(apiTimeEntry(before)), JSON.stringify(apiTimeEntry(after)), input.reason
        ]
      );
      await recordAudit(client, req.auth, {
        entityType: "time_entry",
        entityId: id,
        action: "correct",
        before: apiTimeEntry(before),
        after: apiTimeEntry(after),
        reason: input.reason
      });
      return apiTimeEntry(after);
    });
    data(res, { timeEntry: result });
  }));

  router.post("/time-entries/:id/approve", asyncRoute(async (req, res) => {
    const id = validate(uuid, req.params.id);
    validate(emptySchema, req.body || {});
    const organizationId = req.auth.organizationId;
    const result = await transaction(pool, async (client) => {
      const before = await client.query(
        "SELECT * FROM time_entries WHERE id = $1 AND organization_id = $2",
        [id, organizationId]
      );
      if (!before.rowCount) throw new HttpError(404, "not_found", "Time entry not found");
      if (!["submitted", "corrected"].includes(before.rows[0].status)
        || before.rows[0].paid_minutes === null || !before.rows[0].check_out_at) {
        throw new HttpError(409, "time_entry_not_ready", "Time entry is not ready for approval");
      }
      const updated = await client.query(
        `UPDATE time_entries
         SET status = 'approved', approved_by = $3, approved_at = now(), updated_at = now()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [id, organizationId, req.auth.id]
      );
      await recordAudit(client, req.auth, {
        entityType: "time_entry",
        entityId: id,
        action: "approve",
        before: apiTimeEntry(before.rows[0]),
        after: apiTimeEntry(updated.rows[0])
      });
      return apiTimeEntry(updated.rows[0]);
    });
    data(res, { timeEntry: result });
  }));

  router.get("/payroll-periods", asyncRoute(async (req, res) => {
    const { limit, offset } = validate(payrollListSchema, req.query);
    const organizationId = req.auth.organizationId;
    const result = await pool.query(
      `SELECT *
       FROM payroll_periods
       WHERE organization_id = $1
       ORDER BY starts_on DESC, created_at DESC
       LIMIT $2 OFFSET $3`,
      [organizationId, limit, offset]
    );
    const payrollPeriods = [];
    for (const period of result.rows) {
      const lines = await payrollLines(pool, organizationId, period.id);
      payrollPeriods.push({
        id: period.id,
        startsOn: asDate(period.starts_on),
        endsOn: asDate(period.ends_on),
        status: period.status,
        employeeCount: new Set(
          lines
            .filter((line) => line.regularMinutes + line.overtimeMinutes > 0)
            .map((line) => line.employeeId)
        ).size,
        totalMinutes: lines.reduce(
          (sum, line) => sum + line.regularMinutes + line.overtimeMinutes,
          0
        ),
        grossWagesCents: lines.reduce((sum, line) => sum + line.grossWagesCents, 0)
      });
    }
    data(res, { payrollPeriods });
  }));

  router.post("/payroll-periods", asyncRoute(async (req, res) => {
    const { startsOn } = validate(payrollSchema, req.body);
    if (new Date(`${startsOn}T00:00:00.000Z`).getUTCDay() !== 1) {
      throw new HttpError(400, "invalid_pay_period", "Payroll periods must start on Monday");
    }
    const endsOn = addDays(startsOn, 13);
    const organizationId = req.auth.organizationId;
    const result = await transaction(pool, async (client) => {
      const existing = await client.query(
        `SELECT id FROM payroll_periods
         WHERE organization_id = $1 AND starts_on = $2 AND ends_on = $3`,
        [organizationId, startsOn, endsOn]
      );
      if (existing.rowCount) {
        throw new HttpError(409, "payroll_period_exists", "Payroll period already exists");
      }
      const employees = await client.query(
        `SELECT id, hourly_rate_cents
         FROM employees
         WHERE organization_id = $1 AND active = true
         ORDER BY last_name, first_name, id`,
        [organizationId]
      );
      if (!employees.rowCount) {
        throw new HttpError(409, "no_active_employees", "No active employees exist for this period");
      }
      const periodId = crypto.randomUUID();
      const periodResult = await client.query(
        `INSERT INTO payroll_periods
         (id, organization_id, starts_on, ends_on, status)
         VALUES ($1, $2, $3, $4, 'review')
        RETURNING *`,
        [periodId, organizationId, startsOn, endsOn]
      );
      for (const employee of employees.rows) {
        for (const weekStartsOn of [startsOn, addDays(startsOn, 7)]) {
          await client.query(
            `INSERT INTO payroll_lines
             (id, organization_id, payroll_period_id, employee_id, week_starts_on,
              regular_minutes, overtime_minutes, hourly_rate_cents, tips_cents,
              captain_days, captain_reimbursement_cents, gross_wages_cents)
             VALUES ($1, $2, $3, $4, $5, 0, 0, $6, 0, 0, 0, 0)`,
            [
              crypto.randomUUID(), organizationId, periodId, employee.id,
              weekStartsOn, Number(employee.hourly_rate_cents)
            ]
          );
        }
      }
      await recalculatePayroll(client, organizationId, periodId);
      await recordAudit(client, req.auth, {
        entityType: "payroll_period",
        entityId: periodId,
        action: "generate",
        after: { startsOn, endsOn, employeeCount: employees.rowCount }
      });
      return periodDetails(client, organizationId, periodId);
    });
    data(res, { payrollPeriod: result }, 201);
  }));

  router.get("/payroll-periods/:id", asyncRoute(async (req, res) => {
    const id = validate(uuid, req.params.id);
    const organizationId = req.auth.organizationId;
    data(res, { payrollPeriod: await periodDetails(pool, organizationId, id) });
  }));

  router.post("/payroll-periods/:id/days", asyncRoute(async (req, res) => {
    const id = validate(uuid, req.params.id);
    const input = validate(payrollDaySchema, req.body);
    const checkInMinute = timeMinute(input.checkInTime);
    const checkOutMinute = timeMinute(input.checkOutTime);
    if (checkOutMinute <= checkInMinute) {
      throw new HttpError(400, "invalid_time_range", "Final check-out must be after first check-in");
    }
    const weekday = new Date(`${input.workDate}T00:00:00.000Z`).getUTCDay();
    if (weekday < 1 || weekday > 6) {
      throw new HttpError(400, "invalid_work_date", "Payroll hour entries must be Monday through Saturday");
    }
    const organizationId = req.auth.organizationId;
    const result = await transaction(pool, async (client) => {
      const period = await payrollPeriod(client, organizationId, id);
      if (period.status !== "review") {
        throw new HttpError(409, "payroll_locked", "Approved payroll cannot be changed");
      }
      if (input.workDate < asDate(period.starts_on) || input.workDate > asDate(period.ends_on)) {
        throw new HttpError(400, "invalid_work_date", "Work date must be inside the payroll period");
      }
      const employee = await client.query(
        `SELECT 1 FROM payroll_lines
         WHERE payroll_period_id = $1 AND organization_id = $2 AND employee_id = $3
         LIMIT 1`,
        [id, organizationId, input.employeeId]
      );
      if (!employee.rowCount) {
        throw new HttpError(404, "not_found", "Employee is not part of this payroll period");
      }
      const before = await client.query(
        `SELECT * FROM payroll_day_entries
         WHERE payroll_period_id = $1 AND organization_id = $2
           AND employee_id = $3 AND work_date = $4`,
        [id, organizationId, input.employeeId, input.workDate]
      );
      const entryId = before.rows[0]?.id || crypto.randomUUID();
      const updated = await client.query(
        `INSERT INTO payroll_day_entries
         (id, organization_id, payroll_period_id, employee_id, work_date,
          check_in_minute, check_out_minute, paid_minutes, tips_cents, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (payroll_period_id, employee_id, work_date) DO UPDATE SET
           check_in_minute = EXCLUDED.check_in_minute,
           check_out_minute = EXCLUDED.check_out_minute,
           paid_minutes = EXCLUDED.paid_minutes,
           tips_cents = EXCLUDED.tips_cents,
           recorded_by = EXCLUDED.recorded_by,
           updated_at = now()
         RETURNING *`,
        [
          entryId, organizationId, id, input.employeeId, input.workDate,
          checkInMinute, checkOutMinute, checkOutMinute - checkInMinute,
          input.tipsCents, req.auth.id
        ]
      );
      await recalculatePayroll(client, organizationId, id);
      await recordAudit(client, req.auth, {
        entityType: "payroll_day_entry",
        entityId: entryId,
        action: before.rowCount ? "update" : "create",
        before: before.rowCount ? apiPayrollDay(before.rows[0]) : null,
        after: apiPayrollDay(updated.rows[0])
      });
      return periodDetails(client, organizationId, id);
    });
    data(res, { payrollPeriod: result });
  }));

  router.delete("/payroll-periods/:id/days/:entryId", asyncRoute(async (req, res) => {
    const id = validate(uuid, req.params.id);
    const entryId = validate(uuid, req.params.entryId);
    const organizationId = req.auth.organizationId;
    const result = await transaction(pool, async (client) => {
      const period = await payrollPeriod(client, organizationId, id);
      if (period.status !== "review") {
        throw new HttpError(409, "payroll_locked", "Approved payroll cannot be changed");
      }
      const removed = await client.query(
        `DELETE FROM payroll_day_entries
         WHERE id = $1 AND payroll_period_id = $2 AND organization_id = $3
         RETURNING *`,
        [entryId, id, organizationId]
      );
      if (!removed.rowCount) throw new HttpError(404, "not_found", "Payroll entry not found");
      await recalculatePayroll(client, organizationId, id);
      await recordAudit(client, req.auth, {
        entityType: "payroll_day_entry",
        entityId: entryId,
        action: "delete",
        before: apiPayrollDay(removed.rows[0])
      });
      return periodDetails(client, organizationId, id);
    });
    data(res, { payrollPeriod: result });
  }));

  router.post("/payroll-periods/:id/approve", asyncRoute(async (req, res) => {
    const id = validate(uuid, req.params.id);
    validate(emptySchema, req.body || {});
    const organizationId = req.auth.organizationId;
    const result = await transaction(pool, async (client) => {
      const before = await payrollPeriod(client, organizationId, id);
      if (before.status !== "review") {
        throw new HttpError(409, "payroll_not_in_review", "Only payroll in review can be approved");
      }
      const hours = await client.query(
        `SELECT 1 FROM payroll_day_entries
         WHERE payroll_period_id = $1 AND organization_id = $2
         LIMIT 1`,
        [id, organizationId]
      );
      if (!hours.rowCount) {
        throw new HttpError(409, "no_payroll_hours", "Add employee hours before approving payroll");
      }
      const updated = await client.query(
        `UPDATE payroll_periods
         SET status = 'approved', approved_by = $3, approved_at = now()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [id, organizationId, req.auth.id]
      );
      await recordAudit(client, req.auth, {
        entityType: "payroll_period",
        entityId: id,
        action: "approve",
        before: { status: before.status },
        after: { status: "approved" }
      });
      return periodDetails(client, organizationId, id);
    });
    data(res, { payrollPeriod: result });
  }));

  router.post("/payroll-periods/:id/exports", asyncRoute(async (req, res) => {
    const id = validate(uuid, req.params.id);
    validate(emptySchema, req.body || {});
    const organizationId = req.auth.organizationId;
    const result = await transaction(pool, async (client) => {
      const period = await payrollPeriod(client, organizationId, id);
      if (!["approved", "exported"].includes(period.status)) {
        throw new HttpError(409, "payroll_not_approved", "Payroll must be approved before export");
      }
      const lines = await payrollLines(client, organizationId, id);
      const versionResult = await client.query(
        `SELECT COALESCE(MAX(version), 0) + 1 AS version
         FROM payroll_exports
         WHERE payroll_period_id = $1 AND organization_id = $2`,
        [id, organizationId]
      );
      const version = Number(versionResult.rows[0].version);
      const columns = [
        "employeeId", "employeeName", "totalMinutes", "hourlyRateCents",
        "tipsCents", "captainDays",
        "captainReimbursementCents", "grossWagesCents"
      ];
      const report = new Map();
      for (const line of lines) {
        const row = report.get(line.employeeId) || {
          employeeId: line.employeeId,
          employeeName: line.employeeName,
          totalMinutes: 0,
          hourlyRateCents: line.hourlyRateCents,
          tipsCents: 0,
          captainDays: 0,
          captainReimbursementCents: 0,
          grossWagesCents: 0
        };
        row.totalMinutes += line.regularMinutes + line.overtimeMinutes;
        row.tipsCents += line.tipsCents;
        row.captainDays += line.captainDays;
        row.captainReimbursementCents += line.captainReimbursementCents;
        row.grossWagesCents += line.grossWagesCents;
        report.set(line.employeeId, row);
      }
      const snapshot = {
        period: {
          id,
          startsOn: asDate(period.starts_on),
          endsOn: asDate(period.ends_on)
        },
        columns,
        rows: [...report.values()]
          .filter((line) => line.totalMinutes > 0)
          .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
          .map((line) => columns.map((column) => line[column]))
      };
      const exportId = crypto.randomUUID();
      const exportResult = await client.query(
        `INSERT INTO payroll_exports
         (id, organization_id, payroll_period_id, version, created_by, data)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING created_at`,
        [exportId, organizationId, id, version, req.auth.id, JSON.stringify(snapshot)]
      );
      await client.query(
        `UPDATE payroll_periods SET status = 'exported'
         WHERE id = $1 AND organization_id = $2`,
        [id, organizationId]
      );
      await recordAudit(client, req.auth, {
        entityType: "payroll_export",
        entityId: exportId,
        action: "create",
        after: { payrollPeriodId: id, version }
      });
      return {
        id: exportId,
        payrollPeriodId: id,
        version,
        createdAt: exportResult.rows[0].created_at,
        ...snapshot
      };
    });
    data(res, { payrollExport: result }, 201);
  }));

  return router;
}
