import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { recordAudit, requireRole } from "./auth.js";
import { withTransaction } from "./db.js";
import { HttpError, asyncRoute, data, validate } from "./http.js";
import { hashPassword } from "./passwords.js";

const uuid = z.string().uuid();
const createSchema = z.object({
  email: z.string().trim().email().max(254),
  name: z.string().trim().min(1).max(200),
  role: z.enum(["manager", "cleaner"]),
  password: z.string().min(12).max(200),
  employeeId: uuid.nullable().optional()
}).strict().refine(
  (value) => value.role !== "cleaner" || value.employeeId,
  { message: "Cleaner accounts must be linked to an employee", path: ["employeeId"] }
);
const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  active: z.boolean().optional()
}).strict().refine((value) => Object.keys(value).length > 0, "At least one change is required");
const passwordSchema = z.object({
  password: z.string().min(12).max(200)
}).strict();

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    active: row.active,
    mustChangePassword: Boolean(row.mustChangePassword),
    employeeId: row.employeeId || null,
    createdAt: row.createdAt
  };
}

export function createAccountRouter({ pool }) {
  const router = Router();
  router.use(requireRole("manager"));

  router.get("/users", asyncRoute(async (req, res) => {
    const result = await pool.query(
      `SELECT u.id, u.email, u.name, u.role, u.active,
              u.must_change_password AS "mustChangePassword",
              u.created_at AS "createdAt",
              e.id AS "employeeId"
       FROM users u
       LEFT JOIN employees e ON e.user_id = u.id AND e.organization_id = u.organization_id
       WHERE u.organization_id = $1
       ORDER BY u.active DESC, u.name`,
      [req.auth.organizationId]
    );
    data(res, { users: result.rows.map(publicUser) });
  }));

  router.post("/users", asyncRoute(async (req, res) => {
    const input = validate(createSchema, req.body);
    const email = input.email.toLowerCase();
    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(input.password);
    const user = await withTransaction(pool, async (client) => {
      if (input.employeeId) {
        const employee = await client.query(
          `SELECT id, user_id AS "userId" FROM employees
           WHERE id = $1 AND organization_id = $2 AND active = true`,
          [input.employeeId, req.auth.organizationId]
        );
        if (!employee.rowCount) throw new HttpError(404, "not_found", "Employee not found");
        if (employee.rows[0].userId) {
          throw new HttpError(409, "employee_has_account", "Employee already has an account");
        }
      }
      try {
        await client.query(
          `INSERT INTO users
           (id, organization_id, email, name, role, password_hash, must_change_password)
           VALUES ($1, $2, $3, $4, $5, $6, true)`,
          [id, req.auth.organizationId, email, input.name, input.role, passwordHash]
        );
      } catch (error) {
        if (error.code === "23505") {
          throw new HttpError(409, "email_exists", "An account already uses this email");
        }
        throw error;
      }
      if (input.employeeId) {
        await client.query(
          "UPDATE employees SET user_id = $1, updated_at = now() WHERE id = $2",
          [id, input.employeeId]
        );
      }
      const result = {
        id,
        email,
        name: input.name,
        role: input.role,
        active: true,
        mustChangePassword: true,
        employeeId: input.employeeId || null,
        createdAt: new Date()
      };
      await recordAudit(client, req.auth, {
        entityType: "user", entityId: id, action: "create",
        after: { ...result, createdAt: undefined }
      });
      return result;
    });
    data(res, { user: publicUser(user) }, 201);
  }));

  router.patch("/users/:id", asyncRoute(async (req, res) => {
    const id = validate(uuid, req.params.id);
    const input = validate(updateSchema, req.body);
    if (id === req.auth.id && input.active === false) {
      throw new HttpError(409, "cannot_deactivate_self", "You cannot deactivate your own account");
    }
    const entries = Object.entries(input);
    const values = entries.map(([, value]) => value);
    values.push(id, req.auth.organizationId);
    const user = await withTransaction(pool, async (client) => {
      const result = await client.query(
        `UPDATE users SET
         ${entries.map(([key], index) => `${key} = $${index + 1}`).join(", ")},
         updated_at = now()
         WHERE id = $${values.length - 1} AND organization_id = $${values.length}
         RETURNING id, email, name, role, active, created_at AS "createdAt"`,
        values
      );
      if (!result.rowCount) throw new HttpError(404, "not_found", "User not found");
      if (input.active === false) {
        await client.query("DELETE FROM sessions WHERE user_id = $1", [id]);
      }
      await recordAudit(client, req.auth, {
        entityType: "user", entityId: id, action: "update", after: input
      });
      return result.rows[0];
    });
    data(res, { user: publicUser(user) });
  }));

  router.post("/users/:id/reset-password", asyncRoute(async (req, res) => {
    const id = validate(uuid, req.params.id);
    const input = validate(passwordSchema, req.body);
    const passwordHash = await hashPassword(input.password);
    await withTransaction(pool, async (client) => {
      const result = await client.query(
        `UPDATE users
         SET password_hash = $3, must_change_password = true, updated_at = now()
         WHERE id = $1 AND organization_id = $2
         RETURNING id`,
        [id, req.auth.organizationId, passwordHash]
      );
      if (!result.rowCount) throw new HttpError(404, "not_found", "User not found");
      await client.query("DELETE FROM sessions WHERE user_id = $1", [id]);
      await recordAudit(client, req.auth, {
        entityType: "user", entityId: id, action: "reset_password"
      });
    });
    data(res, { reset: true });
  }));

  return router;
}
