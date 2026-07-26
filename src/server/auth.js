import crypto from "node:crypto";
import { HttpError } from "./http.js";
import { sessionToken, tokenHash } from "./passwords.js";

export const SESSION_COOKIE = "qcm_session";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

function cookieValue(req, name) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(value.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function cookieOptions(secure = process.env.SESSION_COOKIE_SECURE !== "false") {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MS
  };
}

export async function createSession(pool, userId) {
  const { token, hash } = sessionToken();
  await pool.query(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
    [crypto.randomUUID(), userId, hash, new Date(Date.now() + SESSION_MS)]
  );
  return token;
}

export function authenticate(pool) {
  return async function authentication(req, res, next) {
    try {
      const token = cookieValue(req, SESSION_COOKIE);
      if (!token) throw new HttpError(401, "unauthorized", "Authentication required");

      const result = await pool.query(
        `SELECT u.id, u.organization_id AS "organizationId", u.email, u.name, u.role,
                o.name AS "organizationName", s.id AS "sessionId"
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         JOIN organizations o ON o.id = u.organization_id
         WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active = true`,
        [tokenHash(token)]
      );
      if (!result.rowCount) throw new HttpError(401, "unauthorized", "Authentication required");

      req.auth = result.rows[0];
      req.sessionToken = token;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireRole(...roles) {
  return function roleGuard(req, res, next) {
    if (!req.auth) return next(new HttpError(401, "unauthorized", "Authentication required"));
    if (!roles.includes(req.auth.role)) {
      return next(new HttpError(403, "forbidden", "You do not have permission to perform this action"));
    }
    next();
  };
}

export async function destroySession(pool, token) {
  if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
}

export async function recordAudit(pool, auth, event) {
  await pool.query(
    `INSERT INTO audit_events
     (id, organization_id, actor_user_id, entity_type, entity_id, action,
      before_data, after_data, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      crypto.randomUUID(),
      auth.organizationId,
      auth.id,
      event.entityType,
      event.entityId || null,
      event.action,
      event.before === undefined ? null : JSON.stringify(event.before),
      event.after === undefined ? null : JSON.stringify(event.after),
      event.reason || null
    ]
  );
}
