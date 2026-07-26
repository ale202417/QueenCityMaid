import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createMigrationPool, migrate } from "./db.js";
import { hashPassword } from "./passwords.js";

const inputSchema = z.object({
  organizationName: z.string().trim().min(1).max(200),
  managerEmail: z.string().trim().email().max(254),
  managerName: z.string().trim().min(1).max(200),
  managerPassword: z.string().min(12).max(200)
}).strict();

export async function bootstrapAdmin(pool, rawInput) {
  const input = inputSchema.parse(rawInput);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const organizations = await client.query(
      "SELECT id FROM organizations WHERE lower(name) = lower($1)",
      [input.organizationName]
    );
    if (organizations.rowCount > 1) {
      throw new Error("More than one organization has this name");
    }
    const organizationId = organizations.rows[0]?.id || crypto.randomUUID();
    if (!organizations.rowCount) {
      await client.query(
        "INSERT INTO organizations (id, name) VALUES ($1, $2)",
        [organizationId, input.organizationName]
      );
    }
    await client.query(
      `INSERT INTO business_settings (organization_id) VALUES ($1)
       ON CONFLICT (organization_id) DO NOTHING`,
      [organizationId]
    );

    const existing = await client.query(
      `SELECT id, organization_id, role
       FROM users WHERE lower(email) = lower($1)`,
      [input.managerEmail]
    );
    if (existing.rowCount) {
      const manager = existing.rows[0];
      if (
        existing.rowCount === 1
        && manager.organization_id === organizationId
        && manager.role === "manager"
      ) {
        await client.query("COMMIT");
        return { created: false, organizationId, userId: manager.id };
      }
      throw new Error("This email is already assigned to another account");
    }

    const userId = crypto.randomUUID();
    await client.query(
      `INSERT INTO users
       (id, organization_id, email, name, role, password_hash)
       VALUES ($1, $2, $3, $4, 'manager', $5)`,
      [
        userId,
        organizationId,
        input.managerEmail.toLowerCase(),
        input.managerName,
        await hashPassword(input.managerPassword)
      ]
    );
    await client.query(
      `INSERT INTO audit_events
       (id, organization_id, actor_user_id, entity_type, entity_id, action, after_data)
       VALUES ($1, $2, $3, 'user', $3, 'bootstrap', $4)`,
      [
        crypto.randomUUID(),
        organizationId,
        userId,
        JSON.stringify({ email: input.managerEmail.toLowerCase(), role: "manager" })
      ]
    );
    await client.query("COMMIT");
    return { created: true, organizationId, userId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const pool = createMigrationPool();
  try {
    await migrate(pool);
    const result = await bootstrapAdmin(pool, {
      organizationName: process.env.BOOTSTRAP_ORGANIZATION_NAME || "Queen City Maid",
      managerEmail: process.env.BOOTSTRAP_MANAGER_EMAIL,
      managerName: process.env.BOOTSTRAP_MANAGER_NAME,
      managerPassword: process.env.BOOTSTRAP_MANAGER_PASSWORD
    });
    console.log(result.created ? "Production manager created" : "Production manager already exists");
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
