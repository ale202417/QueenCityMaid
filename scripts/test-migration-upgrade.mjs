import crypto from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import { migrate } from "../src/server/db.js";
import { seed } from "../src/server/seed-data.js";

const connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL is required");

const schema = `migration_upgrade_${crypto.randomUUID().replaceAll("-", "")}`;
const identifier = `"${schema}"`;
const client = new pg.Client({ connectionString });
const migrationsDir = new URL("../src/server/migrations/", import.meta.url);

await client.connect();
try {
  await client.query(`CREATE SCHEMA ${identifier}`);
  await client.query(`SET search_path TO ${identifier}`);
  const db = {
    query: (...args) => client.query(...args),
    connect: async () => ({
      query: (...args) => client.query(...args),
      release() {}
    })
  };

  await db.query(`
    CREATE TABLE schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const previousRelease = "013_finance_corrections.sql";
  const files = (await readdir(migrationsDir))
    .filter(name => name.endsWith(".sql") && name <= previousRelease)
    .sort();
  for (const name of files) {
    await db.query(await readFile(new URL(name, migrationsDir), "utf8"));
    await db.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
  }

  await seed(db, { password: "migration-test-password" });
  const context = (await db.query(`
    SELECT
      o.id AS organization_id,
      u.id AS user_id,
      u.email,
      c.id AS customer_id,
      b.id AS booking_id,
      cc.id AS charge_id
    FROM organizations o
    JOIN users u ON u.organization_id = o.id AND u.role = 'manager'
    JOIN customers c ON c.organization_id = o.id
    JOIN bookings b ON b.customer_id = c.id
    JOIN customer_charges cc ON cc.booking_id = b.id AND cc.type = 'service'
    ORDER BY u.created_at
    LIMIT 1
  `)).rows[0];
  const paymentId = crypto.randomUUID();
  const expenseId = crypto.randomUUID();
  const tipId = crypto.randomUUID();

  await db.query(
    `INSERT INTO payments
     (id, organization_id, customer_id, recorded_by, method, amount_cents, paid_at, reference)
     VALUES ($1, $2, $3, $4, 'check', 22000, now(), 'previous release')`,
    [paymentId, context.organization_id, context.customer_id, context.user_id]
  );
  await db.query(
    `INSERT INTO business_expenses
     (id, organization_id, spent_on, category, description, amount_cents, recorded_by)
     VALUES ($1, $2, CURRENT_DATE, 'supplies', 'Previous release expense', 4500, $3)`,
    [expenseId, context.organization_id, context.user_id]
  );
  await db.query(
    `INSERT INTO tips
     (id, organization_id, booking_id, amount_cents, source, recorded_by)
     VALUES ($1, $2, $3, 2000, 'manager', $4)`,
    [tipId, context.organization_id, context.booking_id, context.user_id]
  );
  await migrate(db);

  const payment = await db.query(
    "SELECT status, amount_cents FROM payments WHERE id = $1",
    [paymentId]
  );
  const expense = await db.query(
    "SELECT status, amount_cents FROM business_expenses WHERE id = $1",
    [expenseId]
  );
  const tip = await db.query("SELECT amount_cents FROM tips WHERE id = $1", [tipId]);
  const charge = await db.query(
    "SELECT amount_cents FROM customer_charges WHERE id = $1",
    [context.charge_id]
  );
  const user = await db.query(
    "SELECT email, must_change_password FROM users WHERE id = $1",
    [context.user_id]
  );
  const migrations = await db.query("SELECT count(*)::int AS count FROM schema_migrations");
  const automationSettings = await db.query(
    `SELECT schedule_automation_enabled, service_reminder_automation_enabled,
            payment_reminder_automation_enabled
     FROM business_settings
     WHERE organization_id = $1`,
    [context.organization_id]
  );
  if (
    payment.rows[0]?.status !== "recorded"
    || payment.rows[0]?.amount_cents !== 22000
    || expense.rows[0]?.status !== "recorded"
    || expense.rows[0]?.amount_cents !== 4500
    || tip.rows[0]?.amount_cents !== 2000
    || charge.rows[0]?.amount_cents !== 22000
    || user.rows[0]?.email !== context.email
    || user.rows[0]?.must_change_password !== false
    || migrations.rows[0]?.count !== 14
    || automationSettings.rows[0]?.schedule_automation_enabled !== true
    || automationSettings.rows[0]?.service_reminder_automation_enabled !== false
    || automationSettings.rows[0]?.payment_reminder_automation_enabled !== false
  ) {
    throw new Error("Previous-release records were not preserved through migration 014");
  }

  await expectRejected(
    db.query(
      `INSERT INTO tips
       (id, organization_id, booking_id, amount_cents, source, recorded_by)
       VALUES ($1, $2, $3, 1000, 'manager', $4)`,
      [crypto.randomUUID(), context.organization_id, context.booking_id, context.user_id]
    ),
    "duplicate booking tip"
  );
  await expectRejected(
    db.query(
      `INSERT INTO customer_charges
       (id, organization_id, customer_id, booking_id, type, description,
        amount_cents, status, charged_on)
       VALUES ($1, $2, $3, $4, 'service', 'Duplicate service',
               22000, 'unpaid', CURRENT_DATE)`,
      [crypto.randomUUID(), context.organization_id, context.customer_id, context.booking_id]
    ),
    "duplicate booking charge"
  );
  await expectRejected(
    db.query(
      `INSERT INTO users
       (id, organization_id, email, name, role, password_hash)
       VALUES ($1, $2, $3, 'Duplicate manager', 'manager', 'hash')`,
      [crypto.randomUUID(), context.organization_id, context.email.toUpperCase()]
    ),
    "case-insensitive duplicate email"
  );

  console.log("Previous-release PostgreSQL migration check passed");
} finally {
  await client.query("SET search_path TO public");
  await client.query(`DROP SCHEMA IF EXISTS ${identifier} CASCADE`);
  await client.end();
}

async function expectRejected(promise, label) {
  try {
    await promise;
  } catch {
    return;
  }
  throw new Error(`Migration did not reject ${label}`);
}
