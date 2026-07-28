import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { recordAudit, requireRole } from "./auth.js";
import { withTransaction } from "./db.js";
import { HttpError, asyncRoute, data, validate } from "./http.js";

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rangeSchema = z.object({ from: date, to: date }).strict().refine(
  (value) => value.to >= value.from,
  { message: "to must be on or after from", path: ["to"] }
);
const financialReportSchema = z.object({
  kind: z.enum(["payroll", "monthly", "yearly"]),
  from: date,
  to: date,
  payrollPeriodId: uuid.optional()
}).strict().refine(
  (value) => value.to >= value.from,
  { message: "to must be on or after from", path: ["to"] }
).refine(
  (value) => value.kind !== "payroll" || Boolean(value.payrollPeriodId),
  { message: "Payroll reports require a payroll period", path: ["payrollPeriodId"] }
);
const compareSchema = z.object({
  fromA: date,
  toA: date,
  fromB: date,
  toB: date
}).strict().refine(
  (value) => value.toA >= value.fromA,
  { message: "toA must be on or after fromA", path: ["toA"] }
).refine(
  (value) => value.toB >= value.fromB,
  { message: "toB must be on or after fromB", path: ["toB"] }
);
const expenseSchema = z.object({
  spentOn: date,
  category: z.enum(["supplies", "fuel", "equipment", "software", "other"]),
  description: z.string().trim().min(1).max(500),
  amountCents: z.number().int().positive().max(100_000_000)
}).strict();
const expenseUpdateSchema = expenseSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one field is required"
);
const expenseVoidSchema = z.object({
  reason: z.string().trim().min(1).max(1000)
}).strict();
const settingsSchema = z.object({
  responseTargetMinutes: z.number().int().positive().max(1440).optional(),
  hourlyTeamRateCents: z.number().int().min(0).max(10_000_000).optional(),
  lateCancellationFeeCents: z.number().int().min(0).max(10_000_000).optional(),
  captainReimbursementCents: z.number().int().min(0).max(100_000).optional(),
  routeWarningMinutes: z.number().int().positive().max(1440).optional(),
  routeWarningEndTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  quoteReviewDays: z.number().int().positive().max(365).optional(),
  paymentReminderDays: z.number().int().positive().max(365).optional()
}).strict().refine((value) => Object.keys(value).length > 0, "At least one setting is required");

const settingsColumns = {
  responseTargetMinutes: "response_target_minutes",
  hourlyTeamRateCents: "hourly_team_rate_cents",
  lateCancellationFeeCents: "late_cancellation_fee_cents",
  captainReimbursementCents: "captain_reimbursement_cents",
  routeWarningMinutes: "route_warning_minutes",
  routeWarningEndTime: "route_warning_end_time",
  quoteReviewDays: "quote_review_days",
  paymentReminderDays: "payment_reminder_days"
};

function apiSettings(row) {
  return {
    responseTargetMinutes: row.response_target_minutes,
    hourlyTeamRateCents: row.hourly_team_rate_cents,
    lateCancellationFeeCents: row.late_cancellation_fee_cents,
    captainReimbursementCents: row.captain_reimbursement_cents,
    routeWarningMinutes: row.route_warning_minutes,
    routeWarningEndTime: row.route_warning_end_time,
    quoteReviewDays: row.quote_review_days,
    paymentReminderDays: row.payment_reminder_days
  };
}

async function scalar(pool, sql, values) {
  const result = await pool.query(sql, values);
  return Number(result.rows[0]?.value || 0);
}

function asDate(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function addDays(value, days) {
  const result = new Date(`${value}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function mondayFor(value) {
  const result = new Date(`${value}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() - ((result.getUTCDay() + 6) % 7));
  return result.toISOString().slice(0, 10);
}

async function financialSnapshot(pool, organizationId, from, to, payrollPeriodId = null) {
  const values = [organizationId, from, to];
  const [payments, charges, allocations, operatingExpenses, services] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(amount_cents), 0) AS amount
       FROM payments
       WHERE organization_id = $1 AND status = 'recorded'
         AND CAST(paid_at AS date) BETWEEN $2 AND $3`,
      values
    ),
    pool.query(
      `SELECT COALESCE(SUM(amount_cents), 0) AS amount
       FROM customer_charges
       WHERE organization_id = $1 AND charged_on BETWEEN $2 AND $3
         AND status NOT IN ('waived', 'credited')`,
      values
    ),
    pool.query(
      `SELECT COALESCE(SUM(pa.amount_cents), 0) AS amount
       FROM customer_charges c
       JOIN payment_allocations pa
         ON pa.charge_id = c.id AND pa.reversed_at IS NULL
       WHERE c.organization_id = $1 AND c.charged_on BETWEEN $2 AND $3
         AND c.status NOT IN ('waived', 'credited')`,
      values
    ),
    pool.query(
      `SELECT category, COALESCE(SUM(amount_cents), 0) AS amount_cents
       FROM business_expenses
       WHERE organization_id = $1 AND spent_on BETWEEN $2 AND $3
         AND status = 'recorded'
       GROUP BY category ORDER BY category`,
      values
    ),
    pool.query(
      `SELECT st.name AS service_name, COUNT(*) AS count,
              COALESCE(SUM(cc.amount_cents), 0) AS revenue_cents
       FROM bookings b
       JOIN service_types st ON st.id = b.service_type_id
       LEFT JOIN customer_charges cc
         ON cc.booking_id = b.id AND cc.organization_id = b.organization_id
        AND cc.type = 'service'
       WHERE b.organization_id = $1
         AND COALESCE(b.service_date, CAST(b.scheduled_start AS date)) BETWEEN $2 AND $3
         AND b.status = 'completed'
       GROUP BY st.name ORDER BY count DESC, st.name`,
      values
    )
  ]);
  let wages;
  if (payrollPeriodId) {
    wages = await pool.query(
      `SELECT COALESCE(SUM(pl.gross_wages_cents), 0) AS amount
       FROM payroll_lines pl
       JOIN payroll_periods pp ON pp.id = pl.payroll_period_id
       WHERE pl.organization_id = $1 AND pp.organization_id = $1 AND pp.id = $2`,
      [organizationId, payrollPeriodId]
    );
  } else {
    wages = await pool.query(
      `SELECT COALESCE(SUM(pl.gross_wages_cents), 0) AS amount
       FROM payroll_lines pl
       JOIN payroll_periods pp ON pp.id = pl.payroll_period_id
       WHERE pl.organization_id = $1 AND pp.organization_id = $1
         AND pp.ends_on BETWEEN $2 AND $3
         AND pp.status IN ('approved', 'exported')`,
      values
    );
  }
  const revenueCents = Number(payments.rows[0].amount);
  const chargedCents = Number(charges.rows[0].amount);
  const allocatedCents = Number(allocations.rows[0].amount);
  const outstandingCents = Math.max(0, chargedCents - allocatedCents);
  const wagesCents = Number(wages.rows[0].amount);
  const operatingExpenseBreakdown = operatingExpenses.rows.map((row) => ({
    category: row.category,
    amountCents: Number(row.amount_cents)
  }));
  const operatingExpensesCents = operatingExpenseBreakdown.reduce(
    (sum, item) => sum + item.amountCents, 0
  );
  const expenseBreakdown = [
    ...(wagesCents ? [{ category: "wages", amountCents: wagesCents }] : []),
    ...operatingExpenseBreakdown
  ];
  const serviceRows = services.rows.map((row) => ({
    serviceName: row.service_name,
    count: Number(row.count),
    revenueCents: Number(row.revenue_cents)
  }));
  const serviceCount = serviceRows.reduce((sum, row) => sum + row.count, 0);
  return {
    finances: {
      revenueCents,
      chargedCents,
      wagesCents,
      operatingExpensesCents,
      totalExpensesCents: wagesCents + operatingExpensesCents,
      profitCents: revenueCents - wagesCents - operatingExpensesCents,
      outstandingCents,
      collectionRate: chargedCents ? allocatedCents / chargedCents : 0,
      averageRevenuePerServiceCents: serviceCount
        ? Math.round(revenueCents / serviceCount) : 0
    },
    services: { total: serviceCount, byType: serviceRows },
    expenseBreakdown
  };
}

function comparisonMetric(a, b) {
  const change = b - a;
  return {
    a,
    b,
    change,
    percentChange: a ? change / Math.abs(a) : (b ? 1 : 0)
  };
}

export function createReportingRouter({ pool }) {
  const router = Router();
  router.use(requireRole("manager"));

  router.get("/dashboard", asyncRoute(async (req, res) => {
    const organizationId = req.auth.organizationId;
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
    const weekStart = mondayFor(today);
    const weekEnd = addDays(weekStart, 6);
    const payPeriodResult = await pool.query(
      `SELECT id, starts_on, ends_on, status
       FROM payroll_periods
       WHERE organization_id = $1 AND starts_on <= $2 AND ends_on >= $2
       ORDER BY starts_on DESC LIMIT 1`,
      [organizationId, today]
    );
    const payPeriod = payPeriodResult.rows[0] || null;
    const [
      activeEmployees,
      activeCustomers,
      newLeads,
      overdueLeads,
      todaysBookings,
      unassignedBookings,
      openRoutes,
      unpaidBalanceCents,
      pendingNotifications,
      servicesThisWeek,
      clientCreditsCents,
      revenuePayPeriodCents,
      wagesPayPeriodCents
    ] = await Promise.all([
      scalar(pool, "SELECT COUNT(*) AS value FROM employees WHERE organization_id = $1 AND active = true", [organizationId]),
      scalar(pool, "SELECT COUNT(*) AS value FROM customers WHERE organization_id = $1 AND status = 'active'", [organizationId]),
      scalar(pool, "SELECT COUNT(*) AS value FROM leads WHERE organization_id = $1 AND status = 'new'", [organizationId]),
      scalar(pool, `SELECT COUNT(*) AS value FROM leads
                    WHERE organization_id = $1 AND status = 'new' AND response_due_at < now()`, [organizationId]),
      scalar(pool, `SELECT COUNT(*) AS value FROM bookings
                    WHERE organization_id = $1 AND CAST(scheduled_start AS date) = $2
                      AND status NOT IN ('cancelled', 'rescheduled')`, [organizationId, today]),
      scalar(pool, `SELECT COUNT(*) AS value FROM bookings b
                    LEFT JOIN route_stops rs ON rs.booking_id = b.id
                    WHERE b.organization_id = $1 AND CAST(b.scheduled_start AS date) >= $2
                      AND b.status IN ('requested', 'confirmed')
                      AND rs.booking_id IS NULL`, [organizationId, today]),
      scalar(pool, `SELECT COUNT(*) AS value FROM routes
                    WHERE organization_id = $1 AND status IN ('draft', 'finalized', 'in_progress')`, [organizationId]),
      scalar(pool, `SELECT COALESCE(SUM(amount_cents), 0) AS value FROM customer_charges
                    WHERE organization_id = $1 AND status = 'unpaid'`, [organizationId]),
      scalar(pool, "SELECT COUNT(*) AS value FROM notifications WHERE organization_id = $1 AND status = 'queued'", [organizationId]),
      scalar(pool, `SELECT COUNT(*) AS value FROM bookings
                    WHERE organization_id = $1
                      AND COALESCE(service_date, CAST(scheduled_start AS date)) BETWEEN $2 AND $3
                      AND status NOT IN ('cancelled', 'rescheduled')`,
      [organizationId, weekStart, weekEnd]),
      scalar(pool, `SELECT COALESCE(SUM(amount_cents), 0) AS value
                    FROM customer_charges
                    WHERE organization_id = $1 AND status = 'unpaid'`,
      [organizationId]),
      payPeriod
        ? scalar(pool, `SELECT COALESCE(SUM(amount_cents), 0) AS value FROM payments
                        WHERE organization_id = $1
                          AND status = 'recorded'
                          AND CAST(paid_at AS date) BETWEEN $2 AND $3`,
        [organizationId, asDate(payPeriod.starts_on), asDate(payPeriod.ends_on)])
        : 0,
      payPeriod
        ? scalar(pool, `SELECT COALESCE(SUM(gross_wages_cents), 0) AS value
                        FROM payroll_lines
                        WHERE organization_id = $1 AND payroll_period_id = $2`,
        [organizationId, payPeriod.id])
        : 0
    ]);
    data(res, {
      activeEmployees,
      activeCustomers,
      servicesThisWeek,
      revenuePayPeriodCents,
      wagesPayPeriodCents,
      clientCreditsCents,
      payPeriod: payPeriod ? {
        startsOn: asDate(payPeriod.starts_on),
        endsOn: asDate(payPeriod.ends_on),
        status: payPeriod.status
      } : null,
      newLeads,
      overdueLeads,
      todaysBookings,
      unassignedBookings,
      openRoutes,
      unpaidBalanceCents,
      pendingNotifications
    });
  }));

  router.get("/reports/operations", asyncRoute(async (req, res) => {
    const input = validate(rangeSchema, req.query);
    const values = [req.auth.organizationId, input.from, input.to];
    const bookingCounts = await pool.query(
      `SELECT status, COUNT(*)::integer AS count
       FROM bookings
       WHERE organization_id = $1 AND CAST(scheduled_start AS date) BETWEEN $2 AND $3
       GROUP BY status`,
      values
    );
    const charges = await pool.query(
      `SELECT COALESCE(SUM(amount_cents), 0)::integer AS "chargedCents",
              COUNT(*)::integer AS "chargeCount"
       FROM customer_charges
       WHERE organization_id = $1 AND charged_on BETWEEN $2 AND $3`,
      values
    );
    const payments = await pool.query(
      `SELECT COALESCE(SUM(amount_cents), 0)::integer AS "paidCents",
              COUNT(*)::integer AS "paymentCount"
       FROM payments
       WHERE organization_id = $1 AND status = 'recorded'
         AND CAST(paid_at AS date) BETWEEN $2 AND $3`,
      values
    );
    const labor = await pool.query(
      `SELECT e.id AS "employeeId", e.first_name AS "firstName", e.last_name AS "lastName",
              COALESCE(SUM(te.paid_minutes), 0)::integer AS "paidMinutes"
       FROM employees e
       LEFT JOIN time_entries te ON te.employee_id = e.id
       LEFT JOIN routes r ON r.id = te.route_id AND r.service_date BETWEEN $2 AND $3
       WHERE e.organization_id = $1 AND e.active = true
       GROUP BY e.id, e.first_name, e.last_name
       ORDER BY e.first_name, e.last_name`,
      values
    );
    data(res, {
      range: input,
      bookings: Object.fromEntries(bookingCounts.rows.map((row) => [row.status, Number(row.count)])),
      finances: {
        chargedCents: Number(charges.rows[0].chargedCents),
        chargeCount: Number(charges.rows[0].chargeCount),
        paidCents: Number(payments.rows[0].paidCents),
        paymentCount: Number(payments.rows[0].paymentCount)
      },
      labor: labor.rows.map((row) => ({ ...row, paidMinutes: Number(row.paidMinutes) }))
    });
  }));

  router.get("/reports/financial", asyncRoute(async (req, res) => {
    const input = validate(financialReportSchema, req.query);
    const organizationId = req.auth.organizationId;
    let from = input.from;
    let to = input.to;
    if (input.payrollPeriodId) {
      const payroll = await pool.query(
        `SELECT starts_on, ends_on FROM payroll_periods
         WHERE id = $1 AND organization_id = $2`,
        [input.payrollPeriodId, organizationId]
      );
      if (!payroll.rowCount) throw new HttpError(404, "not_found", "Payroll period not found");
      from = asDate(payroll.rows[0].starts_on);
      to = asDate(payroll.rows[0].ends_on);
    }
    const snapshot = await financialSnapshot(
      pool, organizationId, from, to, input.payrollPeriodId
    );
    let retention = null;
    if (input.kind !== "payroll") {
      const [eligibleResult, retainedResult] = await Promise.all([
        pool.query(
          `SELECT DISTINCT customer_id FROM bookings
           WHERE organization_id = $1
             AND COALESCE(service_date, CAST(scheduled_start AS date)) < $2
             AND status = 'completed'`,
          [organizationId, from]
        ),
        pool.query(
          `SELECT DISTINCT customer_id FROM bookings
           WHERE organization_id = $1
             AND COALESCE(service_date, CAST(scheduled_start AS date)) BETWEEN $2 AND $3
             AND status = 'completed'`,
          [organizationId, from, to]
        )
      ]);
      const eligible = new Set(eligibleResult.rows.map((row) => row.customer_id));
      const retainedCustomers = new Set(
        retainedResult.rows
          .map((row) => row.customer_id)
          .filter((customerId) => eligible.has(customerId))
      ).size;
      retention = {
        eligibleCustomers: eligible.size,
        retainedCustomers,
        retentionRate: eligible.size ? retainedCustomers / eligible.size : 0
      };
    }
    data(res, {
      kind: input.kind,
      range: { from, to },
      ...snapshot,
      retention
    });
  }));

  router.get("/reports/compare", asyncRoute(async (req, res) => {
    const input = validate(compareSchema, req.query);
    const organizationId = req.auth.organizationId;
    const [periodAData, periodBData] = await Promise.all([
      financialSnapshot(pool, organizationId, input.fromA, input.toA),
      financialSnapshot(pool, organizationId, input.fromB, input.toB)
    ]);
    const a = periodAData.finances;
    const b = periodBData.finances;
    const comparison = {
      revenueCents: comparisonMetric(a.revenueCents, b.revenueCents),
      expensesCents: comparisonMetric(a.totalExpensesCents, b.totalExpensesCents),
      profitCents: comparisonMetric(a.profitCents, b.profitCents),
      services: comparisonMetric(periodAData.services.total, periodBData.services.total),
      averageRevenuePerServiceCents: comparisonMetric(
        a.averageRevenuePerServiceCents, b.averageRevenuePerServiceCents
      ),
      collectionRate: comparisonMetric(a.collectionRate, b.collectionRate)
    };
    const revenueChange = comparison.revenueCents.percentChange;
    const trend = revenueChange > 0.05 && comparison.profitCents.change >= 0
      ? "growth"
      : revenueChange < -0.05 || comparison.profitCents.change < 0
        ? "decline"
        : "stable";
    data(res, {
      periodA: { range: { from: input.fromA, to: input.toA }, ...periodAData },
      periodB: { range: { from: input.fromB, to: input.toB }, ...periodBData },
      comparison,
      trend
    });
  }));

  router.get("/expenses", asyncRoute(async (req, res) => {
    const input = validate(rangeSchema, req.query);
    const result = await pool.query(
      `SELECT id, spent_on, category, description, amount_cents, status,
              voided_at, void_reason, created_at
       FROM business_expenses
       WHERE organization_id = $1 AND spent_on BETWEEN $2 AND $3
       ORDER BY spent_on DESC, created_at DESC`,
      [req.auth.organizationId, input.from, input.to]
    );
    data(res, {
      expenses: result.rows.map((row) => ({
        id: row.id,
        spentOn: asDate(row.spent_on),
        category: row.category,
        description: row.description,
        amountCents: Number(row.amount_cents),
        status: row.status,
        voidedAt: row.voided_at,
        voidReason: row.void_reason,
        createdAt: row.created_at
      }))
    });
  }));

  router.post("/expenses", asyncRoute(async (req, res) => {
    const input = validate(expenseSchema, req.body);
    const id = crypto.randomUUID();
    const createdAt = await withTransaction(pool, async (client) => {
      const result = await client.query(
        `INSERT INTO business_expenses
         (id, organization_id, spent_on, category, description, amount_cents, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING created_at`,
        [
          id, req.auth.organizationId, input.spentOn, input.category,
          input.description, input.amountCents, req.auth.id
        ]
      );
      await recordAudit(client, req.auth, {
        entityType: "business_expense",
        entityId: id,
        action: "create",
        after: input
      });
      return result.rows[0].created_at;
    });
    data(res, {
      expense: { id, ...input, status: "recorded", createdAt }
    }, 201);
  }));

  router.patch("/expenses/:id", asyncRoute(async (req, res) => {
    const id = validate(z.string().uuid(), req.params.id);
    const input = validate(expenseUpdateSchema, req.body);
    const expense = await withTransaction(pool, async (client) => {
      const before = await client.query(
        "SELECT * FROM business_expenses WHERE id = $1 AND organization_id = $2",
        [id, req.auth.organizationId]
      );
      if (!before.rowCount) throw new HttpError(404, "not_found", "Expense not found");
      if (before.rows[0].status !== "recorded") {
        throw new HttpError(409, "expense_voided", "A voided expense cannot be edited");
      }
      const columns = {
        spentOn: "spent_on",
        category: "category",
        description: "description",
        amountCents: "amount_cents"
      };
      const entries = Object.entries(input);
      const values = entries.map(([, value]) => value);
      values.push(id, req.auth.organizationId);
      const result = await client.query(
        `UPDATE business_expenses
         SET ${entries.map(([key], index) => `${columns[key]} = $${index + 1}`).join(", ")}
         WHERE id = $${values.length - 1} AND organization_id = $${values.length}
         RETURNING *`,
        values
      );
      await recordAudit(client, req.auth, {
        entityType: "business_expense",
        entityId: id,
        action: "update",
        before: before.rows[0],
        after: result.rows[0]
      });
      return result.rows[0];
    });
    data(res, {
      expense: {
        id: expense.id,
        spentOn: asDate(expense.spent_on),
        category: expense.category,
        description: expense.description,
        amountCents: Number(expense.amount_cents),
        status: expense.status,
        createdAt: expense.created_at
      }
    });
  }));

  router.post("/expenses/:id/void", asyncRoute(async (req, res) => {
    const id = validate(z.string().uuid(), req.params.id);
    const input = validate(expenseVoidSchema, req.body);
    const expense = await withTransaction(pool, async (client) => {
      const before = await client.query(
        "SELECT * FROM business_expenses WHERE id = $1 AND organization_id = $2",
        [id, req.auth.organizationId]
      );
      if (!before.rowCount) throw new HttpError(404, "not_found", "Expense not found");
      if (before.rows[0].status === "voided") {
        throw new HttpError(409, "expense_already_voided", "This expense is already voided");
      }
      const result = await client.query(
        `UPDATE business_expenses
         SET status = 'voided', voided_at = now(), voided_by = $3, void_reason = $4
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [id, req.auth.organizationId, req.auth.id, input.reason]
      );
      await recordAudit(client, req.auth, {
        entityType: "business_expense",
        entityId: id,
        action: "void",
        before: before.rows[0],
        after: result.rows[0],
        reason: input.reason
      });
      return result.rows[0];
    });
    data(res, {
      expense: {
        id: expense.id,
        status: expense.status,
        voidedAt: expense.voided_at,
        voidReason: expense.void_reason
      }
    });
  }));

  router.get("/settings", asyncRoute(async (req, res) => {
    const result = await pool.query(
      "SELECT * FROM business_settings WHERE organization_id = $1",
      [req.auth.organizationId]
    );
    if (!result.rowCount) throw new HttpError(404, "not_found", "Business settings not found");
    data(res, { settings: apiSettings(result.rows[0]) });
  }));

  router.patch("/settings", asyncRoute(async (req, res) => {
    const input = validate(settingsSchema, req.body);
    const settings = await withTransaction(pool, async (client) => {
      const before = await client.query(
        "SELECT * FROM business_settings WHERE organization_id = $1",
        [req.auth.organizationId]
      );
      if (!before.rowCount) {
        throw new HttpError(404, "not_found", "Business settings not found");
      }
      const entries = Object.entries(input);
      const values = entries.map(([, value]) => value);
      values.push(req.auth.organizationId);
      const result = await client.query(
        `UPDATE business_settings
         SET ${entries.map(([key], index) => `${settingsColumns[key]} = $${index + 1}`).join(", ")},
             updated_at = now()
         WHERE organization_id = $${values.length}
         RETURNING *`,
        values
      );
      await recordAudit(client, req.auth, {
        entityType: "business_settings",
        entityId: req.auth.organizationId,
        action: "update",
        before: apiSettings(before.rows[0]),
        after: apiSettings(result.rows[0])
      });
      return apiSettings(result.rows[0]);
    });
    data(res, { settings });
  }));

  return router;
}
