import crypto from "node:crypto";
import express from "express";
import { z } from "zod";
import { recordAudit } from "./auth.js";
import { recurrenceDates, responseDueAt } from "./domain.js";
import { HttpError, asyncRoute, data, validate } from "./http.js";

const uuid = z.string().uuid();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Invalid date");
const instant = z.string().datetime({ offset: true });
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/);
const paging = {
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
};

const leadStatuses = [
  "new", "contacted", "awaiting_information", "quote_ready", "converted",
  "declined", "unresponsive", "duplicate", "not_serviceable"
];
const closedLeadStatuses = new Set(["declined", "unresponsive", "duplicate", "not_serviceable"]);
const quoteStatuses = ["draft", "sent", "approved", "needs_review", "declined", "superseded"];
const bookingStatuses = [
  "requested", "confirmed", "assigned", "in_progress", "completed",
  "rescheduled", "cancelled", "unable_to_complete"
];

const recurrenceRule = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("weekly"),
    intervalWeeks: z.union([z.literal(1), z.literal(2), z.literal(3)])
  }).strict(),
  z.object({
    type: z.literal("monthly"),
    dayOfMonth: z.number().int().min(1).max(31)
  }).strict(),
  z.object({
    type: z.literal("nth_weekday"),
    weekday: z.number().int().min(0).max(6),
    occurrence: z.number().int().min(1).max(5)
  }).strict()
]);

const leadCreate = z.object({
  ownerUserId: uuid.optional(),
  customerId: uuid.nullable().optional(),
  source: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(7).max(30).nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  message: z.string().trim().max(5000).optional(),
  receivedAt: instant.optional()
}).strict().refine(value => value.phone || value.email, {
  message: "A phone number or email address is required"
});

const leadUpdate = z.object({
  ownerUserId: uuid.optional(),
  customerId: uuid.nullable().optional(),
  source: z.string().trim().min(1).max(100).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  phone: z.string().trim().min(7).max(30).nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  message: z.string().trim().max(5000).optional(),
  status: z.enum(leadStatuses).optional(),
  firstRespondedAt: instant.nullable().optional(),
  followUpDueAt: instant.nullable().optional(),
  followUpCompletedAt: instant.nullable().optional(),
  closedReason: z.string().trim().min(1).max(1000).nullable().optional()
}).strict().refine(value => Object.keys(value).length > 0, {
  message: "At least one field is required"
}).refine(value => !value.status || !closedLeadStatuses.has(value.status) || value.closedReason, {
  message: "A closed reason is required for this status",
  path: ["closedReason"]
});

const activityCreate = z.object({
  type: z.enum(["note", "call", "text", "email", "status_change", "follow_up"]),
  body: z.string().trim().min(1).max(5000),
  occurredAt: instant.optional()
}).strict();

const quoteItemInput = z.object({
  serviceTypeId: uuid.nullable().optional(),
  description: z.string().trim().min(1).max(500),
  quantity: z.number().positive().max(1000).default(1),
  unitPriceCents: z.number().int().min(0).max(100_000_000),
  sortOrder: z.number().int().min(0).max(1000).default(0)
}).strict();

const quoteCreate = z.object({
  customerId: uuid,
  propertyId: uuid,
  pricingType: z.enum(["flat", "hourly_team", "inspection"]),
  hourlyRateCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  estimatedHours: z.number().positive().max(1000).nullable().optional(),
  notes: z.string().trim().max(5000).optional(),
  items: z.array(quoteItemInput).max(50).default([])
}).strict().superRefine((value, context) => {
  if (value.pricingType === "hourly_team"
    && (value.hourlyRateCents == null || value.estimatedHours == null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Hourly quotes require an hourly rate and estimated hours"
    });
  }
});

const quoteUpdate = z.object({
  customerId: uuid.optional(),
  propertyId: uuid.optional(),
  pricingType: z.enum(["flat", "hourly_team", "inspection"]).optional(),
  hourlyRateCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  estimatedHours: z.number().positive().max(1000).nullable().optional(),
  notes: z.string().trim().max(5000).optional()
}).strict().refine(value => Object.keys(value).length > 0, {
  message: "At least one field is required"
});

const quoteDecision = z.object({
  replyText: z.string().trim().min(1).max(5000),
  receivedAt: instant.optional()
}).strict();

const recurringBase = z.object({
  customerId: uuid,
  propertyId: uuid,
  serviceTypeId: uuid,
  preferredTeamId: uuid.nullable().optional(),
  quoteId: uuid.nullable().optional(),
  recurrenceRule,
  preferredStartTime: time.nullable().optional(),
  expectedDurationMinutes: z.number().int().min(1).max(24 * 60),
  priceCents: z.number().int().min(0).max(100_000_000),
  billingType: z.enum(["flat", "hourly"]).default("flat"),
  billingRateCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  specialInstructions: z.string().trim().max(5000).optional(),
  startsOn: dateOnly,
  restartOn: dateOnly.nullable().optional()
}).strict();

const recurringCreate = recurringBase.extend({
  status: z.enum(["active", "paused", "ended"]).default("active")
}).strict().superRefine(validateBilling);

const recurringUpdate = recurringBase.partial().extend({
  status: z.enum(["active", "paused", "ended"]).optional()
}).strict().refine(value => Object.keys(value).length > 0, {
  message: "At least one field is required"
}).superRefine(validateBilling);

const bookingFields = z.object({
  customerId: uuid,
  propertyId: uuid,
  serviceTypeId: uuid,
  quoteId: uuid.nullable().optional(),
  recurringServiceId: uuid.nullable().optional(),
  status: z.enum(bookingStatuses).default("requested"),
  scheduledStart: instant,
  expectedDurationMinutes: z.number().int().min(1).max(24 * 60),
  actualDurationMinutes: z.number().int().min(1).max(24 * 60).nullable().optional(),
  priceCents: z.number().int().min(0).max(100_000_000),
  billingType: z.enum(["flat", "hourly"]).default("flat"),
  billingRateCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  customerTimeWindowStart: instant.nullable().optional(),
  customerTimeWindowEnd: instant.nullable().optional(),
  specialRequests: z.string().trim().max(5000).optional(),
  cancellationFeeCents: z.number().int().min(0).max(100_000_000).optional(),
  cancellationFeeWaived: z.boolean().optional(),
  cancellationWaiverReason: z.string().trim().min(1).max(1000).nullable().optional(),
  previousBookingId: uuid.nullable().optional()
}).strict();

const bookingCreate = bookingFields.superRefine(validateBooking);
const bookingUpdate = bookingFields.partial().refine(value => Object.keys(value).length > 0, {
  message: "At least one field is required"
}).superRefine(validateBooking);

function validateBooking(value, context) {
  validateBilling(value, context);
  if (value.customerTimeWindowStart && value.customerTimeWindowEnd
    && new Date(value.customerTimeWindowEnd) <= new Date(value.customerTimeWindowStart)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Customer time window end must be after its start",
      path: ["customerTimeWindowEnd"]
    });
  }
  if (value.cancellationFeeWaived && !value.cancellationWaiverReason) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A waiver reason is required",
      path: ["cancellationWaiverReason"]
    });
  }
}

function validateBilling(value, context) {
  if (value.billingType === "hourly" && value.billingRateCents == null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Hourly services require an hourly rate",
      path: ["billingRateCents"]
    });
  }
}

function apiRow(row) {
  if (!row) return row;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
    value
  ]));
}

function idParam(req, name = "id") {
  return validate(z.object({ [name]: uuid }).strict(), req.params)[name];
}

function asJson(value) {
  return value == null ? value : JSON.stringify(value);
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
    if (error.code === "23503" || error.code === "23514") {
      throw new HttpError(400, "invalid_reference", "The request conflicts with an existing record");
    }
    throw error;
  } finally {
    client.release();
  }
}

async function owned(client, table, id, organizationId, label) {
  const result = await client.query(
    `SELECT * FROM ${table} WHERE id = $1 AND organization_id = $2`,
    [id, organizationId]
  );
  if (!result.rowCount) throw new HttpError(404, "not_found", `${label} not found`);
  return result.rows[0];
}

async function optionalOwned(client, table, id, organizationId, label) {
  if (id != null) await owned(client, table, id, organizationId, label);
}

async function requireCustomerProperty(client, customerId, propertyId, organizationId) {
  const result = await client.query(
    `SELECT p.id
     FROM properties p
     JOIN customers c
       ON c.id = p.customer_id AND c.organization_id = p.organization_id
     WHERE p.id = $1 AND p.customer_id = $2
       AND p.organization_id = $3 AND c.organization_id = $3`,
    [propertyId, customerId, organizationId]
  );
  if (!result.rowCount) {
    throw new HttpError(404, "not_found", "Customer property not found");
  }
}

async function requireManager(client, userId, organizationId) {
  const result = await client.query(
    `SELECT id FROM users
     WHERE id = $1 AND organization_id = $2 AND role = 'manager' AND active = true`,
    [userId, organizationId]
  );
  if (!result.rowCount) throw new HttpError(404, "not_found", "Lead owner not found");
}

async function requireSalesReferences(client, organizationId, input) {
  await requireCustomerProperty(client, input.customerId, input.propertyId, organizationId);
  if (input.serviceTypeId) {
    await owned(client, "service_types", input.serviceTypeId, organizationId, "Service type");
  }
  await optionalOwned(client, "teams", input.preferredTeamId, organizationId, "Preferred team");
  for (const [table, id, label] of [
    ["quotes", input.quoteId, "Quote"],
    ["recurring_services", input.recurringServiceId, "Recurring service"],
    ["bookings", input.previousBookingId, "Previous booking"]
  ]) {
    if (!id) continue;
    const reference = await owned(client, table, id, organizationId, label);
    if (reference.customer_id !== input.customerId || reference.property_id !== input.propertyId) {
      throw new HttpError(
        400, "invalid_reference", `${label} belongs to a different customer or property`
      );
    }
    if (table === "recurring_services"
      && input.serviceTypeId && reference.service_type_id !== input.serviceTypeId) {
      throw new HttpError(
        400, "invalid_reference", "Recurring service uses a different service type"
      );
    }
  }
}

function lineTotal(item) {
  return Math.round(item.quantity * item.unitPriceCents);
}

async function insertQuoteItem(client, organizationId, quoteId, item) {
  await optionalOwned(client, "service_types", item.serviceTypeId, organizationId, "Service type");
  const result = await client.query(
    `INSERT INTO quote_items
     (id, organization_id, quote_id, service_type_id, description, quantity,
      unit_price_cents, line_total_cents, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      crypto.randomUUID(), organizationId, quoteId, item.serviceTypeId || null,
      item.description, item.quantity, item.unitPriceCents, lineTotal(item), item.sortOrder
    ]
  );
  return result.rows[0];
}

async function quoteWithDetails(client, id, organizationId) {
  const quote = await owned(client, "quotes", id, organizationId, "Quote");
  const [items, approvals] = await Promise.all([
    client.query(
      `SELECT * FROM quote_items
       WHERE quote_id = $1 AND organization_id = $2
       ORDER BY sort_order, id`,
      [id, organizationId]
    ),
    client.query(
      `SELECT * FROM quote_approvals
       WHERE quote_id = $1 AND organization_id = $2
       ORDER BY received_at DESC`,
      [id, organizationId]
    )
  ]);
  return {
    quote: apiRow(quote),
    items: items.rows.map(apiRow),
    approvals: approvals.rows.map(apiRow)
  };
}

async function recalculateQuote(client, quoteId, organizationId, invalidate = true) {
  const quote = await owned(client, "quotes", quoteId, organizationId, "Quote");
  if (["declined", "superseded"].includes(quote.status)) {
    throw new HttpError(409, "invalid_state", "This quote can no longer be edited");
  }
  const items = await client.query(
    `SELECT line_total_cents FROM quote_items
     WHERE quote_id = $1 AND organization_id = $2`,
    [quoteId, organizationId]
  );
  const subtotal = items.rowCount
    ? items.rows.reduce((sum, item) => sum + item.line_total_cents, 0)
    : quote.pricing_type === "hourly_team"
      ? Math.round(Number(quote.hourly_rate_cents) * Number(quote.estimated_hours))
      : 0;
  const result = await client.query(
    `UPDATE quotes
     SET subtotal_cents = $1,
         status = CASE
           WHEN $2 AND status IN ('sent', 'approved') THEN 'needs_review'
           ELSE status
         END,
         approved_at = CASE WHEN $2 THEN NULL ELSE approved_at END,
         declined_at = CASE WHEN $2 THEN NULL ELSE declined_at END,
         updated_at = now()
     WHERE id = $3 AND organization_id = $4
     RETURNING *`,
    [subtotal, invalidate, quoteId, organizationId]
  );
  return result.rows[0];
}

function validRecurrence(startsOn, rule, count = 12) {
  try {
    return recurrenceDates(startsOn, rule, count);
  } catch (error) {
    throw new HttpError(400, "validation_error", error.message);
  }
}

function databaseDateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function leadRoutes(router, pool) {
  router.get("/leads", asyncRoute(async (req, res) => {
    const input = validate(z.object({
      ...paging,
      q: z.string().trim().max(200).optional(),
      status: z.enum(leadStatuses).optional(),
      ownerUserId: uuid.optional()
    }).strict(), req.query);
    const params = [req.auth.organizationId];
    const where = ["organization_id = $1"];
    if (input.status) {
      params.push(input.status);
      where.push(`status = $${params.length}`);
    }
    if (input.ownerUserId) {
      params.push(input.ownerUserId);
      where.push(`owner_user_id = $${params.length}`);
    }
    if (input.q) {
      params.push(`${input.q.toLowerCase()}%`);
      where.push(`(
        LOWER(name) LIKE $${params.length}
        OR LOWER(email) LIKE $${params.length}
        OR LOWER(phone) LIKE $${params.length}
      )`);
    }
    const count = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM leads WHERE ${where.join(" AND ")}`,
      params
    );
    const listParams = [...params, input.limit, input.offset];
    const result = await pool.query(
      `SELECT * FROM leads WHERE ${where.join(" AND ")}
       ORDER BY received_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );
    data(res, {
      leads: result.rows.map(apiRow),
      pagination: {
        total: Number(count.rows[0].total),
        limit: input.limit,
        offset: input.offset
      }
    });
  }));

  router.post("/leads", asyncRoute(async (req, res) => {
    const input = validate(leadCreate, req.body);
    const lead = await transaction(pool, async client => {
      const organizationId = req.auth.organizationId;
      const ownerUserId = input.ownerUserId || req.auth.id;
      await requireManager(client, ownerUserId, organizationId);
      await optionalOwned(client, "customers", input.customerId, organizationId, "Customer");
      const settings = await client.query(
        `SELECT o.timezone, COALESCE(s.response_target_minutes, 60) AS response_target_minutes
         FROM organizations o
         LEFT JOIN business_settings s ON s.organization_id = o.id
         WHERE o.id = $1`,
        [organizationId]
      );
      const receivedAt = new Date(input.receivedAt || Date.now());
      const responseDue = responseDueAt(receivedAt, {
        targetMinutes: settings.rows[0].response_target_minutes,
        timeZone: settings.rows[0].timezone
      });
      const result = await client.query(
        `INSERT INTO leads
         (id, organization_id, owner_user_id, customer_id, source, name, phone,
          email, message, status, received_at, response_due_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new', $10, $11)
         RETURNING *`,
        [
          crypto.randomUUID(), organizationId, ownerUserId, input.customerId || null,
          input.source, input.name, input.phone || null, input.email || null,
          input.message || "", receivedAt, responseDue
        ]
      );
      await recordAudit(client, req.auth, {
        entityType: "lead", entityId: result.rows[0].id, action: "create",
        after: apiRow(result.rows[0])
      });
      return result.rows[0];
    });
    data(res, { lead: apiRow(lead) }, 201);
  }));

  router.get("/leads/:id", asyncRoute(async (req, res) => {
    const id = idParam(req);
    const lead = await owned(pool, "leads", id, req.auth.organizationId, "Lead");
    const activities = await pool.query(
      `SELECT * FROM lead_activities
       WHERE lead_id = $1 AND organization_id = $2
       ORDER BY occurred_at DESC`,
      [id, req.auth.organizationId]
    );
    data(res, { lead: apiRow(lead), activities: activities.rows.map(apiRow) });
  }));

  router.patch("/leads/:id", asyncRoute(async (req, res) => {
    const id = idParam(req);
    const input = validate(leadUpdate, req.body);
    const lead = await transaction(pool, async client => {
      const before = await owned(client, "leads", id, req.auth.organizationId, "Lead");
      if (input.ownerUserId) await requireManager(client, input.ownerUserId, req.auth.organizationId);
      if (input.customerId !== undefined) {
        await optionalOwned(client, "customers", input.customerId, req.auth.organizationId, "Customer");
      }
      const phone = input.phone !== undefined ? input.phone : before.phone;
      const email = input.email !== undefined ? input.email : before.email;
      if (!phone && !email) {
        throw new HttpError(
          400, "validation_error", "A phone number or email address is required"
        );
      }
      const columns = {
        ownerUserId: "owner_user_id", customerId: "customer_id", source: "source", name: "name",
        phone: "phone", email: "email", message: "message", status: "status",
        firstRespondedAt: "first_responded_at", followUpDueAt: "follow_up_due_at",
        followUpCompletedAt: "follow_up_completed_at", closedReason: "closed_reason"
      };
      const entries = Object.entries(input);
      const values = entries.map(([, value]) => value);
      const sets = entries.map(([key], index) => `${columns[key]} = $${index + 1}`);
      sets.push("updated_at = now()");
      values.push(id, req.auth.organizationId);
      const result = await client.query(
        `UPDATE leads SET ${sets.join(", ")}
         WHERE id = $${values.length - 1} AND organization_id = $${values.length}
         RETURNING *`,
        values
      );
      await recordAudit(client, req.auth, {
        entityType: "lead", entityId: id, action: "update",
        before: apiRow(before), after: apiRow(result.rows[0])
      });
      return result.rows[0];
    });
    data(res, { lead: apiRow(lead) });
  }));

  router.post("/leads/:id/activities", asyncRoute(async (req, res) => {
    const id = idParam(req);
    const input = validate(activityCreate, req.body);
    const activity = await transaction(pool, async client => {
      const lead = await owned(client, "leads", id, req.auth.organizationId, "Lead");
      const occurredAt = input.occurredAt || new Date();
      const result = await client.query(
        `INSERT INTO lead_activities
         (id, organization_id, lead_id, actor_user_id, type, body, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          crypto.randomUUID(), req.auth.organizationId, id, req.auth.id,
          input.type, input.body, occurredAt
        ]
      );
      if (["call", "text", "email"].includes(input.type) && !lead.first_responded_at) {
        await client.query(
          `UPDATE leads
           SET first_responded_at = $1,
               status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END,
               updated_at = now()
           WHERE id = $2 AND organization_id = $3`,
          [occurredAt, id, req.auth.organizationId]
        );
      }
      if (input.type === "follow_up") {
        await client.query(
          `UPDATE leads SET follow_up_completed_at = $1, updated_at = now()
           WHERE id = $2 AND organization_id = $3`,
          [occurredAt, id, req.auth.organizationId]
        );
      }
      await recordAudit(client, req.auth, {
        entityType: "leadActivity", entityId: result.rows[0].id, action: "create",
        after: apiRow(result.rows[0])
      });
      return result.rows[0];
    });
    data(res, { activity: apiRow(activity) }, 201);
  }));
}

function quoteRoutes(router, pool) {
  router.get("/quotes", asyncRoute(async (req, res) => {
    const input = validate(z.object({
      ...paging,
      status: z.enum(quoteStatuses).optional(),
      customerId: uuid.optional()
    }).strict(), req.query);
    const params = [req.auth.organizationId];
    const where = ["organization_id = $1"];
    if (input.status) {
      params.push(input.status);
      where.push(`status = $${params.length}`);
    }
    if (input.customerId) {
      params.push(input.customerId);
      where.push(`customer_id = $${params.length}`);
    }
    params.push(input.limit, input.offset);
    const result = await pool.query(
      `SELECT * FROM quotes WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    data(res, { quotes: result.rows.map(apiRow) });
  }));

  router.post("/quotes", asyncRoute(async (req, res) => {
    const input = validate(quoteCreate, req.body);
    const id = await transaction(pool, async client => {
      await requireCustomerProperty(
        client, input.customerId, input.propertyId, req.auth.organizationId
      );
      const quoteId = crypto.randomUUID();
      await client.query(
        `INSERT INTO quotes
         (id, organization_id, customer_id, property_id, created_by, pricing_type,
          status, hourly_rate_cents, estimated_hours, subtotal_cents, notes)
         VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7, $8, 0, $9)`,
        [
          quoteId, req.auth.organizationId, input.customerId, input.propertyId,
          req.auth.id, input.pricingType, input.hourlyRateCents ?? null,
          input.estimatedHours ?? null, input.notes || ""
        ]
      );
      for (const item of input.items) {
        await insertQuoteItem(client, req.auth.organizationId, quoteId, item);
      }
      const quote = await recalculateQuote(client, quoteId, req.auth.organizationId, false);
      await recordAudit(client, req.auth, {
        entityType: "quote", entityId: quoteId, action: "create", after: apiRow(quote)
      });
      return quoteId;
    });
    data(res, await quoteWithDetails(pool, id, req.auth.organizationId), 201);
  }));

  router.get("/quotes/:id", asyncRoute(async (req, res) => {
    data(res, await quoteWithDetails(pool, idParam(req), req.auth.organizationId));
  }));

  router.patch("/quotes/:id", asyncRoute(async (req, res) => {
    const id = idParam(req);
    const input = validate(quoteUpdate, req.body);
    await transaction(pool, async client => {
      const before = await owned(client, "quotes", id, req.auth.organizationId, "Quote");
      if (["declined", "superseded"].includes(before.status)) {
        throw new HttpError(409, "invalid_state", "This quote can no longer be edited");
      }
      const merged = {
        customerId: input.customerId || before.customer_id,
        propertyId: input.propertyId || before.property_id,
        pricingType: input.pricingType || before.pricing_type,
        hourlyRateCents: input.hourlyRateCents !== undefined
          ? input.hourlyRateCents : before.hourly_rate_cents,
        estimatedHours: input.estimatedHours !== undefined
          ? input.estimatedHours : Number(before.estimated_hours)
      };
      if (merged.pricingType === "hourly_team"
        && (merged.hourlyRateCents == null || !merged.estimatedHours)) {
        throw new HttpError(
          400, "validation_error", "Hourly quotes require an hourly rate and estimated hours"
        );
      }
      await requireCustomerProperty(
        client, merged.customerId, merged.propertyId, req.auth.organizationId
      );
      const columns = {
        customerId: "customer_id", propertyId: "property_id", pricingType: "pricing_type",
        hourlyRateCents: "hourly_rate_cents", estimatedHours: "estimated_hours", notes: "notes"
      };
      const entries = Object.entries(input);
      const values = entries.map(([, value]) => value);
      const sets = entries.map(([key], index) => `${columns[key]} = $${index + 1}`);
      sets.push("updated_at = now()");
      values.push(id, req.auth.organizationId);
      await client.query(
        `UPDATE quotes SET ${sets.join(", ")}
         WHERE id = $${values.length - 1} AND organization_id = $${values.length}`,
        values
      );
      const after = await recalculateQuote(client, id, req.auth.organizationId);
      await recordAudit(client, req.auth, {
        entityType: "quote", entityId: id, action: "update",
        before: apiRow(before), after: apiRow(after)
      });
    });
    data(res, await quoteWithDetails(pool, id, req.auth.organizationId));
  }));

  router.post("/quotes/:id/items", asyncRoute(async (req, res) => {
    const id = idParam(req);
    const input = validate(quoteItemInput, req.body);
    const item = await transaction(pool, async client => {
      await owned(client, "quotes", id, req.auth.organizationId, "Quote");
      const created = await insertQuoteItem(client, req.auth.organizationId, id, input);
      await recalculateQuote(client, id, req.auth.organizationId);
      await recordAudit(client, req.auth, {
        entityType: "quoteItem", entityId: created.id, action: "create", after: apiRow(created)
      });
      return created;
    });
    data(res, { item: apiRow(item) }, 201);
  }));

  router.patch("/quotes/:quoteId/items/:itemId", asyncRoute(async (req, res) => {
    const params = validate(z.object({ quoteId: uuid, itemId: uuid }).strict(), req.params);
    const input = validate(quoteItemInput.partial().refine(
      value => Object.keys(value).length > 0,
      "At least one field is required"
    ), req.body);
    const item = await transaction(pool, async client => {
      await owned(client, "quotes", params.quoteId, req.auth.organizationId, "Quote");
      const before = await owned(client, "quote_items", params.itemId, req.auth.organizationId, "Quote item");
      if (before.quote_id !== params.quoteId) {
        throw new HttpError(404, "not_found", "Quote item not found");
      }
      await optionalOwned(
        client, "service_types", input.serviceTypeId, req.auth.organizationId, "Service type"
      );
      const merged = {
        quantity: input.quantity ?? Number(before.quantity),
        unitPriceCents: input.unitPriceCents ?? before.unit_price_cents
      };
      const columns = {
        serviceTypeId: "service_type_id", description: "description", quantity: "quantity",
        unitPriceCents: "unit_price_cents", sortOrder: "sort_order"
      };
      const entries = Object.entries(input);
      const values = entries.map(([, value]) => value);
      const sets = entries.map(([key], index) => `${columns[key]} = $${index + 1}`);
      sets.push(`line_total_cents = $${values.length + 1}`);
      values.push(lineTotal(merged), params.itemId, req.auth.organizationId);
      const result = await client.query(
        `UPDATE quote_items SET ${sets.join(", ")}
         WHERE id = $${values.length - 1} AND organization_id = $${values.length}
         RETURNING *`,
        values
      );
      await recalculateQuote(client, params.quoteId, req.auth.organizationId);
      await recordAudit(client, req.auth, {
        entityType: "quoteItem", entityId: params.itemId, action: "update",
        before: apiRow(before), after: apiRow(result.rows[0])
      });
      return result.rows[0];
    });
    data(res, { item: apiRow(item) });
  }));

  router.delete("/quotes/:quoteId/items/:itemId", asyncRoute(async (req, res) => {
    const params = validate(z.object({ quoteId: uuid, itemId: uuid }).strict(), req.params);
    await transaction(pool, async client => {
      await owned(client, "quotes", params.quoteId, req.auth.organizationId, "Quote");
      const before = await owned(client, "quote_items", params.itemId, req.auth.organizationId, "Quote item");
      if (before.quote_id !== params.quoteId) {
        throw new HttpError(404, "not_found", "Quote item not found");
      }
      await client.query(
        "DELETE FROM quote_items WHERE id = $1 AND organization_id = $2",
        [params.itemId, req.auth.organizationId]
      );
      await recalculateQuote(client, params.quoteId, req.auth.organizationId);
      await recordAudit(client, req.auth, {
        entityType: "quoteItem", entityId: params.itemId, action: "delete", before: apiRow(before)
      });
    });
    data(res, { deleted: true });
  }));

  router.post("/quotes/:id/send", asyncRoute(async (req, res) => {
    const id = idParam(req);
    validate(z.object({}).strict(), req.body || {});
    const quote = await transaction(pool, async client => {
      const before = await owned(client, "quotes", id, req.auth.organizationId, "Quote");
      if (!["draft", "needs_review"].includes(before.status)) {
        throw new HttpError(409, "invalid_state", "Only draft or reviewed quotes can be sent");
      }
      const result = await client.query(
        `UPDATE quotes
         SET status = 'sent', sent_at = now(),
             follow_up_due_at = now() + interval '2 days', updated_at = now()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [id, req.auth.organizationId]
      );
      await recordAudit(client, req.auth, {
        entityType: "quote", entityId: id, action: "send",
        before: apiRow(before), after: apiRow(result.rows[0])
      });
      return result.rows[0];
    });
    data(res, { quote: apiRow(quote) });
  }));

  for (const [path, approved, status] of [
    ["approve", true, "approved"],
    ["decline", false, "declined"]
  ]) {
    router.post(`/quotes/:id/${path}`, asyncRoute(async (req, res) => {
      const id = idParam(req);
      const input = validate(quoteDecision, req.body);
      const result = await transaction(pool, async client => {
        const before = await owned(client, "quotes", id, req.auth.organizationId, "Quote");
        if (before.status !== "sent") {
          throw new HttpError(409, "invalid_state", "Only a sent quote can receive a decision");
        }
        const approval = await client.query(
          `INSERT INTO quote_approvals
           (id, organization_id, quote_id, recorded_by, reply_text, approved, received_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            crypto.randomUUID(), req.auth.organizationId, id, req.auth.id,
            input.replyText, approved, input.receivedAt || new Date()
          ]
        );
        const quote = await client.query(
          `UPDATE quotes
           SET status = $1,
               approved_at = CASE WHEN $2 THEN now() ELSE NULL END,
               declined_at = CASE WHEN $2 THEN NULL ELSE now() END,
               follow_up_completed_at = now(), updated_at = now()
           WHERE id = $3 AND organization_id = $4
           RETURNING *`,
          [status, approved, id, req.auth.organizationId]
        );
        await recordAudit(client, req.auth, {
          entityType: "quote", entityId: id, action: status,
          before: apiRow(before), after: apiRow(quote.rows[0])
        });
        return { quote: apiRow(quote.rows[0]), approval: apiRow(approval.rows[0]) };
      });
      data(res, result);
    }));
  }
}

function recurringRoutes(router, pool) {
  router.get("/recurring-services", asyncRoute(async (req, res) => {
    const input = validate(z.object({
      ...paging,
      status: z.enum(["active", "paused", "ended"]).optional(),
      customerId: uuid.optional()
    }).strict(), req.query);
    const params = [req.auth.organizationId];
    const where = ["organization_id = $1"];
    if (input.status) {
      params.push(input.status);
      where.push(`status = $${params.length}`);
    }
    if (input.customerId) {
      params.push(input.customerId);
      where.push(`customer_id = $${params.length}`);
    }
    params.push(input.limit, input.offset);
    const result = await pool.query(
      `SELECT * FROM recurring_services WHERE ${where.join(" AND ")}
       ORDER BY starts_on, created_at LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    data(res, { recurringServices: result.rows.map(apiRow) });
  }));

  router.post("/recurring-services", asyncRoute(async (req, res) => {
    const input = validate(recurringCreate, req.body);
    const nextDates = validRecurrence(input.startsOn, input.recurrenceRule);
    const recurring = await transaction(pool, async client => {
      await requireSalesReferences(client, req.auth.organizationId, input);
      const result = await client.query(
        `INSERT INTO recurring_services
         (id, organization_id, customer_id, property_id, service_type_id,
          preferred_team_id, quote_id, status, recurrence_rule, preferred_start_time,
          expected_duration_minutes, price_cents, billing_type, billing_rate_cents,
          special_instructions, starts_on, paused_at, restart_on, ended_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                 $14, $15, $16, CASE WHEN $8 = 'paused' THEN now() ELSE NULL END, $17,
                 CASE WHEN $8 = 'ended' THEN now() ELSE NULL END)
         RETURNING *`,
        [
          crypto.randomUUID(), req.auth.organizationId, input.customerId, input.propertyId,
          input.serviceTypeId, input.preferredTeamId || null, input.quoteId || null,
          input.status, asJson(input.recurrenceRule), input.preferredStartTime || null,
          input.expectedDurationMinutes, input.priceCents, input.billingType,
          input.billingRateCents ?? null, input.specialInstructions || "",
          input.startsOn, input.restartOn || null
        ]
      );
      await recordAudit(client, req.auth, {
        entityType: "recurringService", entityId: result.rows[0].id, action: "create",
        after: apiRow(result.rows[0])
      });
      return result.rows[0];
    });
    data(res, { recurringService: apiRow(recurring), nextDates }, 201);
  }));

  router.get("/recurring-services/:id", asyncRoute(async (req, res) => {
    const recurring = await owned(
      pool, "recurring_services", idParam(req), req.auth.organizationId, "Recurring service"
    );
    data(res, {
      recurringService: apiRow(recurring),
      nextDates: validRecurrence(
        databaseDateOnly(recurring.starts_on), recurring.recurrence_rule, 12
      )
    });
  }));

  router.patch("/recurring-services/:id", asyncRoute(async (req, res) => {
    const id = idParam(req);
    const input = validate(recurringUpdate, req.body);
    const recurring = await transaction(pool, async client => {
      const before = await owned(
        client, "recurring_services", id, req.auth.organizationId, "Recurring service"
      );
      const merged = {
        customerId: input.customerId || before.customer_id,
        propertyId: input.propertyId || before.property_id,
        serviceTypeId: input.serviceTypeId || before.service_type_id,
        preferredTeamId: input.preferredTeamId !== undefined
          ? input.preferredTeamId : before.preferred_team_id,
        quoteId: input.quoteId !== undefined ? input.quoteId : before.quote_id,
        recurrenceRule: input.recurrenceRule || before.recurrence_rule,
        startsOn: input.startsOn || databaseDateOnly(before.starts_on),
        billingType: input.billingType || before.billing_type,
        billingRateCents: input.billingRateCents !== undefined
          ? input.billingRateCents : before.billing_rate_cents
      };
      validRecurrence(merged.startsOn, merged.recurrenceRule, 1);
      if (merged.billingType === "hourly" && merged.billingRateCents == null) {
        throw new HttpError(400, "validation_error", "Hourly services require an hourly rate");
      }
      await requireSalesReferences(client, req.auth.organizationId, merged);
      const columns = {
        customerId: "customer_id", propertyId: "property_id", serviceTypeId: "service_type_id",
        preferredTeamId: "preferred_team_id", quoteId: "quote_id",
        recurrenceRule: "recurrence_rule", preferredStartTime: "preferred_start_time",
        expectedDurationMinutes: "expected_duration_minutes", priceCents: "price_cents",
        billingType: "billing_type", billingRateCents: "billing_rate_cents",
        specialInstructions: "special_instructions",
        startsOn: "starts_on", restartOn: "restart_on", status: "status"
      };
      const entries = Object.entries(input);
      const values = entries.map(([key, value]) => key === "recurrenceRule" ? asJson(value) : value);
      const sets = entries.map(([key], index) => `${columns[key]} = $${index + 1}`);
      if (input.status) {
        values.push(input.status);
        sets.push(`paused_at = CASE WHEN $${values.length} = 'paused' THEN now() ELSE NULL END`);
        sets.push(`ended_at = CASE WHEN $${values.length} = 'ended' THEN now() ELSE NULL END`);
      }
      sets.push("updated_at = now()");
      values.push(id, req.auth.organizationId);
      const result = await client.query(
        `UPDATE recurring_services SET ${sets.join(", ")}
         WHERE id = $${values.length - 1} AND organization_id = $${values.length}
         RETURNING *`,
        values
      );
      await recordAudit(client, req.auth, {
        entityType: "recurringService", entityId: id, action: "update",
        before: apiRow(before), after: apiRow(result.rows[0])
      });
      return result.rows[0];
    });
    data(res, {
      recurringService: apiRow(recurring),
      nextDates: validRecurrence(
        databaseDateOnly(recurring.starts_on), recurring.recurrence_rule, 12
      )
    });
  }));
}

function bookingRoutes(router, pool) {
  router.get("/bookings", asyncRoute(async (req, res) => {
    const input = validate(z.object({
      ...paging,
      status: z.enum(bookingStatuses).optional(),
      customerId: uuid.optional(),
      from: instant.optional(),
      to: instant.optional()
    }).strict().refine(value => !value.from || !value.to || new Date(value.to) > new Date(value.from), {
      message: "The end of the booking range must be after the start",
      path: ["to"]
    }), req.query);
    const params = [req.auth.organizationId];
    const where = ["organization_id = $1"];
    for (const [key, column, operator] of [
      ["status", "status", "="], ["customerId", "customer_id", "="],
      ["from", "scheduled_start", ">="], ["to", "scheduled_start", "<"]
    ]) {
      if (input[key] !== undefined) {
        params.push(input[key]);
        where.push(`${column} ${operator} $${params.length}`);
      }
    }
    params.push(input.limit, input.offset);
    const result = await pool.query(
      `SELECT * FROM bookings WHERE ${where.join(" AND ")}
       ORDER BY scheduled_start LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    data(res, { bookings: result.rows.map(apiRow) });
  }));

  router.post("/bookings", asyncRoute(async (req, res) => {
    const input = validate(bookingCreate, req.body);
    const booking = await transaction(pool, async client => {
      await requireSalesReferences(client, req.auth.organizationId, input);
      const result = await client.query(
        `INSERT INTO bookings
         (id, organization_id, customer_id, property_id, service_type_id, quote_id,
          recurring_service_id, status, scheduled_start, expected_duration_minutes,
          actual_duration_minutes, price_cents, service_date, recurrence_due_date,
          billing_type, billing_rate_cents, customer_time_window_start,
          customer_time_window_end, special_requests, cancellation_fee_cents,
          cancellation_fee_waived, cancellation_waiver_reason, previous_booking_id, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                 $14, $15, $16, $17, $18, $19, $20, $21, $22, $23,
                 CASE WHEN $8 = 'completed' THEN now() ELSE NULL END)
         RETURNING *`,
        [
          crypto.randomUUID(), req.auth.organizationId, input.customerId, input.propertyId,
          input.serviceTypeId, input.quoteId || null, input.recurringServiceId || null,
          input.status, input.scheduledStart, input.expectedDurationMinutes,
          input.actualDurationMinutes || null, input.priceCents,
          input.scheduledStart.slice(0, 10),
          input.recurringServiceId ? input.scheduledStart.slice(0, 10) : null,
          input.billingType, input.billingRateCents ?? null,
          input.customerTimeWindowStart || null, input.customerTimeWindowEnd || null,
          input.specialRequests || "", input.cancellationFeeCents || 0,
          input.cancellationFeeWaived || false, input.cancellationWaiverReason || null,
          input.previousBookingId || null
        ]
      );
      await recordAudit(client, req.auth, {
        entityType: "booking", entityId: result.rows[0].id, action: "create",
        after: apiRow(result.rows[0])
      });
      return result.rows[0];
    });
    data(res, { booking: apiRow(booking) }, 201);
  }));

  router.get("/bookings/:id", asyncRoute(async (req, res) => {
    const booking = await owned(
      pool, "bookings", idParam(req), req.auth.organizationId, "Booking"
    );
    data(res, { booking: apiRow(booking) });
  }));

  router.patch("/bookings/:id", asyncRoute(async (req, res) => {
    const id = idParam(req);
    const input = validate(bookingUpdate, req.body);
    const booking = await transaction(pool, async client => {
      const before = await owned(client, "bookings", id, req.auth.organizationId, "Booking");
      const merged = {
        customerId: input.customerId || before.customer_id,
        propertyId: input.propertyId || before.property_id,
        serviceTypeId: input.serviceTypeId || before.service_type_id,
        quoteId: input.quoteId !== undefined ? input.quoteId : before.quote_id,
        recurringServiceId: input.recurringServiceId !== undefined
          ? input.recurringServiceId : before.recurring_service_id,
        previousBookingId: input.previousBookingId !== undefined
          ? input.previousBookingId : before.previous_booking_id,
        billingType: input.billingType || before.billing_type,
        billingRateCents: input.billingRateCents !== undefined
          ? input.billingRateCents : before.billing_rate_cents
      };
      await requireSalesReferences(client, req.auth.organizationId, merged);
      if (merged.billingType === "hourly" && merged.billingRateCents == null) {
        throw new HttpError(400, "validation_error", "Hourly services require an hourly rate");
      }
      const windowStart = input.customerTimeWindowStart !== undefined
        ? input.customerTimeWindowStart : before.customer_time_window_start;
      const windowEnd = input.customerTimeWindowEnd !== undefined
        ? input.customerTimeWindowEnd : before.customer_time_window_end;
      if (windowStart && windowEnd && new Date(windowEnd) <= new Date(windowStart)) {
        throw new HttpError(
          400, "validation_error", "Customer time window end must be after its start"
        );
      }
      const waived = input.cancellationFeeWaived !== undefined
        ? input.cancellationFeeWaived : before.cancellation_fee_waived;
      const reason = input.cancellationWaiverReason !== undefined
        ? input.cancellationWaiverReason : before.cancellation_waiver_reason;
      if (waived && !reason) {
        throw new HttpError(400, "validation_error", "A waiver reason is required");
      }
      const columns = {
        customerId: "customer_id", propertyId: "property_id", serviceTypeId: "service_type_id",
        quoteId: "quote_id", recurringServiceId: "recurring_service_id", status: "status",
        scheduledStart: "scheduled_start", expectedDurationMinutes: "expected_duration_minutes",
        actualDurationMinutes: "actual_duration_minutes", priceCents: "price_cents",
        billingType: "billing_type", billingRateCents: "billing_rate_cents",
        customerTimeWindowStart: "customer_time_window_start",
        customerTimeWindowEnd: "customer_time_window_end", specialRequests: "special_requests",
        cancellationFeeCents: "cancellation_fee_cents",
        cancellationFeeWaived: "cancellation_fee_waived",
        cancellationWaiverReason: "cancellation_waiver_reason",
        previousBookingId: "previous_booking_id"
      };
      const entries = Object.entries(input);
      const values = entries.map(([, value]) => value);
      const sets = entries.map(([key], index) => `${columns[key]} = $${index + 1}`);
      if (input.scheduledStart) {
        values.push(input.scheduledStart.slice(0, 10));
        sets.push(`service_date = $${values.length}`);
      }
      if (input.status) {
        values.push(input.status);
        sets.push(`completed_at = CASE WHEN $${values.length} = 'completed' THEN now() ELSE NULL END`);
      }
      sets.push("updated_at = now()");
      values.push(id, req.auth.organizationId);
      const result = await client.query(
        `UPDATE bookings SET ${sets.join(", ")}
         WHERE id = $${values.length - 1} AND organization_id = $${values.length}
         RETURNING *`,
        values
      );
      await recordAudit(client, req.auth, {
        entityType: "booking", entityId: id, action: "update",
        before: apiRow(before), after: apiRow(result.rows[0])
      });
      return result.rows[0];
    });
    data(res, { booking: apiRow(booking) });
  }));
}

export function createSalesRouter({ pool }) {
  if (!pool) throw new Error("pool is required");
  const router = express.Router();
  leadRoutes(router, pool);
  quoteRoutes(router, pool);
  recurringRoutes(router, pool);
  bookingRoutes(router, pool);
  return router;
}
