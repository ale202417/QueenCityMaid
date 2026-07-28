import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { recordAudit, requireRole } from "./auth.js";
import { HttpError, asyncRoute, data, validate } from "./http.js";

const customerRow = z.object({
  type: z.enum(["residential", "commercial", "realtor"]).optional(),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(254).nullable().optional(),
  phone: z.string().trim().min(7).max(30),
  status: z.enum(["lead", "active", "paused", "inactive"]).optional(),
  serviceFrequency: z.enum(["weekly", "biweekly", "monthly", "other"]).nullable().optional(),
  paymentMethod: z.enum(["zelle", "venmo", "paypal", "cash", "check", "other"]).nullable().optional(),
  addressLine1: z.string().trim().min(1).max(200).optional(),
  addressLine2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(100).optional(),
  state: z.string().trim().length(2).optional(),
  postalCode: z.string().trim().min(3).max(20).optional(),
  squareFeet: z.number().int().positive().nullable().optional(),
  pets: z.string().trim().max(1000).optional(),
  accessInstructions: z.string().trim().max(5000).optional(),
  serviceNotes: z.string().trim().max(5000).optional()
}).strict().refine(
  (row) => !row.addressLine1 || (row.city && row.postalCode),
  { message: "Properties with an address require city and postal code" }
);

const employeeRow = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(7).max(30),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  hourlyRateCents: z.number().int().min(0).max(1_000_000),
  experienceLevel: z.string().trim().min(1).max(50).optional(),
  canDrive: z.boolean().optional(),
  active: z.boolean().optional()
}).strict();

const customersSchema = z.object({
  rows: z.array(customerRow).min(1).max(2000)
}).strict();
const employeesSchema = z.object({
  rows: z.array(employeeRow).min(1).max(500)
}).strict();

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

export function createImportRouter({ pool }) {
  const router = Router();
  router.use(requireRole("manager"));

  router.post("/imports/customers", asyncRoute(async (req, res) => {
    const input = validate(customersSchema, req.body);
    const counts = await transaction(pool, async (client) => {
      let created = 0;
      let updated = 0;
      let propertiesCreated = 0;
      for (const row of input.rows) {
        const existing = await client.query(
          "SELECT id FROM customers WHERE organization_id = $1 AND phone = $2",
          [req.auth.organizationId, row.phone]
        );
        let customerId;
        if (existing.rowCount) {
          customerId = existing.rows[0].id;
          const fields = {
            name: row.name,
            ...(Object.hasOwn(row, "type") && { type: row.type }),
            ...(Object.hasOwn(row, "email") && { email: row.email ?? null }),
            ...(Object.hasOwn(row, "status") && { status: row.status }),
            ...(Object.hasOwn(row, "serviceFrequency")
              && { service_frequency: row.serviceFrequency ?? null }),
            ...(Object.hasOwn(row, "paymentMethod")
              && { payment_method: row.paymentMethod ?? null })
          };
          const entries = Object.entries(fields);
          await client.query(
            `UPDATE customers SET
             ${entries.map(([column], index) => `${column} = $${index + 3}`).join(", ")},
             updated_at = now()
             WHERE id = $1 AND organization_id = $2`,
            [
              customerId, req.auth.organizationId,
              ...entries.map(([, value]) => value)
            ]
          );
          updated += 1;
        } else {
          customerId = crypto.randomUUID();
          await client.query(
            `INSERT INTO customers
             (id, organization_id, type, name, email, phone, status,
              service_frequency, payment_method)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              customerId, req.auth.organizationId, row.type || "residential", row.name,
              row.email || null, row.phone, row.status || "active",
              row.serviceFrequency ?? null, row.paymentMethod ?? null
            ]
          );
          created += 1;
        }
        if (row.addressLine1) {
          const property = await client.query(
            `SELECT id FROM properties
             WHERE organization_id = $1 AND customer_id = $2
               AND address_line1 = $3 AND postal_code = $4`,
            [req.auth.organizationId, customerId, row.addressLine1, row.postalCode]
          );
          if (!property.rowCount) {
            await client.query(
              `INSERT INTO properties
               (id, organization_id, customer_id, address_line1, address_line2,
                city, state, postal_code, square_feet, pets, access_instructions, service_notes)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
              [
                crypto.randomUUID(), req.auth.organizationId, customerId, row.addressLine1,
                row.addressLine2 || "", row.city, row.state || "NC", row.postalCode,
                row.squareFeet ?? null, row.pets || "", row.accessInstructions || "",
                row.serviceNotes || ""
              ]
            );
            propertiesCreated += 1;
          }
        }
      }
      const result = { rows: input.rows.length, created, updated, propertiesCreated };
      await recordAudit(client, req.auth, {
        entityType: "customer_import", action: "create", after: result
      });
      return result;
    });
    data(res, { import: counts }, 201);
  }));

  router.post("/imports/employees", asyncRoute(async (req, res) => {
    const input = validate(employeesSchema, req.body);
    const counts = await transaction(pool, async (client) => {
      let created = 0;
      let updated = 0;
      for (const row of input.rows) {
        const existing = await client.query(
          "SELECT id FROM employees WHERE organization_id = $1 AND phone = $2",
          [req.auth.organizationId, row.phone]
        );
        if (existing.rowCount) {
          const fields = {
            first_name: row.firstName,
            last_name: row.lastName,
            ...(Object.hasOwn(row, "hireDate") && { hire_date: row.hireDate ?? null }),
            hourly_rate_cents: row.hourlyRateCents,
            ...(Object.hasOwn(row, "experienceLevel")
              && { experience_level: row.experienceLevel }),
            ...(Object.hasOwn(row, "canDrive") && { can_drive: row.canDrive }),
            ...(Object.hasOwn(row, "active") && { active: row.active })
          };
          const entries = Object.entries(fields);
          await client.query(
            `UPDATE employees SET
             ${entries.map(([column], index) => `${column} = $${index + 3}`).join(", ")},
             updated_at = now()
             WHERE id = $1 AND organization_id = $2`,
            [
              existing.rows[0].id, req.auth.organizationId,
              ...entries.map(([, value]) => value)
            ]
          );
          updated += 1;
        } else {
          await client.query(
            `INSERT INTO employees
             (id, organization_id, first_name, last_name, phone, hire_date,
              hourly_rate_cents, experience_level, can_drive, active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              crypto.randomUUID(), req.auth.organizationId, row.firstName, row.lastName,
              row.phone, row.hireDate || null, row.hourlyRateCents,
              row.experienceLevel || "standard", row.canDrive ?? false, row.active ?? true
            ]
          );
          created += 1;
        }
      }
      const result = { rows: input.rows.length, created, updated };
      await recordAudit(client, req.auth, {
        entityType: "employee_import", action: "create", after: result
      });
      return result;
    });
    data(res, { import: counts }, 201);
  }));

  router.use((error, req, res, next) => {
    if (error.code === "23505") {
      return next(new HttpError(409, "duplicate_record", "The import contains a duplicate record"));
    }
    next(error);
  });
  return router;
}
