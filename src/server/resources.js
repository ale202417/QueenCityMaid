import crypto from "node:crypto";
import express from "express";
import { z } from "zod";
import { recordAudit, requireRole } from "./auth.js";
import { HttpError, asyncRoute, data, validate } from "./http.js";

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const dateTime = z.string().datetime({ offset: true });
const text = length => z.string().trim().min(1).max(length);
const nullableText = length => z.string().trim().max(length).nullable();
const queryBoolean = z.enum(["true", "false"]).transform(value => value === "true");
const paging = {
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
};
const searchQuery = z.string().trim().max(200).optional();
const customerStatus = z.enum(["lead", "active", "paused", "inactive", "cancelled"]);

const customerBase = z.object({
  type: z.enum(["residential", "commercial", "realtor"]),
  name: text(200),
  email: z.string().trim().email().max(254).nullable().optional(),
  phone: text(30),
  preferredChannel: text(40).optional(),
  serviceFrequency: z.enum(["weekly", "biweekly", "monthly", "other"]).nullable().optional(),
  paymentMethod: z.enum(["zelle", "venmo", "paypal", "cash", "check", "other"]).nullable().optional(),
  status: z.enum(["lead", "active", "paused", "inactive"]).optional(),
  internalNotes: z.string().max(5000).optional()
}).strict();

const propertyBase = z.object({
  customerId: uuid,
  label: text(100).optional(),
  addressLine1: text(200),
  addressLine2: z.string().trim().max(200).optional(),
  city: text(100),
  state: text(2).optional(),
  postalCode: text(20),
  squareFeet: z.number().int().positive().nullable().optional(),
  condition: nullableText(100).optional(),
  recentlyServiced: z.boolean().nullable().optional(),
  pets: z.string().max(1000).optional(),
  accessInstructions: z.string().max(5000).optional(),
  serviceNotes: z.string().max(5000).optional(),
  active: z.boolean().optional()
}).strict();

const employeeBase = z.object({
  userId: uuid.nullable().optional(),
  firstName: text(100),
  lastName: text(100),
  phone: text(30),
  hireDate: date.nullable().optional(),
  hourlyRateCents: z.number().int().min(0).max(1_000_000),
  experienceLevel: text(50).optional(),
  canDrive: z.boolean().optional(),
  active: z.boolean().optional()
}).strict();

const teamBase = z.object({
  name: text(100),
  active: z.boolean().optional()
}).strict();

const availabilityBase = z.object({
  employeeId: uuid,
  startsAt: dateTime,
  endsAt: dateTime,
  reason: text(1000),
  status: z.enum(["requested", "approved", "declined"]).optional()
}).strict();

const feedbackBase = z.object({
  employeeId: uuid,
  rating: z.number().int().min(1).max(5),
  notes: z.string().max(2000).optional(),
  receivedAt: date
}).strict();

const serviceTypeBase = z.object({
  name: text(150),
  category: z.enum(["residential", "commercial", "addon"]),
  defaultDurationMinutes: z.number().int().positive().max(1440).nullable().optional(),
  referenceChecklist: z.array(text(200)).max(100).optional(),
  active: z.boolean().optional()
}).strict();

const configs = [
  {
    path: "customers",
    table: "customers",
    singular: "customer",
    create: customerBase,
    update: patch(customerBase),
    columns: {
      type: "type", name: "name", email: "email", phone: "phone",
      preferredChannel: "preferred_channel", serviceFrequency: "service_frequency",
      paymentMethod: "payment_method", status: "status", internalNotes: "internal_notes"
    },
    list: z.object({
      ...paging,
      q: searchQuery,
      type: customerBase.shape.type.optional(),
      status: customerStatus.optional()
    }).strict(),
    filters: { type: "type", status: "status" },
    search: ["name", "email", "phone"],
    decorateList: addCustomerPropertyCounts,
    order: "name, created_at DESC",
    archive: { status: "inactive" },
    timestamps: true
  },
  {
    path: "properties",
    table: "properties",
    singular: "property",
    create: propertyBase,
    update: patch(propertyBase),
    columns: {
      customerId: "customer_id", label: "label", addressLine1: "address_line1",
      addressLine2: "address_line2", city: "city", state: "state",
      postalCode: "postal_code", squareFeet: "square_feet", condition: "condition",
      recentlyServiced: "recently_serviced", pets: "pets",
      accessInstructions: "access_instructions", serviceNotes: "service_notes", active: "active"
    },
    list: z.object({
      ...paging,
      q: searchQuery,
      customerId: uuid.optional(),
      active: queryBoolean.optional()
    }).strict(),
    filters: { customerId: "customer_id", active: "active" },
    search: ["label", "address_line1", "city", "postal_code"],
    order: "city, address_line1",
    archive: { active: false },
    timestamps: true,
    check: async (client, organizationId, input) => {
      if (input.customerId !== undefined) {
        await requireOwned(client, "customers", input.customerId, organizationId, "Customer");
      }
    }
  },
  {
    path: "employees",
    table: "employees",
    singular: "employee",
    create: employeeBase,
    update: patch(employeeBase),
    columns: {
      userId: "user_id", firstName: "first_name", lastName: "last_name", phone: "phone",
      hireDate: "hire_date", hourlyRateCents: "hourly_rate_cents",
      experienceLevel: "experience_level", canDrive: "can_drive", active: "active"
    },
    list: z.object({ ...paging, q: searchQuery, active: queryBoolean.optional() }).strict(),
    filters: { active: "active" },
    search: ["first_name", "last_name", "phone"],
    order: "last_name, first_name",
    archive: { active: false },
    timestamps: true,
    check: async (client, organizationId, input) => {
      if (input.userId !== undefined && input.userId !== null) {
        const user = await requireOwned(client, "users", input.userId, organizationId, "User");
        if (user.role !== "cleaner") {
          throw new HttpError(400, "invalid_reference", "Employee user must have the cleaner role");
        }
      }
    }
  },
  {
    path: "teams",
    table: "teams",
    singular: "team",
    create: teamBase,
    update: patch(teamBase),
    columns: { name: "name", active: "active" },
    list: z.object({ ...paging, active: queryBoolean.optional() }).strict(),
    filters: { active: "active" },
    order: "name",
    archive: { active: false },
    timestamps: true
  },
  {
    path: "availability-exceptions",
    table: "availability_exceptions",
    singular: "availabilityException",
    create: availabilityBase,
    update: patch(availabilityBase),
    columns: {
      employeeId: "employee_id", startsAt: "starts_at", endsAt: "ends_at",
      reason: "reason", status: "status", reviewedBy: "reviewed_by", reviewedAt: "reviewed_at"
    },
    list: z.object({
      ...paging,
      employeeId: uuid.optional(),
      status: z.enum(["requested", "approved", "declined"]).optional()
    }).strict(),
    filters: { employeeId: "employee_id", status: "status" },
    order: "starts_at DESC",
    prepare: (input, req, current) => {
      const status = input.status ?? current?.status ?? "requested";
      return input.status === undefined && current
        ? input
        : {
            ...input,
            status,
            reviewedBy: status === "requested" ? null : req.auth.id,
            reviewedAt: status === "requested" ? null : new Date()
          };
    },
    check: async (client, organizationId, input, current) => {
      if (input.employeeId !== undefined) {
        await requireOwned(client, "employees", input.employeeId, organizationId, "Employee");
      }
      const startsAt = input.startsAt ?? current?.starts_at;
      const endsAt = input.endsAt ?? current?.ends_at;
      if (new Date(endsAt) <= new Date(startsAt)) {
        throw new HttpError(400, "validation_error", "Availability end must be after its start");
      }
    }
  },
  {
    path: "quality-feedback",
    table: "employee_quality_feedback",
    singular: "qualityFeedback",
    create: feedbackBase,
    update: patch(feedbackBase),
    columns: {
      employeeId: "employee_id", rating: "rating", notes: "notes",
      receivedAt: "received_at", createdBy: "created_by"
    },
    list: z.object({ ...paging, employeeId: uuid.optional() }).strict(),
    filters: { employeeId: "employee_id" },
    order: "received_at DESC, created_at DESC",
    prepare: (input, req, current) => current ? input : { ...input, createdBy: req.auth.id },
    check: async (client, organizationId, input) => {
      if (input.employeeId !== undefined) {
        await requireOwned(client, "employees", input.employeeId, organizationId, "Employee");
      }
    },
    after: async (client, organizationId, before, after) => {
      const employeeIds = new Set([before?.employee_id, after?.employee_id].filter(Boolean));
      for (const employeeId of employeeIds) {
        const average = await client.query(
          `SELECT avg(rating) AS rating
           FROM employee_quality_feedback
           WHERE organization_id = $1 AND employee_id = $2`,
          [organizationId, employeeId]
        );
        await client.query(
          "UPDATE employees SET quality_rating = $1, updated_at = now() WHERE id = $2 AND organization_id = $3",
          [average.rows[0].rating, employeeId, organizationId]
        );
      }
    }
  },
  {
    path: "service-types",
    table: "service_types",
    singular: "serviceType",
    create: serviceTypeBase,
    update: patch(serviceTypeBase),
    columns: {
      name: "name", category: "category",
      defaultDurationMinutes: "default_duration_minutes",
      referenceChecklist: "reference_checklist", active: "active"
    },
    list: z.object({
      ...paging,
      category: serviceTypeBase.shape.category.optional(),
      active: queryBoolean.optional()
    }).strict(),
    filters: { category: "category", active: "active" },
    order: "category, name",
    archive: { active: false },
    timestamps: true
  }
];

function patch(schema) {
  return schema.partial().refine(value => Object.keys(value).length > 0, {
    message: "At least one field is required"
  });
}

function apiRow(row) {
  if (!row) return row;
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
      value
    ])
  );
}

function databaseValue(column, value) {
  return column === "reference_checklist" && value !== null ? JSON.stringify(value) : value;
}

function valuesFor(input, columns) {
  return Object.entries(input)
    .filter(([key]) => columns[key])
    .map(([key, value]) => [columns[key], databaseValue(columns[key], value)]);
}

function idFrom(req) {
  return validate(z.object({ id: uuid }).strict(), req.params).id;
}

function resourceName(config) {
  return config.singular.replace(/[A-Z]/g, letter => ` ${letter.toLowerCase()}`);
}

async function addCustomerPropertyCounts(pool, organizationId, rows) {
  if (!rows.length) return rows;
  const customerIds = rows.map((row) => row.id);
  const placeholders = customerIds.map((_, index) => `$${index + 2}`).join(", ");
  const result = await pool.query(
    `SELECT customer_id, COUNT(*)::integer AS property_count
     FROM properties
     WHERE organization_id = $1 AND active = true
       AND customer_id IN (${placeholders})
     GROUP BY customer_id`,
    [organizationId, ...customerIds]
  );
  const counts = new Map(result.rows.map((row) => [row.customer_id, Number(row.property_count)]));
  return rows.map((row) => ({ ...row, property_count: counts.get(row.id) || 0 }));
}

async function requireOwned(client, table, id, organizationId, label = "Resource") {
  const result = await client.query(
    `SELECT * FROM ${table} WHERE id = $1 AND organization_id = $2`,
    [id, organizationId]
  );
  if (!result.rowCount) throw new HttpError(404, "not_found", `${label} not found`);
  return result.rows[0];
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
    if (error.code === "23505") {
      throw new HttpError(409, "conflict", "A record with those values already exists");
    }
    if (error.code === "23503" || error.code === "23514") {
      throw new HttpError(400, "invalid_reference", "The request conflicts with an existing record");
    }
    throw error;
  } finally {
    client.release();
  }
}

function route(handler) {
  return asyncRoute(handler);
}

function registerCrud(router, pool, config) {
  const plural = config.path.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  const label = resourceName(config);

  router.get(`/${config.path}`, route(async (req, res) => {
    const input = validate(config.list, req.query);
    const params = [req.auth.organizationId];
    const clauses = ["organization_id = $1"];
    for (const [key, column] of Object.entries(config.filters)) {
      if (input[key] !== undefined) {
        params.push(input[key]);
        clauses.push(`${column} = $${params.length}`);
      }
    }
    if (input.q && config.search) {
      params.push(`${input.q.toLowerCase()}%`);
      clauses.push(`(${config.search.map((column) =>
        `LOWER(${column}) LIKE $${params.length}`
      ).join(" OR ")})`);
    }
    const count = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM ${config.table}
       WHERE ${clauses.join(" AND ")}`,
      params
    );
    const listParams = [...params, input.limit, input.offset];
    const result = await pool.query(
      `SELECT ${config.select || "*"} FROM ${config.table}
       WHERE ${clauses.join(" AND ")}
       ORDER BY ${config.order}
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );
    const rows = config.decorateList
      ? await config.decorateList(pool, req.auth.organizationId, result.rows)
      : result.rows;
    data(res, {
      [plural]: rows.map(apiRow),
      pagination: {
        total: Number(count.rows[0].total),
        limit: input.limit,
        offset: input.offset
      }
    });
  }));

  router.post(`/${config.path}`, route(async (req, res) => {
    const body = validate(config.create, req.body);
    const created = await transaction(pool, async client => {
      const input = config.prepare ? config.prepare(body, req) : body;
      if (config.check) await config.check(client, req.auth.organizationId, input);
      const entries = valuesFor(input, config.columns);
      const columns = ["id", "organization_id", ...entries.map(([column]) => column)];
      const values = [crypto.randomUUID(), req.auth.organizationId, ...entries.map(([, value]) => value)];
      const result = await client.query(
        `INSERT INTO ${config.table} (${columns.join(", ")})
         VALUES (${values.map((_, index) => `$${index + 1}`).join(", ")})
         RETURNING *`,
        values
      );
      const row = result.rows[0];
      if (config.after) await config.after(client, req.auth.organizationId, null, row);
      await recordAudit(client, req.auth, {
        entityType: config.singular,
        entityId: row.id,
        action: "create",
        after: apiRow(row)
      });
      return row;
    });
    data(res, { [config.singular]: apiRow(created) }, 201);
  }));

  router.get(`/${config.path}/:id`, route(async (req, res) => {
    const row = await requireOwned(pool, config.table, idFrom(req), req.auth.organizationId, label);
    data(res, { [config.singular]: apiRow(row) });
  }));

  router.patch(`/${config.path}/:id`, route(async (req, res) => {
    const id = idFrom(req);
    const body = validate(config.update, req.body);
    const updated = await transaction(pool, async client => {
      const before = await requireOwned(client, config.table, id, req.auth.organizationId, label);
      const input = config.prepare ? config.prepare(body, req, before) : body;
      if (config.check) await config.check(client, req.auth.organizationId, input, before);
      const entries = valuesFor(input, config.columns);
      const values = entries.map(([, value]) => value);
      const sets = entries.map(([column], index) => `${column} = $${index + 1}`);
      if (config.timestamps) sets.push("updated_at = now()");
      values.push(id, req.auth.organizationId);
      const result = await client.query(
        `UPDATE ${config.table} SET ${sets.join(", ")}
         WHERE id = $${values.length - 1} AND organization_id = $${values.length}
         RETURNING *`,
        values
      );
      const after = result.rows[0];
      if (config.after) await config.after(client, req.auth.organizationId, before, after);
      await recordAudit(client, req.auth, {
        entityType: config.singular,
        entityId: id,
        action: "update",
        before: apiRow(before),
        after: apiRow(after)
      });
      return after;
    });
    data(res, { [config.singular]: apiRow(updated) });
  }));

  router.delete(`/${config.path}/:id`, route(async (req, res) => {
    const id = idFrom(req);
    const removed = await transaction(pool, async client => {
      const before = await requireOwned(client, config.table, id, req.auth.organizationId, label);
      let after = null;
      if (config.archive) {
        const entries = Object.entries(config.archive);
        const values = entries.map(([, value]) => value);
        const sets = entries.map(([column], index) => `${column} = $${index + 1}`);
        if (config.timestamps) sets.push("updated_at = now()");
        values.push(id, req.auth.organizationId);
        const result = await client.query(
          `UPDATE ${config.table} SET ${sets.join(", ")}
           WHERE id = $${values.length - 1} AND organization_id = $${values.length}
           RETURNING *`,
          values
        );
        after = result.rows[0];
      } else {
        await client.query(
          `DELETE FROM ${config.table} WHERE id = $1 AND organization_id = $2`,
          [id, req.auth.organizationId]
        );
      }
      if (config.after) await config.after(client, req.auth.organizationId, before, after);
      await recordAudit(client, req.auth, {
        entityType: config.singular,
        entityId: id,
        action: "delete",
        before: apiRow(before),
        after: apiRow(after)
      });
      return after || before;
    });
    data(res, { deleted: true, [config.singular]: apiRow(removed) });
  }));
}

const membershipCreate = z.object({
  employeeId: uuid,
  isCaptain: z.boolean().optional(),
  effectiveFrom: date,
  effectiveTo: date.nullable().optional()
}).strict();

const membershipUpdate = z.object({
  isCaptain: z.boolean().optional(),
  effectiveTo: date.nullable().optional()
}).strict().refine(value => Object.keys(value).length > 0, {
  message: "At least one field is required"
});

const membershipParams = z.object({
  teamId: uuid,
  employeeId: uuid,
  effectiveFrom: date
}).strict();

function validateMembershipDates(input, effectiveFrom) {
  if (input.effectiveTo && input.effectiveTo < (input.effectiveFrom || effectiveFrom)) {
    throw new HttpError(400, "validation_error", "Membership end cannot precede its start");
  }
}

async function requireMembership(client, params, organizationId) {
  const result = await client.query(
    `SELECT tm.*
     FROM team_members tm
     JOIN teams t ON t.id = tm.team_id
     WHERE tm.team_id = $1 AND tm.employee_id = $2 AND tm.effective_from = $3
       AND t.organization_id = $4`,
    [params.teamId, params.employeeId, params.effectiveFrom, organizationId]
  );
  if (!result.rowCount) throw new HttpError(404, "not_found", "Team membership not found");
  return result.rows[0];
}

async function ensureCaptainCanDrive(client, employee, isCaptain) {
  if (isCaptain && !employee.can_drive) {
    throw new HttpError(400, "invalid_captain", "A team captain must be marked as a driver");
  }
}

function registerMembershipRoutes(router, pool) {
  router.get("/teams/:teamId/members", route(async (req, res) => {
    const { teamId } = validate(z.object({ teamId: uuid }).strict(), req.params);
    await requireOwned(pool, "teams", teamId, req.auth.organizationId, "Team");
    const result = await pool.query(
      `SELECT tm.*, e.first_name, e.last_name, e.can_drive
       FROM team_members tm
       JOIN employees e ON e.id = tm.employee_id
       WHERE tm.team_id = $1 AND e.organization_id = $2
       ORDER BY tm.effective_from DESC, e.last_name, e.first_name`,
      [teamId, req.auth.organizationId]
    );
    data(res, { teamMembers: result.rows.map(apiRow) });
  }));

  router.post("/teams/:teamId/members", route(async (req, res) => {
    const { teamId } = validate(z.object({ teamId: uuid }).strict(), req.params);
    const body = validate(membershipCreate, req.body);
    validateMembershipDates(body);
    const member = await transaction(pool, async client => {
      await requireOwned(client, "teams", teamId, req.auth.organizationId, "Team");
      const employee = await requireOwned(
        client, "employees", body.employeeId, req.auth.organizationId, "Employee"
      );
      await ensureCaptainCanDrive(client, employee, body.isCaptain);
      const result = await client.query(
        `INSERT INTO team_members
         (team_id, employee_id, is_captain, effective_from, effective_to)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [teamId, body.employeeId, body.isCaptain || false, body.effectiveFrom, body.effectiveTo || null]
      );
      await recordAudit(client, req.auth, {
        entityType: "teamMember",
        action: "create",
        after: apiRow(result.rows[0])
      });
      return result.rows[0];
    });
    data(res, { teamMember: apiRow(member) }, 201);
  }));

  router.get("/teams/:teamId/members/:employeeId/:effectiveFrom", route(async (req, res) => {
    const params = validate(membershipParams, req.params);
    const member = await requireMembership(pool, params, req.auth.organizationId);
    data(res, { teamMember: apiRow(member) });
  }));

  router.patch("/teams/:teamId/members/:employeeId/:effectiveFrom", route(async (req, res) => {
    const params = validate(membershipParams, req.params);
    const body = validate(membershipUpdate, req.body);
    validateMembershipDates(body, params.effectiveFrom);
    const member = await transaction(pool, async client => {
      const before = await requireMembership(client, params, req.auth.organizationId);
      const employee = await requireOwned(
        client, "employees", params.employeeId, req.auth.organizationId, "Employee"
      );
      await ensureCaptainCanDrive(client, employee, body.isCaptain);
      const entries = Object.entries(body).map(([key, value]) => [
        key === "isCaptain" ? "is_captain" : "effective_to",
        value
      ]);
      const values = entries.map(([, value]) => value);
      values.push(params.teamId, params.employeeId, params.effectiveFrom);
      const result = await client.query(
        `UPDATE team_members
         SET ${entries.map(([column], index) => `${column} = $${index + 1}`).join(", ")}
         WHERE team_id = $${values.length - 2}
           AND employee_id = $${values.length - 1}
           AND effective_from = $${values.length}
         RETURNING *`,
        values
      );
      await recordAudit(client, req.auth, {
        entityType: "teamMember",
        action: "update",
        before: apiRow(before),
        after: apiRow(result.rows[0])
      });
      return result.rows[0];
    });
    data(res, { teamMember: apiRow(member) });
  }));

  router.delete("/teams/:teamId/members/:employeeId/:effectiveFrom", route(async (req, res) => {
    const params = validate(membershipParams, req.params);
    const member = await transaction(pool, async client => {
      const before = await requireMembership(client, params, req.auth.organizationId);
      await client.query(
        `DELETE FROM team_members
         WHERE team_id = $1 AND employee_id = $2 AND effective_from = $3`,
        [params.teamId, params.employeeId, params.effectiveFrom]
      );
      await recordAudit(client, req.auth, {
        entityType: "teamMember",
        action: "delete",
        before: apiRow(before)
      });
      return before;
    });
    data(res, { deleted: true, teamMember: apiRow(member) });
  }));
}

function registerCustomerCancellation(router, pool) {
  const inputSchema = z.object({
    reason: z.string().trim().max(1000).optional().default("")
  }).strict();

  router.post("/customers/:id/cancel", route(async (req, res) => {
    const id = idFrom(req);
    const input = validate(inputSchema, req.body || {});
    const result = await transaction(pool, async client => {
      const before = await requireOwned(
        client, "customers", id, req.auth.organizationId, "Customer"
      );
      if (before.status === "cancelled") {
        return { customer: before, recurringCount: 0, bookingCount: 0 };
      }

      const recurring = await client.query(
        `UPDATE recurring_services
         SET status = 'ended', ended_at = now(), updated_at = now()
         WHERE organization_id = $1 AND customer_id = $2
           AND status IN ('active', 'paused')
         RETURNING id`,
        [req.auth.organizationId, id]
      );
      await client.query(
        `DELETE FROM route_stops
         WHERE organization_id = $1 AND booking_id IN (
           SELECT id FROM bookings
           WHERE organization_id = $1 AND customer_id = $2
             AND scheduled_start >= now()
             AND status IN ('requested', 'confirmed', 'assigned')
         )`,
        [req.auth.organizationId, id]
      );
      await client.query(
        `UPDATE notifications SET status = 'cancelled'
         WHERE organization_id = $1 AND status = 'queued' AND booking_id IN (
           SELECT id FROM bookings
           WHERE organization_id = $1 AND customer_id = $2
             AND scheduled_start >= now()
             AND status IN ('requested', 'confirmed', 'assigned')
         )`,
        [req.auth.organizationId, id]
      );
      const futureBookings = await client.query(
        `UPDATE bookings SET status = 'cancelled', updated_at = now()
         WHERE organization_id = $1 AND customer_id = $2
           AND scheduled_start >= now()
           AND status IN ('requested', 'confirmed', 'assigned')
         RETURNING id`,
        [req.auth.organizationId, id]
      );
      await client.query(
        `UPDATE notifications SET status = 'cancelled'
         WHERE organization_id = $1 AND customer_id = $2 AND status = 'queued'`,
        [req.auth.organizationId, id]
      );
      const updated = await client.query(
        `UPDATE customers
         SET status = 'cancelled', cancelled_at = now(),
             cancellation_reason = $3, updated_at = now()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [id, req.auth.organizationId, input.reason || null]
      );
      const customer = updated.rows[0];
      await recordAudit(client, req.auth, {
        entityType: "customer",
        entityId: id,
        action: "cancel",
        before: apiRow(before),
        after: {
          ...apiRow(customer),
          endedRecurringServices: recurring.rowCount,
          cancelledBookings: futureBookings.rowCount
        }
      });
      return {
        customer,
        recurringCount: recurring.rowCount,
        bookingCount: futureBookings.rowCount
      };
    });
    data(res, {
      customer: apiRow(result.customer),
      endedRecurringServices: result.recurringCount,
      cancelledBookings: result.bookingCount
    });
  }));
}

export function createResourceRouter({ pool }) {
  const router = express.Router();

  router.get("/employees/me", requireRole("cleaner"), route(async (req, res) => {
    const result = await pool.query(
      `SELECT id, user_id, first_name, last_name, phone, hire_date,
              hourly_rate_cents, experience_level, quality_rating, can_drive, active
       FROM employees
       WHERE organization_id = $1 AND user_id = $2`,
      [req.auth.organizationId, req.auth.id]
    );
    if (!result.rowCount) throw new HttpError(404, "not_found", "Employee record not found");
    data(res, { employee: apiRow(result.rows[0]) });
  }));

  router.use(requireRole("manager"));
  for (const config of configs) registerCrud(router, pool, config);
  registerCustomerCancellation(router, pool);
  registerMembershipRoutes(router, pool);
  return router;
}
