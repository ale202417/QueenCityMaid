import crypto from "node:crypto";
import express from "express";
import { z } from "zod";
import {
  SESSION_COOKIE,
  authenticate,
  cookieOptions,
  createSession,
  destroySession,
  recordAudit,
  requirePasswordChange,
  requireRole
} from "./auth.js";
import { createAccountRouter } from "./accounts.js";
import { createAutomationRouter } from "./automation.js";
import { withTransaction } from "./db.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import {
  createCommunicationRouter,
  createSmsSender,
  createTwilioWebhookRouter
} from "./communications.js";
import { HttpError, asyncRoute, data, errorHandler, notFound, validate } from "./http.js";
import { createImportRouter } from "./imports.js";
import { createDispatchRouter } from "./dispatch.js";
import { createFinanceRouter } from "./finance.js";
import { createReportingRouter } from "./reporting.js";
import { createResourceRouter } from "./resources.js";
import { createSalesRouter } from "./sales.js";
import { createScheduleRouter } from "./schedule-planner.js";

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(200)
}).strict();

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  entityType: z.string().trim().min(1).max(100).optional(),
  entityId: z.string().uuid().optional(),
  action: z.string().trim().min(1).max(100).optional()
}).strict();
const LOGIN_ATTEMPT_LIMIT = 10;
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const changePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(200),
  newPassword: z.string().min(12).max(200)
}).strict().refine(
  (value) => value.currentPassword !== value.newPassword,
  { message: "New password must be different", path: ["newPassword"] }
);

function publicUser(auth) {
  return {
    id: auth.id,
    email: auth.email,
    name: auth.name,
    role: auth.role,
    mustChangePassword: Boolean(auth.mustChangePassword),
    organization: {
      id: auth.organizationId,
      name: auth.organizationName
    }
  };
}

function loginAttemptKey(req, email) {
  return crypto
    .createHash("sha256")
    .update(`${req.ip}:${email.toLowerCase()}`)
    .digest("hex");
}

async function isLoginThrottled(pool, keyHash) {
  const result = await pool.query(
    `SELECT attempt_count AS "attemptCount"
     FROM login_attempts
     WHERE key_hash = $1 AND reset_at > now()`,
    [keyHash]
  );
  return Number(result.rows[0]?.attemptCount || 0) >= LOGIN_ATTEMPT_LIMIT;
}

async function recordLoginFailure(pool, keyHash) {
  const resetAt = new Date(Date.now() + LOGIN_ATTEMPT_WINDOW_MS);
  await pool.query(
    `INSERT INTO login_attempts (key_hash, attempt_count, reset_at)
     VALUES ($1, 1, $2)
     ON CONFLICT (key_hash) DO UPDATE SET
       attempt_count = CASE
         WHEN login_attempts.reset_at <= now() THEN 1
         ELSE login_attempts.attempt_count + 1
       END,
       reset_at = CASE
         WHEN login_attempts.reset_at <= now() THEN EXCLUDED.reset_at
         ELSE login_attempts.reset_at
       END,
       updated_at = now()`,
    [keyHash, resetAt]
  );
}

function enforceSameOrigin(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  if (!origin) return next();
  try {
    const expected = new URL(`${req.protocol}://${req.get("host")}`).origin;
    const actual = new URL(origin).origin;
    const allowed = new Set(
      (process.env.ALLOWED_ORIGINS || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    );
    if (actual === expected || allowed.has(actual)) return next();
  } catch {
    // Invalid and opaque origins are rejected below.
  }
  next(new HttpError(403, "origin_not_allowed", "Cross-origin request rejected"));
}

export function createApp({
  pool,
  secureCookies,
  staticDir,
  smsSender = createSmsSender(),
  twilioWebhookOptions = {}
} = {}) {
  if (!pool) throw new Error("pool is required");

  const app = express();
  const sessionAuth = authenticate(pool);
  const cookies = cookieOptions(secureCookies);

  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);
  app.use((req, res, next) => {
    res.set({
      "content-security-policy": "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-resource-policy": "same-origin",
      "referrer-policy": "same-origin",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "permissions-policy": "camera=(), microphone=(), geolocation=()"
    });
    if (req.secure) {
      res.set("strict-transport-security", "max-age=31536000");
    }
    next();
  });
  app.use(express.json({ limit: "100kb" }));
  app.use(enforceSameOrigin);
  app.use("/api", (req, res, next) => {
    res.set("cache-control", "no-store");
    next();
  });

  app.get("/api/health", asyncRoute(async (req, res) => {
    await pool.query("SELECT 1");
    data(res, { status: "ok" });
  }));
  app.use(
    "/api/webhooks/twilio",
    createTwilioWebhookRouter({ pool, ...twilioWebhookOptions })
  );

  app.post("/api/auth/login", asyncRoute(async (req, res) => {
    const input = validate(loginSchema, req.body);
    const attemptKey = loginAttemptKey(req, input.email);
    if (await isLoginThrottled(pool, attemptKey)) {
      throw new HttpError(429, "too_many_attempts", "Too many login attempts; try again later");
    }
    const result = await pool.query(
      `SELECT u.id, u.organization_id AS "organizationId", u.email, u.name, u.role,
              u.password_hash AS "passwordHash",
              u.must_change_password AS "mustChangePassword",
              o.name AS "organizationName"
       FROM users u
       JOIN organizations o ON o.id = u.organization_id
       WHERE lower(u.email) = lower($1) AND u.active = true
       LIMIT 2`,
      [input.email]
    );
    if (result.rowCount !== 1 || !(await verifyPassword(input.password, result.rows[0].passwordHash))) {
      await recordLoginFailure(pool, attemptKey);
      throw new HttpError(401, "invalid_credentials", "Email or password is incorrect");
    }

    const auth = result.rows[0];
    const token = await withTransaction(pool, async (client) => {
      await client.query("DELETE FROM login_attempts WHERE key_hash = $1", [attemptKey]);
      const createdToken = await createSession(client, auth.id);
      await recordAudit(client, auth, {
        entityType: "user",
        entityId: auth.id,
        action: "login"
      });
      return createdToken;
    });
    res.cookie(SESSION_COOKIE, token, cookies);
    data(res, { user: publicUser(auth) });
  }));

  app.post("/api/auth/logout", sessionAuth, asyncRoute(async (req, res) => {
    await withTransaction(pool, async (client) => {
      await destroySession(client, req.sessionToken);
      await recordAudit(client, req.auth, {
        entityType: "user",
        entityId: req.auth.id,
        action: "logout"
      });
    });
    res.clearCookie(SESSION_COOKIE, { ...cookies, maxAge: undefined });
    data(res, { loggedOut: true });
  }));

  app.get("/api/auth/me", sessionAuth, (req, res) => {
    data(res, { user: publicUser(req.auth) });
  });

  app.post("/api/auth/change-password", sessionAuth, asyncRoute(async (req, res) => {
    const input = validate(changePasswordSchema, req.body);
    const user = await pool.query(
      "SELECT password_hash AS \"passwordHash\" FROM users WHERE id = $1 AND organization_id = $2",
      [req.auth.id, req.auth.organizationId]
    );
    if (!user.rowCount || !(await verifyPassword(input.currentPassword, user.rows[0].passwordHash))) {
      throw new HttpError(401, "invalid_password", "Current password is incorrect");
    }
    const passwordHash = await hashPassword(input.newPassword);
    await withTransaction(pool, async (client) => {
      await client.query(
        `UPDATE users
         SET password_hash = $2, must_change_password = false, updated_at = now()
         WHERE id = $1`,
        [req.auth.id, passwordHash]
      );
      await client.query(
        "DELETE FROM sessions WHERE user_id = $1 AND id <> $2",
        [req.auth.id, req.auth.sessionId]
      );
      await recordAudit(client, req.auth, {
        entityType: "user", entityId: req.auth.id, action: "change_password"
      });
    });
    data(res, { changed: true });
  }));

  app.get(
    "/api/audit-events",
    sessionAuth,
    requirePasswordChange,
    requireRole("manager"),
    asyncRoute(async (req, res) => {
      const input = validate(auditQuerySchema, req.query);
      const values = [req.auth.organizationId];
      const where = ["ae.organization_id = $1"];
      for (const [key, column] of [
        ["entityType", "ae.entity_type"],
        ["entityId", "ae.entity_id"],
        ["action", "ae.action"]
      ]) {
        if (!input[key]) continue;
        values.push(input[key]);
        where.push(`${column} = $${values.length}`);
      }
      values.push(input.limit);
      const result = await pool.query(
        `SELECT ae.id, ae.actor_user_id AS "actorUserId", u.name AS "actorName",
                ae.entity_type AS "entityType", ae.entity_id AS "entityId",
                ae.action, ae.before_data AS "before", ae.after_data AS "after",
                ae.reason, ae.created_at AS "createdAt"
         FROM audit_events ae
         LEFT JOIN users u
           ON u.id = ae.actor_user_id AND u.organization_id = ae.organization_id
         WHERE ${where.join(" AND ")}
         ORDER BY ae.created_at DESC
         LIMIT $${values.length}`,
        values
      );
      data(res, { events: result.rows });
    })
  );

  app.use("/api", sessionAuth);
  app.use("/api", requirePasswordChange);
  app.use("/api", createScheduleRouter({ pool }));
  app.use("/api", createDispatchRouter({ pool }));
  app.use("/api", createResourceRouter({ pool }));
  app.use("/api", createCommunicationRouter({ pool, sender: smsSender }));
  app.use("/api", createAutomationRouter({ pool, sender: smsSender }));
  app.use("/api", createReportingRouter({ pool }));
  app.use("/api", createAccountRouter({ pool }));
  app.use("/api", createFinanceRouter({ pool }));
  app.use("/api", createImportRouter({ pool }));
  app.use("/api", requireRole("manager"), createSalesRouter({ pool }));
  app.use("/api", notFound);
  if (staticDir) {
    app.use(express.static(staticDir, { index: false, maxAge: "1h" }));
    app.use((req, res, next) => {
      if (req.method !== "GET" || !req.accepts("html")) return next();
      res.sendFile("index.html", { root: staticDir }, (error) => {
        if (error) next(error);
      });
    });
  }
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
